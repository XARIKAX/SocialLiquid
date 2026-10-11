/**
 * order placement through the user's agent (api) wallet.
 * the agent key is generated server side, stored aes-encrypted, and only ever used here.
 * the user's main wallet signs approveAgent + approveBuilderFee once, client side.
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

export async function getOrCreateAgent(userId: string) {
  const existing = await prisma.agentKey.findUnique({ where: { userId } });
  if (existing) return existing;
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return prisma.agentKey.create({
    data: { userId, agentAddress: account.address.toLowerCase(), encryptedPrivKey: encrypt(pk) },
  });
}

/** check on-chain state for the two one-time approvals */
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

function exchangeFor(encryptedPrivKey: string) {
  const wallet = privateKeyToAccount(decrypt(encryptedPrivKey) as `0x${string}`);
  return new hl.ExchangeClient({ transport: HL.transport(), wallet });
}

export type OrderInput = {
  coin: string;
  side: "LONG" | "SHORT";
  usd: number;
  leverage: number;
  type: "market" | "limit";
  limitPx?: number;
  tp?: number;
  sl?: number;
  reduceOnly?: boolean;
};

export type OrderResult = {
  status: "filled" | "resting";
  oid?: number;
  avgPx?: number;
  totalSz?: number;
  sz: string;
  px: string;
};

type OrderStatus = { filled: { totalSz: string; avgPx: string; oid: number } } | { resting: { oid: number } } | { error: string };

export async function placeOrder(userId: string, address: string, input: OrderInput): Promise<OrderResult> {
  const agent = await prisma.agentKey.findUnique({ where: { userId } });
  if (!agent?.approvedAt) throw new HttpError(409, "agent wallet not approved yet");
  if (!agent.builderApprovedAt) throw new HttpError(409, "builder fee not approved yet");

  const m = await HL.meta();
  const asset = m.universe.findIndex((a) => a.name === input.coin);
  if (asset < 0) throw new HttpError(400, `unknown market ${input.coin}`);
  const { szDecimals, maxLeverage } = m.universe[asset];
  const leverage = Math.max(1, Math.min(maxLeverage, Math.round(input.leverage)));

  const mids = await HL.allMids();
  const mid = Number(mids[input.coin]);
  if (!mid) throw new HttpError(502, "no price for market");

  const isBuy = input.side === "LONG";
  // market = aggressive IOC limit with 3% slippage cap, like the hl frontend
  const px = input.type === "limit" && input.limitPx ? input.limitPx : mid * (isBuy ? 1.03 : 0.97);
  const sz = input.usd / (input.type === "limit" && input.limitPx ? input.limitPx : mid);
  const szStr = HL.formatSz(sz, szDecimals);
  if (Number(szStr) <= 0) throw new HttpError(400, "size too small for this market");
  if (input.usd < 10) throw new HttpError(400, "minimum order is $10");
  const pxStr = HL.formatPx(px, szDecimals);

  if (HL_MOCK) {
    const r = await mock.mockPlaceOrder({ user: address, coin: input.coin, isBuy, sz: Number(szStr), leverage, builderFeeTenthsBp: BUILDER_FEE_TENTHS_BP, reduceOnly: input.reduceOnly });
    if (r.status === "err") throw new HttpError(400, r.error);
    return { status: "filled", avgPx: r.filledPx, totalSz: r.totalSz, sz: szStr, px: pxStr };
  }

  const ex = exchangeFor(agent.encryptedPrivKey);
  if (!input.reduceOnly) {
    await ex.updateLeverage({ asset, isCross: true, leverage }).catch((e: Error) => {
      // leverage update fails if it would under-margin an existing position. keep going with the current leverage.
      console.warn("[trade] updateLeverage:", e.message);
    });
  }

  type OrderParams = Parameters<typeof ex.order>[0];
  type SingleOrder = OrderParams["orders"][number];
  const main: SingleOrder = {
    a: asset,
    b: isBuy,
    p: pxStr,
    s: szStr,
    r: !!input.reduceOnly,
    t: { limit: { tif: input.type === "market" ? "Ioc" : "Gtc" } },
  };
  const orders: SingleOrder[] = [main];
  const trigger = (triggerPx: number, tpsl: "tp" | "sl"): SingleOrder => ({
    a: asset,
    b: !isBuy,
    p: HL.formatPx(triggerPx * (isBuy ? 0.9 : 1.1), szDecimals),
    s: szStr,
    r: true,
    t: { trigger: { isMarket: true, triggerPx: HL.formatPx(triggerPx, szDecimals), tpsl } },
  });
  if (input.tp) orders.push(trigger(input.tp, "tp"));
  if (input.sl) orders.push(trigger(input.sl, "sl"));

  const res = await ex.order({
    orders,
    grouping: orders.length > 1 ? "normalTpsl" : "na",
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP },
  });
  const statuses = (res as unknown as { response: { data: { statuses: OrderStatus[] } } }).response.data.statuses;
  const first = statuses[0];
  if ("error" in first) throw new HttpError(400, first.error);
  if ("filled" in first) {
    return { status: "filled", oid: first.filled.oid, avgPx: Number(first.filled.avgPx), totalSz: Number(first.filled.totalSz), sz: szStr, px: pxStr };
  }
  return { status: "resting", oid: first.resting.oid, sz: szStr, px: pxStr };
}

/** close the whole open position in a coin with a reduce-only market order */
export async function closePosition(userId: string, address: string, coin: string): Promise<OrderResult> {
  const state = await HL.clearinghouseState(address);
  const pos = state.assetPositions.find((p) => p.position.coin === coin && Number(p.position.szi) !== 0);
  if (!pos) throw new HttpError(404, "no open position");
  const szi = Number(pos.position.szi);
  const mids = await HL.allMids();
  const usd = Math.abs(szi) * Number(mids[coin]);
  return placeOrder(userId, address, {
    coin,
    side: szi > 0 ? "SHORT" : "LONG",
    usd: Math.max(usd, 10.01),
    leverage: pos.position.leverage.value,
    type: "market",
    reduceOnly: true,
  });
}
