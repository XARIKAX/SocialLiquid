/**
 * hyperliquid read layer. all public info endpoints, no auth.
 * - mainnet by default; NEXT_PUBLIC_HL_NETWORK=testnet for local development
 * - HL_MOCK=true swaps in a synthetic in-process exchange for offline dev
 */
import * as hl from "@nktkas/hyperliquid";
import { HL_LEADERBOARD_URL, HL_MOCK, IS_TESTNET } from "./env";
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
  MarketSummary,
} from "./hl-types";
import * as mock from "./hl-mock";

let _transport: hl.HttpTransport | undefined;
let _info: hl.InfoClient | undefined;

export function transport(): hl.HttpTransport {
  return (_transport ??= new hl.HttpTransport({ isTestnet: IS_TESTNET, timeout: 15_000 }));
}

export function info(): hl.InfoClient {
  return (_info ??= new hl.InfoClient({ transport: transport() }));
}

/** request weights from the published rate limit table (1200 weight / min / ip) */
export const WEIGHT = {
  allMids: 2,
  clearinghouseState: 2,
  l2Book: 2,
  recentTrades: 20,
  meta: 20,
  metaAndAssetCtxs: 20,
  userFills: 20,
  candleSnapshot: 20,
  maxBuilderFee: 20,
  extraAgents: 20,
} as const;

// ---------- meta / markets ----------

let metaCache: { at: number; value: HlMeta } | undefined;

export async function meta(): Promise<HlMeta> {
  if (HL_MOCK) return mock.meta();
  if (metaCache && Date.now() - metaCache.at < 5 * 60_000) return metaCache.value;
  const m = (await info().meta()) as unknown as HlMeta;
  metaCache = { at: Date.now(), value: m };
  return m;
}

/** asset index for the order endpoint (position in meta.universe) */
export async function assetIndex(coin: string): Promise<number> {
  const m = await meta();
  const i = m.universe.findIndex((a) => a.name === coin);
  if (i < 0) throw new Error(`unknown coin ${coin}`);
  return i;
}

export async function metaAndAssetCtxs(): Promise<[HlMeta, HlAssetCtx[]]> {
  if (HL_MOCK) return mock.metaAndAssetCtxs();
  return (await info().metaAndAssetCtxs()) as unknown as [HlMeta, HlAssetCtx[]];
}

let marketsCache: { at: number; value: MarketSummary[] } | undefined;

/** all perps with derived 24h stats. cached 10s server side. */
export async function markets(): Promise<MarketSummary[]> {
  if (marketsCache && Date.now() - marketsCache.at < 10_000) return marketsCache.value;
  const [m, ctxs] = await metaAndAssetCtxs();
  const out: MarketSummary[] = m.universe
    .map((a, i) => {
      const c = ctxs[i];
      if (!c || a.isDelisted) return null;
      const markPx = Number(c.markPx);
      const prevDayPx = Number(c.prevDayPx);
      return {
        coin: a.name,
        szDecimals: a.szDecimals,
        maxLeverage: a.maxLeverage,
        markPx,
        midPx: c.midPx ? Number(c.midPx) : markPx,
        prevDayPx,
        change24h: prevDayPx > 0 ? (markPx - prevDayPx) / prevDayPx : 0,
        volume24h: Number(c.dayNtlVlm),
        openInterestUsd: Number(c.openInterest) * markPx,
        funding: Number(c.funding),
        oraclePx: Number(c.oraclePx),
      } satisfies MarketSummary;
    })
    .filter((x): x is MarketSummary => x !== null);
  marketsCache = { at: Date.now(), value: out };
  return out;
}

/** default market ordering: BTC, ETH, SOL, HYPE, then by 24h volume */
export function sortMarkets(list: MarketSummary[]): MarketSummary[] {
  const pinned = ["BTC", "ETH", "SOL", "HYPE"];
  const head = pinned.map((c) => list.find((m) => m.coin === c)).filter((m): m is MarketSummary => !!m);
  const tail = list.filter((m) => !pinned.includes(m.coin)).sort((a, b) => b.volume24h - a.volume24h);
  return [...head, ...tail];
}

export async function allMids(): Promise<HlAllMids> {
  if (HL_MOCK) return mock.allMids();
  return (await info().allMids()) as HlAllMids;
}

// ---------- per-address reads ----------

export async function clearinghouseState(address: string): Promise<HlClearinghouseState> {
  if (HL_MOCK) return mock.clearinghouseState(address);
  return (await info().clearinghouseState({ user: address as `0x${string}` })) as unknown as HlClearinghouseState;
}

export type SpotToken = { name: string; tokenId: `0x${string}`; index: number; szDecimals: number; weiDecimals: number };
let _tokens: { at: number; map: Record<string, SpotToken> } | null = null;
/** spot token registry (name → tokenId etc.), the "NAME:tokenId" half of a spotSend. cached 10 min. */
export async function spotTokens(): Promise<Record<string, SpotToken>> {
  if (HL_MOCK) return mock.spotTokens();
  if (_tokens && Date.now() - _tokens.at < 10 * 60_000) return _tokens.map;
  const m = await info().spotMeta();
  const map: Record<string, SpotToken> = {};
  for (const t of m.tokens) map[t.name] = { name: t.name, tokenId: t.tokenId, index: t.index, szDecimals: t.szDecimals, weiDecimals: t.weiDecimals };
  _tokens = { at: Date.now(), map };
  return map;
}

export type SpotPair = { assetId: number; name: string; base: string; szDecimals: number; pairIndex: number };
/** the USDC-quoted spot pair for a spot coin (USOL → USOL/USDC): asset id for orders is 10000 + pair index */
export async function spotPair(base: string): Promise<SpotPair | null> {
  if (HL_MOCK) return mock.spotPair(base);
  const m = await info().spotMeta();
  const tok = m.tokens.find((t) => t.name === base);
  if (!tok) return null;
  const pair = m.universe.find((u) => u.tokens[0] === tok.index && u.tokens[1] === 0);
  if (!pair) return null;
  return { assetId: 10000 + pair.index, name: pair.name, base, szDecimals: tok.szDecimals, pairIndex: pair.index };
}

/** spot prices: 5 significant figures, at most 8 - szDecimals decimals */
export function formatSpotPx(px: number, szDecimals: number): string {
  const maxDecimals = Math.max(0, 8 - szDecimals);
  return String(Number(Number(px.toPrecision(5)).toFixed(maxDecimals)));
}

/** spot balances (where native deposits through Unit land): coin, total, amount on hold in orders */
export async function spotBalances(address: string): Promise<{ coin: string; total: number; hold: number }[]> {
  if (HL_MOCK) return mock.spotBalances(address);
  const st = await info().spotClearinghouseState({ user: address as `0x${string}` });
  return st.balances.filter((b) => Number(b.total) > 0).map((b) => ({ coin: b.coin, total: Number(b.total), hold: Number(b.hold) }));
}

/** most recent fills (api returns up to 2000). pass `since` to fetch by time window instead. */
export async function userFills(address: string, since?: number): Promise<HlFill[]> {
  if (HL_MOCK) return mock.userFills(address, since);
  if (since !== undefined) {
    return (await info().userFillsByTime({
      user: address as `0x${string}`,
      startTime: since,
      aggregateByTime: true,
    })) as unknown as HlFill[];
  }
  return (await info().userFills({ user: address as `0x${string}`, aggregateByTime: true })) as unknown as HlFill[];
}

export async function candleSnapshot(
  coin: string,
  interval: HlCandleInterval,
  startTime: number,
  endTime: number = Date.now(),
): Promise<HlCandle[]> {
  if (HL_MOCK) return mock.candleSnapshot(coin, interval, startTime, endTime);
  return (await info().candleSnapshot({ coin, interval, startTime, endTime })) as unknown as HlCandle[];
}

/** builder fee the user has approved for `builder`, in tenths of a basis point. 0 = not approved. */
export async function maxBuilderFee(user: string, builder: string): Promise<number> {
  if (HL_MOCK) return mock.maxBuilderFee(user, builder);
  return await info().maxBuilderFee({ user: user as `0x${string}`, builder: builder as `0x${string}` });
}

export async function extraAgents(user: string): Promise<{ address: string; name: string; validUntil: number | null }[]> {
  if (HL_MOCK) return mock.extraAgents(user);
  return (await info().extraAgents({ user: user as `0x${string}` })) as { address: string; name: string; validUntil: number | null }[];
}

// ---------- market microstructure (short caches so every viewer shares one upstream call) ----------

const tiny = new Map<string, { at: number; p: Promise<unknown> }>();
function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = tiny.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = fn().catch((e) => {
    tiny.delete(key);
    throw e;
  });
  tiny.set(key, { at: Date.now(), p });
  return p;
}

export async function l2Book(coin: string, nSigFigs?: 2 | 3 | 4 | 5): Promise<HlL2Book> {
  return cached(`book:${coin}:${nSigFigs ?? ""}`, 500, async () => {
    if (HL_MOCK) return mock.l2Book(coin);
    const r = (await info().l2Book({ coin, nSigFigs })) as unknown as HlL2Book | null;
    if (!r) return { coin, time: Date.now(), levels: [[], []] as [HlBookLevel[], HlBookLevel[]] };
    return r;
  });
}

export async function recentTrades(coin: string): Promise<HlRecentTrade[]> {
  return cached(`trades:${coin}`, 1000, async () => {
    if (HL_MOCK) return mock.recentTrades(coin);
    return (await info().recentTrades({ coin })) as unknown as HlRecentTrade[];
  });
}

export async function fundingHistory(coin: string, startTime: number): Promise<HlFundingRate[]> {
  return cached(`funding:${coin}:${Math.floor(startTime / 600_000)}`, 60_000, async () => {
    if (HL_MOCK) return mock.fundingHistory(coin, startTime);
    return (await info().fundingHistory({ coin, startTime })) as unknown as HlFundingRate[];
  });
}

// ---------- per-account reads (authenticated users only; no cache) ----------

export async function openOrders(address: string): Promise<HlOpenOrder[]> {
  if (HL_MOCK) return mock.openOrders(address);
  return (await info().frontendOpenOrders({ user: address as `0x${string}` })) as unknown as HlOpenOrder[];
}

export async function historicalOrders(address: string): Promise<HlHistoricalOrder[]> {
  if (HL_MOCK) return mock.historicalOrders(address);
  return (await info().historicalOrders({ user: address as `0x${string}` })) as unknown as HlHistoricalOrder[];
}

export async function userFunding(address: string, startTime: number): Promise<HlFundingPayment[]> {
  if (HL_MOCK) return mock.userFunding(address, startTime);
  return (await info().userFunding({ user: address as `0x${string}`, startTime })) as unknown as HlFundingPayment[];
}

export async function twapHistory(address: string): Promise<HlTwap[]> {
  if (HL_MOCK) return mock.twapHistory(address);
  return (await info().twapHistory({ user: address as `0x${string}` })) as unknown as HlTwap[];
}

// ---------- leaderboard (stats endpoint, not part of the info api) ----------

export async function leaderboard(): Promise<HlLeaderboardRow[]> {
  if (HL_MOCK) return mock.leaderboard();
  // the file is tens of megabytes; give it time but never hang a request forever
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const res = await fetch(HL_LEADERBOARD_URL, { headers: { accept: "application/json" }, cache: "no-store", signal: ctl.signal });
    if (!res.ok) throw new Error(`leaderboard feed ${res.status}`);
    const json = (await res.json()) as { leaderboardRows: HlLeaderboardRow[] };
    if (!Array.isArray(json.leaderboardRows)) throw new Error("leaderboard feed: unexpected shape");
    return json.leaderboardRows;
  } finally {
    clearTimeout(timer);
  }
}

const vaultCache = new Map<string, boolean>();
/** true when the address is a vault (vaults are listed in the leaderboard feed but hidden on hyperliquid's leaderboard page) */
export async function isVault(address: string): Promise<boolean> {
  const a = address.toLowerCase();
  const hit = vaultCache.get(a);
  if (hit !== undefined) return hit;
  let v = false;
  if (!HL_MOCK) {
    try {
      v = (await info().vaultDetails({ vaultAddress: a as `0x${string}` })) !== null;
    } catch {
      v = false;
    }
  }
  vaultCache.set(a, v);
  return v;
}

export type HlPortfolioWindow = { accountValueHistory: [number, string][]; pnlHistory: [number, string][]; vlm: string };
/** per-user pnl / account value / volume by window. this is the data hyperliquid's own leaderboard is built from. weight 2. */
export async function portfolio(address: string): Promise<Record<string, HlPortfolioWindow>> {
  if (HL_MOCK) return mock.portfolio(address);
  const res = await info().portfolio({ user: address as `0x${string}` });
  return Object.fromEntries(res.map(([k, v]) => [k, v as HlPortfolioWindow]));
}

export function leaderboardPnl(row: HlLeaderboardRow, window: "day" | "week" | "month" | "allTime"): number {
  const w = row.windowPerformances.find(([k]) => k === window);
  return w ? Number(w[1].pnl) : 0;
}

// ---------- helpers ----------

export function sideOf(szi: string | number): "LONG" | "SHORT" {
  return Number(szi) >= 0 ? "LONG" : "SHORT";
}

/** format a price to hyperliquid's tick rules: max 5 significant figures, max (6 - szDecimals) decimals for perps */
export function formatPx(px: number, szDecimals: number): string {
  const maxDecimals = Math.max(0, 6 - szDecimals);
  let s = Number(px.toPrecision(5));
  const fixed = s.toFixed(maxDecimals);
  s = Number(fixed);
  // strip trailing zeros
  return String(s);
}

export function formatSz(sz: number, szDecimals: number, mode: "floor" | "ceil" | "round" = "floor"): string {
  const f = Math.pow(10, szDecimals);
  const fn = mode === "ceil" ? Math.ceil : mode === "round" ? Math.round : Math.floor;
  return String(fn(sz * f - (mode === "ceil" ? 1e-9 : 0)) / f);
}

/** smallest price increment hyperliquid accepts at this price: 5 significant figures, integers always allowed */
export function tickFor(px: number): number {
  if (!(px > 0)) return 0.01;
  const t = Math.pow(10, Math.floor(Math.log10(px)) - 4);
  return Math.min(t, 1) === t ? Number(t.toPrecision(1)) : 1;
}
