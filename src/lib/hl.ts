/**
 * hyperliquid read layer. all public info endpoints, no auth.
 * - testnet toggle via NEXT_PUBLIC_HL_TESTNET=true
 * - HL_MOCK=true swaps in a synthetic in-process exchange for offline dev
 */
import * as hl from "@nktkas/hyperliquid";
import { HL_LEADERBOARD_URL, HL_MOCK, IS_TESTNET } from "./env";
import type {
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

// ---------- leaderboard (stats endpoint, not part of the info api) ----------

export async function leaderboard(): Promise<HlLeaderboardRow[]> {
  if (HL_MOCK) return mock.leaderboard();
  const res = await fetch(HL_LEADERBOARD_URL, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  const json = (await res.json()) as { leaderboardRows: HlLeaderboardRow[] };
  return json.leaderboardRows;
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

export function formatSz(sz: number, szDecimals: number): string {
  const f = Math.pow(10, szDecimals);
  return String(Math.floor(sz * f) / f);
}
