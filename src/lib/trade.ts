/**
 * order placement through the user's agent (api) wallet. parity with the hyperliquid ticket:
 * market, limit (gtc / ioc / alo), stop market, stop limit, scale ladders, twap, reduce only,
 * attached tp / sl, position tp / sl, leverage + margin mode, cancel.
 * the agent key is generated server side, stored aes-encrypted, and only ever used here.
 * every order carries builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP }.
 */
import * as hl from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { prisma } from "./db";
import { decrypt, encrypt } from "./crypto";
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, HL_MOCK } from "./env";
import * as HL from "./hl";
import * as mock from "./hl-mock";
import { HttpError } from "./api";

export const AGENT_NAME = "socialLiquid";
/** hyperliquid base fees (tier 0): taker 0.045%, maker 0.015% */
export const TAKER_FEE = 0.00045;
export const MAKER_FEE = 0.00015;
/** market orders are aggressive ioc limits capped at this slippage */
export const MAX_SLIPPAGE = 0.03;

export async function getOrCreateAgent(userId: string) {
  const existing = await prisma.agentKey.findUnique({ where: { userId } });
  if (existing) return existing;
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return prisma.agentKey.create({ data: { userId, agentAddress: account.address.toLowerCase(), encryptedPrivKey: encrypt(pk) } });
}

export async function approvalStatus(userAddress: string, agentAddress: string) {
  const [agents, fee] = await Promise.all([
    HL.extraAgents(userAddress).catch(() => [] as { address: string }[]),
    HL.maxBuilderFee(userAddress, BUILDER_ADDRESS).catch(() => 0),
  ]);
  return {
    agentApproved: agents.some((a) => a.address.toLowerCase() === agentAddress.toLowerCase()),
    builderApproved: fee >= BUILDER_FEE_TENTHS_BP,
    approvedFeeTenthsBp: fee,
  };
}

async function agentFor(userId: string) {
  const agent = await prisma.agentKey.findUnique({ where: { userId } });
  if (!agent?.approvedAt) throw new HttpError(409, "agent wallet not approved yet");
  if (!agent.builderApprovedAt) throw new HttpError(409, "builder fee not approved yet");
  return agent;
}

function exchangeFor(encryptedPrivKey: string) {
  const wallet = privateKeyToAccount(decrypt(encryptedPrivKey) as `0x${string}`);
  return new hl.ExchangeClient({ transport: HL.transport(), wallet });
}

export type OrderType = "market" | "limit" | "stopMarket" | "stopLimit" | "takeProfitMarket" | "takeProfitLimit" | "scale" | "twap";
export type Tif = "Gtc" | "Ioc" | "Alo";

export type OrderInput = {
  coin: string;
  side: "LONG" | "SHORT";
  type: OrderType;
  /** size in usd or in coin; one is required */
  usd?: number;
  sz?: number;
  leverage: number;
  isCross?: boolean;
  limitPx?: number;
  triggerPx?: number;
  tif?: Tif;
  reduceOnly?: boolean;
  /** attached tp / sl (market triggers, reduce only) */
  tp?: number;
  sl?: number;
  scale?: { startPx: number; endPx: number; count: number; skew: number };
  twap?: { minutes: number; randomize: boolean };
};

export type OrderResult =
  | { status: "filled"; oid?: number; avgPx: number; totalSz: number; sz: string; px: string }
  | { status: "resting"; oid?: number; sz: string; px: string; count?: number }
  | { status: "twap"; twapId: number; sz: string; px: string };

type OrderStatus = { filled: { totalSz: string; avgPx: string; oid: number } } | { resting: { oid: number } } | { error: string } | string;

async function marketInfo(coin: string) {
  const m = await HL.meta();
  const asset = m.universe.findIndex((a) => a.name === coin);
  if (asset < 0) throw new HttpError(400, `unknown market ${coin}`);
  const mids = await HL.allMids();
  const mid = Number(mids[coin]);
  if (!mid) throw new HttpError(502, "no price for market");
  return { asset, szDecimals: m.universe[asset].szDecimals, maxLeverage: m.universe[asset].maxLeverage, mid };
}

export async function placeOrder(userId: string, address: string, input: OrderInput): Promise<OrderResult> {
  const agent = await agentFor(userId);
  const { asset, szDecimals, maxLeverage, mid } = await marketInfo(input.coin);
  const leverage = Math.max(1, Math.min(maxLeverage, Math.round(input.leverage)));
  const isBuy = input.side === "LONG";
  const isCross = input.isCross ?? true;

  // reference price for sizing
  const refPx = input.type === "limit" || input.type === "stopLimit" || input.type === "takeProfitLimit" ? (input.limitPx ?? mid) : input.type === "scale" ? (input.scale!.startPx + input.scale!.endPx) / 2 : mid;
  // sizing from usd rounds up so a "$10" order is not rejected under the $10 minimum after size rounding
  const sizeCoin = input.sz ?? (input.usd ?? 0) / refPx;
  const szStr = HL.formatSz(sizeCoin, szDecimals, input.sz !== undefined ? "floor" : "ceil");
  if (Number(szStr) <= 0) throw new HttpError(400, "size too small for this market");
  if (Number(szStr) * refPx < 10 && !input.reduceOnly) throw new HttpError(400, "minimum order value is $10");

  const fmt = (px: number) => HL.formatPx(px, szDecimals);
  const marketPx = mid * (isBuy ? 1 + MAX_SLIPPAGE : 1 - MAX_SLIPPAGE);

  // ---------- mock exchange ----------
  if (HL_MOCK) {
    const common = { user: address, coin: input.coin, isBuy, leverage, builderFeeTenthsBp: BUILDER_FEE_TENTHS_BP, reduceOnly: input.reduceOnly };
    if (input.type === "twap") {
      const twapId = await mock.mockTwap(address, input.coin, isBuy, Number(szStr), input.twap!.minutes, !!input.reduceOnly, input.twap!.randomize, leverage);
      return { status: "twap", twapId, sz: szStr, px: fmt(mid) };
    }
    if (input.type === "scale") {
      const { startPx, endPx, count, skew } = input.scale!;
      const sizes = ladderSizes(Number(szStr), count, skew, szDecimals);
      for (let i = 0; i < count; i++) {
        const px = startPx + ((endPx - startPx) * i) / Math.max(1, count - 1);
        await mock.mockPlaceOrder({ ...common, sz: sizes[i], limitPx: Number(fmt(px)), tif: input.tif ?? "Gtc" });
      }
      return { status: "resting", sz: szStr, px: fmt(startPx), count };
    }
    const isTrigger = input.type.startsWith("stop") || input.type.startsWith("takeProfit");
    const r = await mock.mockPlaceOrder({
      ...common,
      sz: Number(szStr),
      limitPx: input.type === "market" ? undefined : input.type === "stopMarket" || input.type === "takeProfitMarket" ? Number(fmt(input.triggerPx! * (isBuy ? 1.1 : 0.9))) : Number(fmt(input.limitPx!)),
      tif: input.type === "market" ? "Ioc" : (input.tif ?? "Gtc"),
      trigger: isTrigger ? { triggerPx: input.triggerPx!, isMarket: input.type.endsWith("Market"), tpsl: input.type.startsWith("stop") ? "sl" : "tp" } : undefined,
    });
    if (r.status === "err") throw new HttpError(400, r.error);
    if (r.status === "filled") {
      if (input.tp) await mock.mockPlaceOrder({ ...common, isBuy: !isBuy, sz: Number(szStr), reduceOnly: true, limitPx: Number(fmt(input.tp * (isBuy ? 0.9 : 1.1))), trigger: { triggerPx: input.tp, isMarket: true, tpsl: "tp" } });
      if (input.sl) await mock.mockPlaceOrder({ ...common, isBuy: !isBuy, sz: Number(szStr), reduceOnly: true, limitPx: Number(fmt(input.sl * (isBuy ? 0.9 : 1.1))), trigger: { triggerPx: input.sl, isMarket: true, tpsl: "sl" } });
      return { status: "filled", oid: r.oid, avgPx: r.filledPx, totalSz: r.totalSz, sz: szStr, px: fmt(refPx) };
    }
    return { status: "resting", oid: r.oid, sz: szStr, px: fmt(input.limitPx ?? input.triggerPx ?? mid) };
  }

  // ---------- hyperliquid ----------
  const ex = exchangeFor(agent.encryptedPrivKey);
  if (!input.reduceOnly) {
    await ex.updateLeverage({ asset, isCross, leverage }).catch((e: Error) => console.warn("[trade] updateLeverage:", e.message));
  }
  const builder = { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP };

  if (input.type === "twap") {
    const res = await ex.twapOrder({ twap: { a: asset, b: isBuy, s: szStr, r: !!input.reduceOnly, m: input.twap!.minutes, t: input.twap!.randomize } });
    const st = (res as unknown as { response: { data: { status: { running?: { twapId: number }; error?: string } } } }).response.data.status;
    if (st.error) throw new HttpError(400, st.error);
    return { status: "twap", twapId: st.running!.twapId, sz: szStr, px: fmt(mid) };
  }

  type OrderParams = Parameters<typeof ex.order>[0];
  type SingleOrder = OrderParams["orders"][number];
  const orders: SingleOrder[] = [];

  if (input.type === "scale") {
    const { startPx, endPx, count, skew } = input.scale!;
    const sizes = ladderSizes(Number(szStr), count, skew, szDecimals);
    for (let i = 0; i < count; i++) {
      const px = startPx + ((endPx - startPx) * i) / Math.max(1, count - 1);
      orders.push({ a: asset, b: isBuy, p: fmt(px), s: String(sizes[i]), r: !!input.reduceOnly, t: { limit: { tif: input.tif ?? "Gtc" } } });
    }
    const res = await ex.order({ orders, grouping: "na", builder });
    const statuses = (res as unknown as { response: { data: { statuses: OrderStatus[] } } }).response.data.statuses;
    const err = statuses.find((s) => typeof s === "object" && "error" in s) as { error: string } | undefined;
    if (err && statuses.every((s) => typeof s === "object" && "error" in s)) throw new HttpError(400, err.error);
    return { status: "resting", sz: szStr, px: fmt(startPx), count: statuses.filter((s) => typeof s === "object" && !("error" in s)).length };
  }

  const trigger = (triggerPx: number, tpsl: "tp" | "sl", isMarket: boolean, limitPx?: number, b = !isBuy, r = true): SingleOrder => ({
    a: asset,
    b,
    p: fmt(limitPx ?? triggerPx * (b ? 1.1 : 0.9)),
    s: szStr,
    r,
    t: { trigger: { isMarket, triggerPx: fmt(triggerPx), tpsl } },
  });

  switch (input.type) {
    case "market":
      orders.push({ a: asset, b: isBuy, p: fmt(marketPx), s: szStr, r: !!input.reduceOnly, t: { limit: { tif: "Ioc" } } });
      break;
    case "limit":
      orders.push({ a: asset, b: isBuy, p: fmt(input.limitPx!), s: szStr, r: !!input.reduceOnly, t: { limit: { tif: input.tif ?? "Gtc" } } });
      break;
    case "stopMarket":
      orders.push(trigger(input.triggerPx!, "sl", true, undefined, isBuy, !!input.reduceOnly));
      break;
    case "stopLimit":
      orders.push(trigger(input.triggerPx!, "sl", false, input.limitPx!, isBuy, !!input.reduceOnly));
      break;
    case "takeProfitMarket":
      orders.push(trigger(input.triggerPx!, "tp", true, undefined, isBuy, !!input.reduceOnly));
      break;
    case "takeProfitLimit":
      orders.push(trigger(input.triggerPx!, "tp", false, input.limitPx!, isBuy, !!input.reduceOnly));
      break;
  }
  if ((input.type === "market" || input.type === "limit") && input.tp) orders.push(trigger(input.tp, "tp", true));
  if ((input.type === "market" || input.type === "limit") && input.sl) orders.push(trigger(input.sl, "sl", true));

  const res = await ex.order({ orders, grouping: orders.length > 1 ? "normalTpsl" : "na", builder });
  const statuses = (res as unknown as { response: { data: { statuses: OrderStatus[] } } }).response.data.statuses;
  const first = statuses[0];
  if (typeof first === "object" && "error" in first) throw new HttpError(400, first.error);
  if (typeof first === "object" && "filled" in first) return { status: "filled", oid: first.filled.oid, avgPx: Number(first.filled.avgPx), totalSz: Number(first.filled.totalSz), sz: szStr, px: fmt(refPx) };
  if (typeof first === "object" && "resting" in first) return { status: "resting", oid: first.resting.oid, sz: szStr, px: fmt(input.limitPx ?? input.triggerPx ?? mid) };
  return { status: "resting", sz: szStr, px: fmt(input.triggerPx ?? mid) };
}

/** split a total size over `count` rungs; skew > 1 weights the far end, < 1 the near end */
export function ladderSizes(total: number, count: number, skew: number, szDecimals: number): number[] {
  const f = Math.pow(10, szDecimals);
  const weights = Array.from({ length: count }, (_, i) => 1 + (skew - 1) * (i / Math.max(1, count - 1)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.floor(((total * w) / sum) * f) / f);
  const rem = Math.round((total - sizes.reduce((a, b) => a + b, 0)) * f) / f;
  sizes[sizes.length - 1] = Math.round((sizes[sizes.length - 1] + rem) * f) / f;
  return sizes;
}

export async function cancelOrders(userId: string, address: string, cancels: { coin: string; oid: number }[]) {
  const agent = await agentFor(userId);
  if (HL_MOCK) {
    await mock.mockCancel(address, cancels.map((c) => c.oid));
    return { canceled: cancels.length };
  }
  const m = await HL.meta();
  const ex = exchangeFor(agent.encryptedPrivKey);
  const res = await ex.cancel({ cancels: cancels.map((c) => ({ a: m.universe.findIndex((u) => u.name === c.coin), o: c.oid })) });
  const statuses = (res as unknown as { response: { data: { statuses: (string | { error: string })[] } } }).response.data.statuses;
  const errors = statuses.filter((s) => typeof s === "object").map((s) => (s as { error: string }).error);
  if (errors.length === statuses.length) throw new HttpError(400, errors[0]);
  return { canceled: statuses.length - errors.length };
}

export async function cancelTwap(userId: string, address: string, coin: string, twapId: number) {
  const agent = await agentFor(userId);
  if (HL_MOCK) return mock.mockTwapCancel(address, twapId);
  const m = await HL.meta();
  const ex = exchangeFor(agent.encryptedPrivKey);
  await ex.twapCancel({ a: m.universe.findIndex((u) => u.name === coin), t: twapId });
}

export async function setLeverage(userId: string, address: string, coin: string, leverage: number, isCross: boolean) {
  const agent = await agentFor(userId);
  const { asset, maxLeverage } = await marketInfo(coin);
  const lev = Math.max(1, Math.min(maxLeverage, Math.round(leverage)));
  if (HL_MOCK) {
    await mock.mockSetLeverage(address, coin, lev, isCross);
    return { leverage: lev, isCross };
  }
  const ex = exchangeFor(agent.encryptedPrivKey);
  await ex.updateLeverage({ asset, isCross, leverage: lev });
  return { leverage: lev, isCross };
}

/** tp / sl on the whole open position (hyperliquid "positionTpsl" grouping) */
export async function positionTpsl(userId: string, address: string, coin: string, tp?: number, sl?: number) {
  const agent = await agentFor(userId);
  const state = await HL.clearinghouseState(address);
  const pos = state.assetPositions.find((p) => p.position.coin === coin && Number(p.position.szi) !== 0);
  if (!pos) throw new HttpError(404, "no open position");
  const szi = Number(pos.position.szi);
  const { asset, szDecimals } = await marketInfo(coin);
  const szStr = HL.formatSz(Math.abs(szi), szDecimals);
  const closeBuy = szi < 0;
  const fmt = (px: number) => HL.formatPx(px, szDecimals);
  if (HL_MOCK) {
    const common = { user: address, coin, isBuy: closeBuy, sz: Number(szStr), leverage: pos.position.leverage.value, builderFeeTenthsBp: BUILDER_FEE_TENTHS_BP, reduceOnly: true, isPositionTpsl: true };
    if (tp) await mock.mockPlaceOrder({ ...common, limitPx: Number(fmt(tp * (closeBuy ? 1.1 : 0.9))), trigger: { triggerPx: tp, isMarket: true, tpsl: "tp" } });
    if (sl) await mock.mockPlaceOrder({ ...common, limitPx: Number(fmt(sl * (closeBuy ? 1.1 : 0.9))), trigger: { triggerPx: sl, isMarket: true, tpsl: "sl" } });
    return { ok: true };
  }
  const ex = exchangeFor(agent.encryptedPrivKey);
  type SingleOrder = Parameters<typeof ex.order>[0]["orders"][number];
  const orders: SingleOrder[] = [];
  const mk = (px: number, tpsl: "tp" | "sl"): SingleOrder => ({ a: asset, b: closeBuy, p: fmt(px * (closeBuy ? 1.1 : 0.9)), s: szStr, r: true, t: { trigger: { isMarket: true, triggerPx: fmt(px), tpsl } } });
  if (tp) orders.push(mk(tp, "tp"));
  if (sl) orders.push(mk(sl, "sl"));
  if (!orders.length) throw new HttpError(400, "tp or sl required");
  const res = await ex.order({ orders, grouping: "positionTpsl", builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP } });
  const statuses = (res as unknown as { response: { data: { statuses: OrderStatus[] } } }).response.data.statuses;
  const err = statuses.find((s) => typeof s === "object" && "error" in s) as { error: string } | undefined;
  if (err) throw new HttpError(400, err.error);
  return { ok: true };
}

/** close the whole open position in a coin with a reduce-only market order */
export async function closePosition(userId: string, address: string, coin: string): Promise<OrderResult> {
  const state = await HL.clearinghouseState(address);
  const pos = state.assetPositions.find((p) => p.position.coin === coin && Number(p.position.szi) !== 0);
  if (!pos) throw new HttpError(404, "no open position");
  const szi = Number(pos.position.szi);
  return placeOrder(userId, address, { coin, side: szi > 0 ? "SHORT" : "LONG", sz: Math.abs(szi), leverage: pos.position.leverage.value, type: "market", reduceOnly: true });
}

export type SpotSellResult = { avgPx: number; totalSz: number; usdc: number; sz: string };

/**
 * sell a spot coin (USOL, UBTC…) for USDC on hyperliquid spot: an IOC order on the coin's USDC pair, signed by the agent,
 * priced off the perps mid with 2% room. the USDC lands in the spot balance; usdClassTransfer (main wallet) moves it to perps.
 */
export async function sellSpotForUsdc(userId: string, address: string, coin: string, size: number): Promise<SpotSellResult> {
  const pair = await HL.spotPair(coin);
  if (!pair) throw new HttpError(400, `${coin} has no USDC spot market on Hyperliquid`);
  const szStr = HL.formatSz(size, pair.szDecimals, "floor");
  const sz = Number(szStr);
  if (!(sz > 0)) throw new HttpError(400, `amount too small: ${coin} trades in steps of ${10 ** -pair.szDecimals}`);
  if (HL_MOCK) {
    const r = await mock.mockSpotSell(address, coin, sz);
    return { ...r, sz: szStr };
  }
  const perpName = coin.startsWith("U") ? coin.slice(1) : coin;
  const mids = await HL.allMids();
  const spotMid = Number(mids[pair.name] ?? mids[`@${pair.pairIndex}`] ?? mids[perpName]);
  if (!Number.isFinite(spotMid) || spotMid <= 0) throw new HttpError(400, `no price for ${coin}`);
  const agent = await getOrCreateAgent(userId);
  const ex = exchangeFor(agent.encryptedPrivKey);
  const px = HL.formatSpotPx(spotMid * 0.98, pair.szDecimals);
  const res = await ex.order({ orders: [{ a: pair.assetId, b: false, p: px, s: szStr, r: false, t: { limit: { tif: "Ioc" } } }], grouping: "na", builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP } });
  const first = (res as unknown as { response: { data: { statuses: OrderStatus[] } } }).response.data.statuses[0];
  if (typeof first === "object" && "error" in first) throw new HttpError(400, first.error);
  if (typeof first === "object" && "filled" in first) {
    const avgPx = Number(first.filled.avgPx);
    const totalSz = Number(first.filled.totalSz);
    return { avgPx, totalSz, usdc: avgPx * totalSz, sz: szStr };
  }
  throw new HttpError(400, "the spot market did not fill the order; try again");
}
