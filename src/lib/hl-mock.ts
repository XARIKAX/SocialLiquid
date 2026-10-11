/**
 * synthetic hyperliquid for offline development (HL_MOCK=true).
 * - prices are a deterministic function of time so every process agrees
 * - a dozen synthetic traders open / close / get liquidated on a random schedule
 * - user orders placed through the mock exchange mutate the same state
 * state lives in a json file in cwd so the next.js server and the worker share it.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  HlAllMids,
  HlAssetCtx,
  HlCandle,
  HlCandleInterval,
  HlClearinghouseState,
  HlFill,
  HlLeaderboardRow,
  HlMeta,
  HlPosition,
} from "./hl-types";

const UNIVERSE: { name: string; base: number; szDecimals: number; maxLeverage: number; vol: number }[] = [
  { name: "BTC", base: 112_000, szDecimals: 5, maxLeverage: 40, vol: 0.02 },
  { name: "ETH", base: 3_900, szDecimals: 4, maxLeverage: 25, vol: 0.03 },
  { name: "SOL", base: 185, szDecimals: 2, maxLeverage: 20, vol: 0.04 },
  { name: "HYPE", base: 42, szDecimals: 2, maxLeverage: 10, vol: 0.05 },
  { name: "DOGE", base: 0.21, szDecimals: 0, maxLeverage: 10, vol: 0.05 },
  { name: "XRP", base: 2.6, szDecimals: 0, maxLeverage: 20, vol: 0.04 },
  { name: "SUI", base: 3.4, szDecimals: 1, maxLeverage: 10, vol: 0.06 },
  { name: "PEPE", base: 0.0000098, szDecimals: 0, maxLeverage: 10, vol: 0.07 },
  { name: "WIF", base: 0.9, szDecimals: 1, maxLeverage: 10, vol: 0.07 },
  { name: "ARB", base: 0.45, szDecimals: 1, maxLeverage: 10, vol: 0.05 },
];

export const MOCK_TRADERS: `0x${string}`[] = Array.from({ length: 12 }, (_, i) =>
  (`0x${(i + 1).toString(16).padStart(2, "0")}${"ab".repeat(19)}`.slice(0, 42)) as `0x${string}`,
);

// ---------- deterministic prices ----------

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: string): number {
  return hash32(seed) / 4294967296;
}

export function priceAt(coin: string, t: number): number {
  const u = UNIVERSE.find((x) => x.name === coin);
  if (!u) return 0;
  const seed = hash32(coin) % 1000;
  const x = t / 1000 + seed * 1000;
  const trend = 0.6 * Math.sin(x / 86_400) + 0.35 * Math.sin(x / 7_200 + seed) + 0.15 * Math.sin(x / 600 + 2 * seed);
  const minute = Math.floor(t / 60_000);
  const noise = (rand(`${coin}:${minute}`) - 0.5) * 0.3 + (rand(`${coin}:${minute - 1}`) - 0.5) * 0.15;
  return u.base * Math.exp(u.vol * (trend + noise));
}

export async function meta(): Promise<HlMeta> {
  return { universe: UNIVERSE.map(({ name, szDecimals, maxLeverage }) => ({ name, szDecimals, maxLeverage })) };
}

export async function metaAndAssetCtxs(): Promise<[HlMeta, HlAssetCtx[]]> {
  const now = Date.now();
  const ctxs: HlAssetCtx[] = UNIVERSE.map((u) => {
    const mark = priceAt(u.name, now);
    const prev = priceAt(u.name, now - 86_400_000);
    const vlm = (u.base > 1000 ? 2.2e9 : u.base > 100 ? 7e8 : 9e7) * (0.6 + rand(u.name + ":vlm") * 0.8);
    return {
      funding: String(((rand(u.name + ":f") - 0.4) * 0.0002).toFixed(8)),
      openInterest: String((vlm * 0.4) / mark),
      prevDayPx: String(prev),
      dayNtlVlm: String(vlm),
      premium: "0",
      oraclePx: String(mark),
      markPx: String(mark),
      midPx: String(mark),
      impactPxs: null,
    };
  });
  return [await meta(), ctxs];
}

export async function allMids(): Promise<HlAllMids> {
  const now = Date.now();
  return Object.fromEntries(UNIVERSE.map((u) => [u.name, String(priceAt(u.name, now))]));
}

export async function candleSnapshot(
  coin: string,
  interval: HlCandleInterval,
  startTime: number,
  endTime: number,
): Promise<HlCandle[]> {
  const ms = intervalMs(interval);
  const out: HlCandle[] = [];
  const first = Math.floor(startTime / ms) * ms;
  for (let t = first; t < endTime && out.length < 5000; t += ms) {
    const T = t + ms - 1;
    const samples = [0, 0.25, 0.5, 0.75, 1].map((f) => priceAt(coin, Math.min(t + f * ms, endTime)));
    out.push({
      t,
      T,
      s: coin,
      i: interval,
      o: String(samples[0]),
      c: String(samples[4]),
      h: String(Math.max(...samples)),
      l: String(Math.min(...samples)),
      v: String(1000 * (0.5 + rand(`${coin}:${t}:v`))),
      n: 100,
    });
  }
  return out;
}

export function intervalMs(i: HlCandleInterval): number {
  const m = 60_000;
  const map: Record<HlCandleInterval, number> = {
    "1m": m, "3m": 3 * m, "5m": 5 * m, "15m": 15 * m, "30m": 30 * m,
    "1h": 60 * m, "2h": 120 * m, "4h": 240 * m, "8h": 480 * m, "12h": 720 * m,
    "1d": 1440 * m, "3d": 3 * 1440 * m, "1w": 7 * 1440 * m, "1M": 30 * 1440 * m,
  };
  return map[i];
}

// ---------- shared mutable state ----------

type MockPos = { coin: string; szi: number; entryPx: number; leverage: number; openedAt: number };
type MockState = {
  nextTid: number;
  positions: Record<string, MockPos[]>;
  fills: Record<string, HlFill[]>;
  lastTick: Record<string, number>;
  builderFees: Record<string, number>;
  agents: Record<string, { address: string; name: string }[]>;
};

const STATE_FILE = path.join(process.cwd(), ".hl-mock-state.json");

function load(): MockState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as MockState;
  } catch {
    return { nextTid: 1, positions: {}, fills: {}, lastTick: {}, builderFees: {}, agents: {} };
  }
}

function save(s: MockState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s));
}

function withState<T>(fn: (s: MockState) => T): T {
  const s = load();
  const r = fn(s);
  save(s);
  return r;
}

function pushFill(s: MockState, address: string, f: Omit<HlFill, "tid" | "hash" | "oid" | "crossed" | "feeToken" | "startPosition">, startPosition: number) {
  const tid = s.nextTid++;
  const list = (s.fills[address] ??= []);
  list.push({
    ...f,
    tid,
    oid: tid,
    hash: `0x${tid.toString(16).padStart(64, "0")}`,
    crossed: true,
    feeToken: "USDC",
    startPosition: String(startPosition),
  });
  if (list.length > 500) list.splice(0, list.length - 500);
}

/** apply a signed size delta at price px for address. returns closed pnl. */
function applyTrade(s: MockState, address: string, coin: string, delta: number, px: number, leverage: number, opts: { liquidation?: boolean; builderFee?: number } = {}) {
  const a = address.toLowerCase();
  const list = (s.positions[a] ??= []);
  const existing = list.find((p) => p.coin === coin);
  const start = existing?.szi ?? 0;
  const end = start + delta;
  let closedPnl = 0;
  let dir: string;
  if (start === 0) {
    dir = delta > 0 ? "Open Long" : "Open Short";
    list.push({ coin, szi: delta, entryPx: px, leverage, openedAt: Date.now() });
  } else if (Math.sign(start) === Math.sign(end) && Math.abs(end) > Math.abs(start)) {
    dir = start > 0 ? "Open Long" : "Open Short";
    existing!.entryPx = (existing!.entryPx * Math.abs(start) + px * Math.abs(delta)) / Math.abs(end);
    existing!.szi = end;
  } else {
    // reducing / closing / flipping
    const closedSz = Math.min(Math.abs(start), Math.abs(delta));
    closedPnl = (px - existing!.entryPx) * closedSz * Math.sign(start);
    if (opts.liquidation) dir = start > 0 ? "Liquidated Long" : "Liquidated Short";
    else if (Math.sign(start) !== Math.sign(end) && end !== 0) dir = start > 0 ? "Long > Short" : "Short > Long";
    else dir = start > 0 ? "Close Long" : "Close Short";
    if (end === 0) list.splice(list.indexOf(existing!), 1);
    else if (Math.sign(end) !== Math.sign(start)) {
      existing!.szi = end;
      existing!.entryPx = px;
      existing!.openedAt = Date.now();
    } else existing!.szi = end;
  }
  const notional = Math.abs(delta) * px;
  pushFill(
    s,
    a,
    {
      coin,
      px: String(px),
      sz: String(Math.abs(delta)),
      side: delta > 0 ? "B" : "A",
      time: Date.now(),
      dir,
      closedPnl: String(closedPnl),
      fee: String(notional * 0.00045),
      builderFee: opts.builderFee !== undefined ? String(opts.builderFee) : undefined,
      liquidation: opts.liquidation ? { markPx: String(px), method: "market" } : undefined,
    },
    start,
  );
  return closedPnl;
}

/** advance a synthetic trader. ~ one decision per 20s bucket. */
function tick(s: MockState, address: string) {
  const a = address.toLowerCase();
  if (!MOCK_TRADERS.includes(a as `0x${string}`)) return;
  const now = Date.now();
  const bucket = Math.floor(now / 20_000);
  if ((s.lastTick[a] ?? 0) >= bucket) return;
  s.lastTick[a] = bucket;
  const r = rand(`${a}:${bucket}`);
  const positions = (s.positions[a] ??= []);
  const open = positions.length;
  if (open > 0 && r < 0.18) {
    const p = positions[Math.floor(rand(`${a}:${bucket}:which`) * open)];
    const px = priceAt(p.coin, now);
    const liq = rand(`${a}:${bucket}:liq`) < 0.08;
    applyTrade(s, a, p.coin, -p.szi, liq ? px * (p.szi > 0 ? 0.985 : 1.015) : px, p.leverage, { liquidation: liq });
  } else if (open < 3 && r > 0.72) {
    const u = UNIVERSE[Math.floor(rand(`${a}:${bucket}:coin`) * UNIVERSE.length)];
    if (positions.some((p) => p.coin === u.name)) return;
    const px = priceAt(u.name, now);
    const usd = [800, 1500, 3200, 7500, 15000, 42000, 120000][Math.floor(rand(`${a}:${bucket}:usd`) * 7)];
    const lev = [2, 3, 5, 10, 20][Math.floor(rand(`${a}:${bucket}:lev`) * 5)];
    const long = rand(`${a}:${bucket}:side`) > 0.45;
    const sz = Number((usd / px).toFixed(u.szDecimals));
    if (sz <= 0) return;
    applyTrade(s, a, u.name, long ? sz : -sz, px, Math.min(lev, u.maxLeverage));
  }
}

export async function clearinghouseState(address: string): Promise<HlClearinghouseState> {
  const a = address.toLowerCase();
  return withState((s) => {
    tick(s, a);
    const now = Date.now();
    const positions: HlPosition[] = (s.positions[a] ?? []).map((p) => {
      const mark = priceAt(p.coin, now);
      const value = Math.abs(p.szi) * mark;
      const upnl = (mark - p.entryPx) * p.szi;
      const margin = value / p.leverage;
      return {
        coin: p.coin,
        szi: String(p.szi),
        leverage: { type: "cross", value: p.leverage },
        entryPx: String(p.entryPx),
        positionValue: String(value),
        unrealizedPnl: String(upnl),
        returnOnEquity: String(margin > 0 ? upnl / margin : 0),
        liquidationPx: String(p.entryPx * (1 - Math.sign(p.szi) * 0.9 / p.leverage)),
        marginUsed: String(margin),
        maxLeverage: 50,
      };
    });
    const totalNtl = positions.reduce((acc, p) => acc + Number(p.positionValue), 0);
    const margin = positions.reduce((acc, p) => acc + Number(p.marginUsed), 0);
    const base = 1000 + (hash32(a) % 50_000);
    const accountValue = base + positions.reduce((acc, p) => acc + Number(p.unrealizedPnl), 0);
    return {
      marginSummary: {
        accountValue: String(accountValue),
        totalNtlPos: String(totalNtl),
        totalRawUsd: String(accountValue),
        totalMarginUsed: String(margin),
      },
      withdrawable: String(Math.max(0, accountValue - margin)),
      assetPositions: positions.map((p) => ({ type: "oneWay", position: p })),
      time: now,
    };
  });
}

export async function userFills(address: string, since?: number): Promise<HlFill[]> {
  const a = address.toLowerCase();
  return withState((s) => {
    tick(s, a);
    const fills = s.fills[a] ?? [];
    const list = since !== undefined ? fills.filter((f) => f.time >= since) : fills;
    return [...list].reverse();
  });
}

export async function maxBuilderFee(user: string, builder: string): Promise<number> {
  const s = load();
  return s.builderFees[`${user.toLowerCase()}:${builder.toLowerCase()}`] ?? 0;
}

export async function extraAgents(user: string) {
  const s = load();
  return (s.agents[user.toLowerCase()] ?? []).map((x) => ({ ...x, validUntil: null }));
}

export async function leaderboard(): Promise<HlLeaderboardRow[]> {
  return MOCK_TRADERS.map((addr, i) => ({
    ethAddress: addr,
    accountValue: String(10_000 * (i + 1)),
    displayName: i % 3 === 0 ? `whale${i}` : null,
    prize: 0,
    windowPerformances: [
      ["day", { pnl: String(1000 - i * 50), roi: "0.01", vlm: "100000" }],
      ["week", { pnl: String(5000 - i * 200), roi: "0.05", vlm: "500000" }],
      ["month", { pnl: String(20000 - i * 500), roi: "0.1", vlm: "2000000" }],
      ["allTime", { pnl: String(100000 - i * 1000), roi: "0.5", vlm: "9000000" }],
    ],
  }));
}

// ---------- mock exchange (write side, used by the trade route when HL_MOCK) ----------

export async function mockApproveBuilderFee(user: string, builder: string, tenthsBp: number) {
  withState((s) => {
    s.builderFees[`${user.toLowerCase()}:${builder.toLowerCase()}`] = tenthsBp;
  });
}

export async function mockApproveAgent(user: string, agentAddress: string, name: string) {
  withState((s) => {
    const list = (s.agents[user.toLowerCase()] ??= []);
    if (!list.some((x) => x.address.toLowerCase() === agentAddress.toLowerCase())) list.push({ address: agentAddress, name });
  });
}

export async function mockPlaceOrder(args: {
  user: string;
  coin: string;
  isBuy: boolean;
  sz: number;
  leverage: number;
  builderFeeTenthsBp: number;
  reduceOnly?: boolean;
}): Promise<{ status: "ok"; filledPx: number; totalSz: number } | { status: "err"; error: string }> {
  const u = UNIVERSE.find((x) => x.name === args.coin);
  if (!u) return { status: "err", error: `unknown coin ${args.coin}` };
  const px = priceAt(args.coin, Date.now()) * (args.isBuy ? 1.0003 : 0.9997);
  return withState((s) => {
    const a = args.user.toLowerCase();
    const existing = (s.positions[a] ?? []).find((p) => p.coin === args.coin);
    let delta = args.isBuy ? args.sz : -args.sz;
    if (args.reduceOnly) {
      if (!existing || Math.sign(existing.szi) === Math.sign(delta)) return { status: "err", error: "reduce only: nothing to reduce" };
      delta = Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(existing.szi));
    }
    const builderFee = (Math.abs(delta) * px * args.builderFeeTenthsBp) / 100_000;
    applyTrade(s, a, args.coin, delta, px, args.leverage, { builderFee });
    return { status: "ok", filledPx: px, totalSz: Math.abs(delta) };
  });
}
