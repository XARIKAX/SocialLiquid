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
  HlBookLevel,
  HlFundingPayment,
  HlFundingRate,
  HlHistoricalOrder,
  HlL2Book,
  HlOpenOrder,
  HlRecentTrade,
  HlTwap,
  HlAllMids,
  HlAssetCtx,
  HlCandle,
  HlCandleInterval,
  HlClearinghouseState,
  HlFill,
  HlLeaderboardRow,
  HlMeta,
  HlPosition,
  MarketSummary,
} from "./hl-types";

const UNIVERSE: { name: string; base: number; szDecimals: number; maxLeverage: number; vol: number; dex?: string }[] = [
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
  // builder-dex (HIP-3) tradfi perps, like hyperliquid's "xyz" dex
  { name: "xyz:BRENTOIL", base: 103.4, szDecimals: 2, maxLeverage: 20, vol: 0.015, dex: "xyz" },
  { name: "xyz:S&P500", base: 7814, szDecimals: 3, maxLeverage: 50, vol: 0.008, dex: "xyz" },
  { name: "xyz:XYZ100", base: 30837, szDecimals: 3, maxLeverage: 30, vol: 0.01, dex: "xyz" },
  { name: "xyz:SILVER", base: 60.6, szDecimals: 2, maxLeverage: 25, vol: 0.02, dex: "xyz" },
  { name: "xyz:GOLD", base: 4312, szDecimals: 3, maxLeverage: 25, vol: 0.01, dex: "xyz" },
  { name: "xyz:TSLA", base: 412, szDecimals: 2, maxLeverage: 10, vol: 0.03, dex: "xyz" },
  { name: "xyz:NVDA", base: 188, szDecimals: 2, maxLeverage: 10, vol: 0.03, dex: "xyz" },
  { name: "xyz:EURUSD", base: 1.164, szDecimals: 0, maxLeverage: 50, vol: 0.004, dex: "xyz" },
  { name: "xyz:SPACEX", base: 1004, szDecimals: 2, maxLeverage: 5, vol: 0.03, dex: "xyz" },
];
/** mock spot pairs: "@index" the way hyperliquid names them, priced off the matching perp */
const SPOT_PAIRS: { coin: string; token: string; perp: string; index: number }[] = [
  { coin: "@1", token: "USOL", perp: "SOL", index: 1 },
  { coin: "@2", token: "UBTC", perp: "BTC", index: 2 },
  { coin: "@3", token: "UETH", perp: "ETH", index: 3 },
  { coin: "@4", token: "HYPE", perp: "HYPE", index: 4 },
];
const ALIAS: Record<string, string> = Object.fromEntries(SPOT_PAIRS.map((p) => [p.coin, p.perp]));
const MAIN = () => UNIVERSE.filter((u) => !u.dex);

/** deterministic but realistic-looking synthetic trader addresses */
export const MOCK_TRADERS: `0x${string}`[] = Array.from({ length: 12 }, (_, i) => {
  let h = 0x9e3779b9 ^ (i + 1);
  let out = "";
  for (let k = 0; k < 40; k++) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    out += ((h >>> 28) & 15).toString(16);
  }
  return `0x${out}` as `0x${string}`;
});

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
  coin = ALIAS[coin] ?? coin;
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
  return { universe: MAIN().map(({ name, szDecimals, maxLeverage }) => ({ name, szDecimals, maxLeverage })) };
}

function ctxFor(u: (typeof UNIVERSE)[number], now: number): HlAssetCtx {
  const mark = priceAt(u.name, now);
  const prev = priceAt(u.name, now - 86_400_000);
  const vlm = (u.base > 1000 ? 2.2e9 : u.base > 100 ? 7e8 : 9e7) * (0.6 + rand(u.name + ":vlm") * 0.8) * (u.dex ? 0.12 : 1);
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
}

/** mock builder-dex perps as MarketSummary rows */
export async function hip3Markets(): Promise<MarketSummary[]> {
  const now = Date.now();
  const dexes = [...new Set(UNIVERSE.filter((u) => u.dex).map((u) => u.dex!))];
  return UNIVERSE.filter((u) => u.dex).map((u) => {
    const c = ctxFor(u, now);
    const markPx = Number(c.markPx);
    const prevDayPx = Number(c.prevDayPx);
    const name = u.name.split(":")[1];
    const dexIndex = dexes.indexOf(u.dex!) + 1;
    const i = UNIVERSE.filter((x) => x.dex === u.dex).indexOf(u);
    return { coin: u.name, slug: u.name, name, base: name, kind: "hip3" as const, dex: u.dex!, dexName: "XYZ Markets", category: tradfiCategoryMock(name), assetId: 100000 + dexIndex * 10000 + i, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, markPx, midPx: markPx, prevDayPx, change24h: prevDayPx > 0 ? (markPx - prevDayPx) / prevDayPx : 0, volume24h: Number(c.dayNtlVlm), openInterestUsd: Number(c.openInterest) * markPx, funding: Number(c.funding), oraclePx: markPx };
  });
}
function tradfiCategoryMock(name: string) {
  if (/OIL|SILVER|GOLD/.test(name)) return "Commodities";
  if (/S&P|XYZ100/.test(name)) return "Indices";
  if (/EURUSD/.test(name)) return "FX";
  if (/SPACEX/.test(name)) return "Pre-IPO";
  return "Stocks";
}

/** mock USDC spot pairs as MarketSummary rows */
export async function spotMarkets(): Promise<MarketSummary[]> {
  const now = Date.now();
  const toks = await spotTokens();
  return SPOT_PAIRS.map((p) => {
    const markPx = priceAt(p.perp, now);
    const prevDayPx = priceAt(p.perp, now - 86_400_000);
    const disp = p.token.startsWith("U") ? p.token.slice(1) : p.token;
    return { coin: p.coin, slug: `spot:${p.token}`, name: `${disp}/USDC`, base: disp, kind: "spot" as const, dex: "", token: p.token, assetId: 10000 + p.index, szDecimals: toks[p.token]?.szDecimals ?? 2, maxLeverage: 1, markPx, midPx: markPx, prevDayPx, change24h: prevDayPx > 0 ? (markPx - prevDayPx) / prevDayPx : 0, volume24h: 3e7 * (0.5 + rand(p.coin + ":v")), openInterestUsd: 0, funding: 0, oraclePx: markPx };
  });
}

/** mock spot trade: buy debits spot USDC and credits the token, sell the reverse. fills at the mid, spot taker fee */
export async function mockSpotTrade(user: string, token: string, perp: string, isBuy: boolean, sz: number): Promise<{ avgPx: number; totalSz: number }> {
  const px = priceAt(perp, Date.now());
  return withState((s) => {
    const all = (s.spot ??= {});
    const mine = (all[user.toLowerCase()] ??= {});
    const cost = sz * px;
    if (isBuy) {
      if ((mine.USDC ?? 0) + 1e-9 < cost * 1.0007) throw new Error("insufficient spot USDC");
      mine.USDC = Math.max(0, (mine.USDC ?? 0) - cost * 1.0007);
      mine[token] = (mine[token] ?? 0) + sz;
    } else {
      if ((mine[token] ?? 0) + 1e-12 < sz) throw new Error(`insufficient ${token}`);
      mine[token] = Math.max(0, mine[token] - sz);
      mine.USDC = (mine.USDC ?? 0) + cost * (1 - 0.0007);
    }
    return { avgPx: px, totalSz: sz };
  });
}

export async function metaAndAssetCtxs(): Promise<[HlMeta, HlAssetCtx[]]> {
  const now = Date.now();
  return [await meta(), MAIN().map((u) => ctxFor(u, now))];
}

export async function allMids(): Promise<HlAllMids> {
  const now = Date.now();
  return Object.fromEntries([...UNIVERSE.map((u) => [u.name, String(priceAt(u.name, now))]), ...SPOT_PAIRS.map((p) => [p.coin, String(priceAt(p.perp, now))])]);
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
type MockOrder = {
  oid: number;
  coin: string;
  side: "B" | "A";
  limitPx: number;
  sz: number;
  origSz: number;
  reduceOnly: boolean;
  isTrigger: boolean;
  triggerPx: number;
  tpsl: "tp" | "sl" | null;
  isMarket: boolean;
  tif: string;
  timestamp: number;
  isPositionTpsl: boolean;
  leverage: number;
};
type MockHist = { order: MockOrder; status: string; statusTimestamp: number };
type MockTwap = { twapId: number; coin: string; side: "B" | "A"; sz: number; executedSz: number; executedNtl: number; minutes: number; reduceOnly: boolean; randomize: boolean; timestamp: number; lastSlice: number; status: string; leverage: number };
type MockState = {
  nextTid: number;
  nextOid?: number;
  positions: Record<string, MockPos[]>;
  fills: Record<string, HlFill[]>;
  lastTick: Record<string, number>;
  builderFees: Record<string, number>;
  agents: Record<string, { address: string; name: string }[]>;
  orders?: Record<string, MockOrder[]>;
  history?: Record<string, MockHist[]>;
  twaps?: Record<string, MockTwap[]>;
  leverage?: Record<string, number>;
  /** net mock deposits per user, added to the synthetic base balance */
  deposits?: Record<string, number>;
  /** mock spot balances per user, keyed by hyperliquid spot coin (USOL, UBTC, …) */
  spot?: Record<string, Record<string, number>>;
};

const STATE_FILE = path.join(process.cwd(), ".hl-mock-state.json");
const LOCK_FILE = `${STATE_FILE}.lock`;
let lastGood: MockState | undefined;

function emptyState(): MockState {
  return { nextTid: 1, positions: {}, fills: {}, lastTick: {}, builderFees: {}, agents: {}, orders: {}, history: {}, twaps: {}, leverage: {} };
}

/** the next.js server and the worker share this file. never reset on a torn read: retry, then fall back to the last good copy. */
function load(): MockState {
  for (let i = 0; i < 6; i++) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as MockState;
      lastGood = parsed;
      return parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return lastGood ?? emptyState();
      spin(4);
    }
  }
  return lastGood ?? emptyState();
}

/** atomic replace so a reader never sees a partial file */
function save(s: MockState) {
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE_FILE);
  lastGood = s;
}

function spin(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait, dev only */
  }
}

/** tiny cross-process mutex around read-modify-write cycles */
function lock(): () => void {
  const deadline = Date.now() + 400;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {}
      };
    } catch {
      // stale lock from a crashed process
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 2000) fs.unlinkSync(LOCK_FILE);
      } catch {}
      if (Date.now() > deadline) return () => {};
      spin(3);
    }
  }
}

function withState<T>(fn: (s: MockState) => T): T {
  const release = lock();
  try {
    const s = load();
    const r = fn(s);
    save(s);
    return r;
  } finally {
    release();
  }
}

function pushFill(s: MockState, address: string, f: Omit<HlFill, "tid" | "hash" | "oid" | "crossed" | "feeToken" | "startPosition">, startPosition: number) {
  // time-based so two processes sharing the state file never hand out the same id (real hl tids are unique)
  const tid = Date.now() * 1000 + (s.nextTid++ % 1000);
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
  if (open > 0 && r < 0.4) {
    const p = positions[Math.floor(rand(`${a}:${bucket}:which`) * open)];
    const px = priceAt(p.coin, now);
    const liq = rand(`${a}:${bucket}:liq`) < 0.08;
    applyTrade(s, a, p.coin, -p.szi, liq ? px * (p.szi > 0 ? 0.985 : 1.015) : px, p.leverage, { liquidation: liq });
  } else if (open < 3 && r > 0.55) {
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

/** fill resting limit orders that cross, fire triggers, and advance twaps for an address */
function settle(s: MockState, address: string) {
  const a = address.toLowerCase();
  const now = Date.now();
  const orders = (s.orders ??= {})[a] ?? [];
  const history = ((s.history ??= {})[a] ??= []);
  const keep: MockOrder[] = [];
  for (const o of orders) {
    const px = priceAt(o.coin, now);
    const dir = o.side === "B" ? 1 : -1;
    if (o.isTrigger) {
      const fired = o.tpsl === "sl" ? (o.side === "A" ? px <= o.triggerPx : px >= o.triggerPx) : o.side === "A" ? px >= o.triggerPx : px <= o.triggerPx;
      if (!fired) {
        keep.push(o);
        continue;
      }
      if (o.isMarket) {
        fillOrder(s, a, o, px);
        history.push({ order: o, status: "filled", statusTimestamp: now });
      } else {
        keep.push({ ...o, isTrigger: false });
      }
      continue;
    }
    const crosses = dir === 1 ? px <= o.limitPx : px >= o.limitPx;
    if (crosses) {
      fillOrder(s, a, o, o.limitPx);
      history.push({ order: o, status: "filled", statusTimestamp: now });
    } else keep.push(o);
  }
  s.orders[a] = keep;
  // twaps: one slice per 30s
  for (const t of (s.twaps ??= {})[a] ?? []) {
    if (t.status !== "activated") continue;
    const slices = Math.max(1, Math.round((t.minutes * 60) / 30));
    const per = t.sz / slices;
    while (now - t.lastSlice >= 30_000 && t.executedSz < t.sz - 1e-12) {
      const px = priceAt(t.coin, t.lastSlice + 30_000);
      const sz = Math.min(per, t.sz - t.executedSz);
      applyTrade(s, a, t.coin, t.side === "B" ? sz : -sz, px, t.leverage);
      t.executedSz += sz;
      t.executedNtl += sz * px;
      t.lastSlice += 30_000;
    }
    if (t.executedSz >= t.sz - 1e-12) t.status = "finished";
  }
}

function fillOrder(s: MockState, a: string, o: MockOrder, px: number) {
  const existing = (s.positions[a] ?? []).find((p) => p.coin === o.coin);
  let delta = o.side === "B" ? o.sz : -o.sz;
  if (o.reduceOnly) {
    if (!existing || Math.sign(existing.szi) === Math.sign(delta)) return;
    delta = Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(existing.szi));
  }
  applyTrade(s, a, o.coin, delta, px, o.leverage, { builderFee: (Math.abs(delta) * px * 50) / 100_000 });
}

export async function clearinghouseState(address: string, dex = ""): Promise<HlClearinghouseState> {
  const a = address.toLowerCase();
  return withState((s) => {
    tick(s, a);
    settle(s, a);
    const now = Date.now();
    const onDex = (coin: string) => (dex ? coin.startsWith(`${dex}:`) : !coin.includes(":"));
    const positions: HlPosition[] = (s.positions[a] ?? []).filter((p) => onDex(p.coin)).map((p) => {
      const mark = priceAt(p.coin, now);
      const value = Math.abs(p.szi) * mark;
      const upnl = (mark - p.entryPx) * p.szi;
      const margin = value / p.leverage;
      return {
        coin: p.coin,
        szi: String(p.szi),
        leverage: { type: ((s.leverage ?? {})[`${a}:${p.coin}:mode`] ?? 1) === 0 ? "isolated" : "cross", value: p.leverage, rawUsd: String(value / p.leverage) } as HlPosition["leverage"],
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
    const base = 1000 + (hash32(a) % 50_000) + ((s.deposits ?? {})[a] ?? 0);
    const accountValue = base + positions.reduce((acc, p) => acc + Number(p.unrealizedPnl), 0);
    return {
      marginSummary: {
        accountValue: String(accountValue),
        totalNtlPos: String(totalNtl),
        totalRawUsd: String(accountValue),
        totalMarginUsed: String(margin),
      },
      crossMaintenanceMarginUsed: String(positions.reduce((acc, p) => acc + Number(p.positionValue) / (2 * Math.max(1, p.maxLeverage)), 0)),
      withdrawable: String(Math.max(0, accountValue - margin)),
      assetPositions: positions.map((p) => ({ type: "oneWay", position: p })),
      time: now,
    };
  });
}

export async function userFillsRange(address: string, startTime: number, endTime?: number): Promise<HlFill[]> {
  const a = address.toLowerCase();
  return withState((s) => (s.fills[a] ?? []).filter((f) => f.time >= startTime && (endTime === undefined || f.time <= endTime)).sort((x, y) => x.time - y.time).slice(0, 2000));
}

export async function userFills(address: string, since?: number): Promise<HlFill[]> {
  const a = address.toLowerCase();
  return withState((s) => {
    tick(s, a);
    settle(s, a);
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
    accountValue: String(150_000 * (i + 1)),
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

export async function portfolio(address: string) {
  const i = Math.max(0, MOCK_TRADERS.findIndex((a) => a.toLowerCase() === address.toLowerCase()));
  const now = Date.now();
  const win = (days: number, pnl: number, vlm: number) => ({
    accountValueHistory: [[now - days * 864e5, String(150_000 * (i + 1) - pnl)], [now, String(150_000 * (i + 1))]] as [number, string][],
    pnlHistory: [[now - days * 864e5, "0"], [now, String(pnl)]] as [number, string][],
    vlm: String(vlm),
  });
  return { day: win(1, 1000 - i * 50, 100_000), week: win(7, 5000 - i * 200, 500_000), month: win(30, 20000 - i * 500, 2_000_000), allTime: win(365, 100000 - i * 1000, 9_000_000) };
}

// ---------- mock exchange (write side, used by the trade route when HL_MOCK) ----------

/** mock spot balances (what a Unit deposit credits) */
export async function spotBalances(address: string): Promise<{ coin: string; total: number; hold: number }[]> {
  const a = address.toLowerCase();
  return withState((s) => Object.entries((s.spot ?? {})[a] ?? {}).map(([coin, total]) => ({ coin, total, hold: 0 })));
}

/** mock spot token registry */
export async function spotTokens(): Promise<Record<string, { name: string; tokenId: `0x${string}`; index: number; szDecimals: number; weiDecimals: number }>> {
  const mk = (name: string, index: number, szDecimals: number, weiDecimals: number) => ({ name, tokenId: `0x${index.toString(16).padStart(32, "0")}` as `0x${string}`, index, szDecimals, weiDecimals });
  return { USDC: mk("USDC", 0, 2, 8), USOL: mk("USOL", 1, 2, 9), UBTC: mk("UBTC", 2, 5, 8), UETH: mk("UETH", 3, 4, 9) };
}

/** mock spot pairs: every mock token is quoted in USDC at pair index = token index */
export async function spotPair(base: string) {
  const t = (await spotTokens())[base];
  if (!t || base === "USDC") return null;
  return { assetId: 10000 + t.index, name: `${base}/USDC`, base, szDecimals: t.szDecimals, pairIndex: t.index };
}

/** mock spot market sell: the coin goes, USDC at the perps mid of the same asset (minus the spot taker fee) arrives in spot */
export async function mockSpotSell(user: string, coin: string, sz: number): Promise<{ avgPx: number; totalSz: number; usdc: number }> {
  const perp = coin.startsWith("U") ? coin.slice(1) : coin;
  const px = priceAt(perp, Date.now());
  if (!Number.isFinite(px) || px <= 0) throw new Error(`no mock price for ${coin}`);
  return withState((s) => {
    const all = (s.spot ??= {});
    const mine = (all[user.toLowerCase()] ??= {});
    if ((mine[coin] ?? 0) + 1e-12 < sz) throw new Error(`insufficient ${coin}`);
    mine[coin] = Math.max(0, mine[coin] - sz);
    const usdc = sz * px * (1 - 0.0007);
    mine.USDC = (mine.USDC ?? 0) + usdc;
    return { avgPx: px, totalSz: sz, usdc };
  });
}

/** mock usdClassTransfer: USDC between the spot balance and the perps balance */
export async function mockClassTransfer(user: string, amount: number, toPerp: boolean) {
  withState((s) => {
    const a = user.toLowerCase();
    const all = (s.spot ??= {});
    const mine = (all[a] ??= {});
    const d = (s.deposits ??= {});
    if (toPerp) {
      if ((mine.USDC ?? 0) + 1e-9 < amount) throw new Error("insufficient spot USDC");
      mine.USDC = Math.max(0, (mine.USDC ?? 0) - amount);
      d[a] = (d[a] ?? 0) + amount;
    } else {
      d[a] = (d[a] ?? 0) - amount;
      mine.USDC = (mine.USDC ?? 0) + amount;
    }
  });
}

/** mock native-asset arrival (positive) or withdrawal (negative) of a spot coin */
export async function mockSpotDeposit(user: string, coin: string, amount: number) {
  withState((s) => {
    const all = (s.spot ??= {});
    const mine = (all[user.toLowerCase()] ??= {});
    if ((mine[coin] ?? 0) + amount < -1e-9) throw new Error(`insufficient ${coin}`);
    mine[coin] = Math.max(0, (mine[coin] ?? 0) + amount);
  });
}

/** mock deposit (positive) or withdrawal (negative) */
export async function mockFunds(user: string, delta: number) {
  withState((s) => {
    const d = (s.deposits ??= {});
    const a = user.toLowerCase();
    d[a] = (d[a] ?? 0) + delta;
  });
}

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

export type MockOrderInput = {
  user: string;
  coin: string;
  isBuy: boolean;
  sz: number;
  leverage: number;
  builderFeeTenthsBp: number;
  reduceOnly?: boolean;
  limitPx?: number;
  tif?: "Gtc" | "Ioc" | "Alo";
  trigger?: { triggerPx: number; isMarket: boolean; tpsl: "tp" | "sl" };
  isPositionTpsl?: boolean;
};

export type MockOrderResult = { status: "filled"; filledPx: number; totalSz: number; oid: number } | { status: "resting"; oid: number } | { status: "err"; error: string };

export async function mockPlaceOrder(args: MockOrderInput): Promise<MockOrderResult> {
  const u = UNIVERSE.find((x) => x.name === args.coin);
  if (!u) return { status: "err", error: `unknown coin ${args.coin}` };
  return withState((s) => {
    const a = args.user.toLowerCase();
    settle(s, a);
    const oid = (s.nextOid = (s.nextOid ?? 1000) + 1);
    const mid = priceAt(args.coin, Date.now());
    const side: "B" | "A" = args.isBuy ? "B" : "A";
    const base: MockOrder = {
      oid,
      coin: args.coin,
      side,
      limitPx: args.limitPx ?? mid,
      sz: args.sz,
      origSz: args.sz,
      reduceOnly: !!args.reduceOnly,
      isTrigger: !!args.trigger,
      triggerPx: args.trigger?.triggerPx ?? 0,
      tpsl: args.trigger?.tpsl ?? null,
      isMarket: args.trigger?.isMarket ?? !args.limitPx,
      tif: args.tif ?? (args.limitPx ? "Gtc" : "Ioc"),
      timestamp: Date.now(),
      isPositionTpsl: !!args.isPositionTpsl,
      leverage: args.leverage,
    };
    const history = ((s.history ??= {})[a] ??= []);
    const rest = () => {
      ((s.orders ??= {})[a] ??= []).push(base);
      return { status: "resting", oid } as const;
    };
    if (args.trigger) return rest();
    const px = args.limitPx !== undefined ? args.limitPx : mid * (args.isBuy ? 1.0003 : 0.9997);
    const crosses = args.limitPx === undefined || (args.isBuy ? args.limitPx >= mid : args.limitPx <= mid);
    if (!crosses) {
      if (args.tif === "Ioc") {
        history.push({ order: base, status: "canceled", statusTimestamp: Date.now() });
        return { status: "err", error: "ioc order could not match" };
      }
      return rest();
    }
    if (args.tif === "Alo") {
      history.push({ order: base, status: "badAloPxRejected", statusTimestamp: Date.now() });
      return { status: "err", error: "post only order would cross the book" };
    }
    const existing = (s.positions[a] ?? []).find((p) => p.coin === args.coin);
    let delta = args.isBuy ? args.sz : -args.sz;
    if (args.reduceOnly) {
      if (!existing || Math.sign(existing.szi) === Math.sign(delta)) return { status: "err", error: "reduce only: nothing to reduce" };
      delta = Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(existing.szi));
    }
    const fillPx = args.limitPx !== undefined ? mid : px;
    const builderFee = (Math.abs(delta) * fillPx * args.builderFeeTenthsBp) / 100_000;
    applyTrade(s, a, args.coin, delta, fillPx, args.leverage, { builderFee });
    history.push({ order: base, status: "filled", statusTimestamp: Date.now() });
    return { status: "filled", filledPx: fillPx, totalSz: Math.abs(delta), oid };
  });
}

export async function mockCancel(user: string, oids: number[]) {
  withState((s) => {
    const a = user.toLowerCase();
    const list = (s.orders ??= {})[a] ?? [];
    const history = ((s.history ??= {})[a] ??= []);
    s.orders[a] = list.filter((o) => {
      if (!oids.includes(o.oid)) return true;
      history.push({ order: o, status: "canceled", statusTimestamp: Date.now() });
      return false;
    });
  });
}

export async function mockSetLeverage(user: string, coin: string, leverage: number, isCross: boolean) {
  withState((s) => {
    const a = user.toLowerCase();
    (s.leverage ??= {})[`${a}:${coin}`] = leverage;
    s.leverage[`${a}:${coin}:mode`] = isCross ? 1 : 0;
    for (const p of s.positions[a] ?? []) if (p.coin === coin) p.leverage = leverage;
  });
}

export async function mockTwap(user: string, coin: string, isBuy: boolean, sz: number, minutes: number, reduceOnly: boolean, randomize: boolean, leverage: number): Promise<number> {
  return withState((s) => {
    const a = user.toLowerCase();
    const twapId = (s.nextOid = (s.nextOid ?? 1000) + 1);
    ((s.twaps ??= {})[a] ??= []).push({ twapId, coin, side: isBuy ? "B" : "A", sz, executedSz: 0, executedNtl: 0, minutes, reduceOnly, randomize, timestamp: Date.now(), lastSlice: Date.now(), status: "activated", leverage });
    return twapId;
  });
}

export async function mockTwapCancel(user: string, twapId: number) {
  withState((s) => {
    for (const t of (s.twaps ??= {})[user.toLowerCase()] ?? []) if (t.twapId === twapId && t.status === "activated") t.status = "terminated";
  });
}

function toOpenOrder(o: MockOrder): HlOpenOrder {
  return {
    coin: o.coin,
    side: o.side,
    limitPx: String(o.limitPx),
    sz: String(o.sz),
    oid: o.oid,
    timestamp: o.timestamp,
    origSz: String(o.origSz),
    triggerCondition: o.isTrigger ? `${o.side === "B" ? "Price above" : "Price below"} ${o.triggerPx}` : "N/A",
    isTrigger: o.isTrigger,
    triggerPx: String(o.triggerPx),
    children: [],
    isPositionTpsl: o.isPositionTpsl,
    reduceOnly: o.reduceOnly,
    orderType: o.isTrigger ? (o.tpsl === "tp" ? (o.isMarket ? "Take Profit Market" : "Take Profit Limit") : o.isMarket ? "Stop Market" : "Stop Limit") : o.isMarket ? "Market" : "Limit",
    tif: o.isTrigger ? null : o.tif,
    cloid: null,
  };
}

export async function openOrders(address: string): Promise<HlOpenOrder[]> {
  return withState((s) => {
    settle(s, address);
    return ((s.orders ?? {})[address.toLowerCase()] ?? []).map(toOpenOrder);
  });
}

export async function historicalOrders(address: string): Promise<HlHistoricalOrder[]> {
  return withState((s) => {
    settle(s, address);
    return [...((s.history ?? {})[address.toLowerCase()] ?? [])].reverse().slice(0, 100).map((h) => ({ order: toOpenOrder(h.order), status: h.status, statusTimestamp: h.statusTimestamp }));
  });
}

export async function twapHistory(address: string): Promise<HlTwap[]> {
  return withState((s) => {
    settle(s, address);
    return [...((s.twaps ?? {})[address.toLowerCase()] ?? [])].reverse().map((t) => ({
      time: t.timestamp,
      twapId: t.twapId,
      state: { coin: t.coin, executedNtl: String(t.executedNtl), executedSz: String(t.executedSz), minutes: t.minutes, reduceOnly: t.reduceOnly, randomize: t.randomize, side: t.side, sz: String(t.sz), timestamp: t.timestamp, user: address },
      status: { status: t.status },
    }));
  });
}

export async function userFunding(address: string, startTime: number): Promise<HlFundingPayment[]> {
  const s = load();
  const a = address.toLowerCase();
  const out: HlFundingPayment[] = [];
  const hour = 3_600_000;
  for (const p of s.positions[a] ?? []) {
    for (let t = Math.ceil(Math.max(startTime, p.openedAt) / hour) * hour; t <= Date.now(); t += hour) {
      const rate = (rand(`${p.coin}:f:${t}`) - 0.4) * 0.0002;
      out.push({ time: t, hash: `0x${t.toString(16).padStart(64, "0")}`, delta: { type: "funding", coin: p.coin, usdc: String(-p.szi * priceAt(p.coin, t) * rate), szi: String(p.szi), fundingRate: String(rate) } });
    }
  }
  return out.sort((x, y) => y.time - x.time);
}

export async function fundingHistory(coin: string, startTime: number): Promise<HlFundingRate[]> {
  const out: HlFundingRate[] = [];
  const hour = 3_600_000;
  for (let t = Math.ceil(startTime / hour) * hour; t <= Date.now(); t += hour) {
    const rate = (rand(`${coin}:f:${t}`) - 0.4) * 0.0002;
    out.push({ coin, fundingRate: String(rate), premium: String(rate * 0.8), time: t });
  }
  return out;
}

export async function l2Book(coin: string): Promise<HlL2Book> {
  const u = UNIVERSE.find((x) => x.name === coin);
  const now = Date.now();
  const mid = priceAt(coin, now);
  const tick = mid > 1 ? Math.min(Math.pow(10, Math.floor(Math.log10(mid)) - 4), 1) : Math.pow(10, Math.floor(Math.log10(mid)) - 4);
  const bucket = Math.floor(now / 1000);
  const mk = (i: number, side: "b" | "a"): HlBookLevel => {
    const px = side === "b" ? mid - tick * (i + 1) : mid + tick * (i + 1);
    const sz = (0.2 + rand(`${coin}:${side}:${i}:${bucket}`) * 3) * (1 + i / 6) * (mid > 1000 ? 1 : mid > 10 ? 40 : 4000);
    return { px: String(Number(px.toPrecision(6))), sz: String(Number(sz.toFixed(u?.szDecimals ?? 2))), n: 1 + Math.floor(rand(`${coin}:${side}:${i}:n:${bucket}`) * 8) };
  };
  return { coin, time: now, levels: [Array.from({ length: 20 }, (_, i) => mk(i, "b")), Array.from({ length: 20 }, (_, i) => mk(i, "a"))] };
}

export async function recentTrades(coin: string): Promise<HlRecentTrade[]> {
  const now = Date.now();
  const out: HlRecentTrade[] = [];
  for (let i = 0; i < 40; i++) {
    const t = now - i * 2500 - Math.floor(rand(`${coin}:rt:${i}:${Math.floor(now / 10_000)}`) * 2000);
    const px = priceAt(coin, t) * (1 + (rand(`${coin}:rp:${i}`) - 0.5) * 0.0004);
    const sz = (0.01 + rand(`${coin}:rs:${i}`) * 0.6) * (px > 1000 ? 1 : px > 10 ? 40 : 4000);
    out.push({ coin, side: rand(`${coin}:rside:${i}:${Math.floor(t / 5000)}`) > 0.5 ? "B" : "A", px: String(Number(px.toPrecision(6))), sz: String(Number(sz.toFixed(3))), time: t, hash: `0x${i.toString(16).padStart(64, "0")}`, tid: 10_000_000 + i });
  }
  return out;
}
