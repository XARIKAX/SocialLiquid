import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * protocol stats, defillama-style: what flows through socialLiquid, bucketed by day / week / month.
 * volume, fees and trades come from the fills of claimed accounts (people who trade through the terminal);
 * fees are the builder fees those fills carried. copies, theses and new traders come from our own tables.
 */
export type StatsBucket = "day" | "week" | "month";
export type StatsRange = "30d" | "90d" | "1y" | "all";
export type StatsMetric = "volume" | "fees" | "trades" | "traders" | "copies" | "theses" | "newTraders";
export const METRICS: { key: StatsMetric; label: string; unit: "usd" | "count"; desc: string }[] = [
  { key: "volume", label: "Perp volume", unit: "usd", desc: "notional traded by socialLiquid accounts" },
  { key: "fees", label: "Fees", unit: "usd", desc: "builder fees paid on those trades" },
  { key: "trades", label: "Trades", unit: "count", desc: "fills by socialLiquid accounts" },
  { key: "traders", label: "Active traders", unit: "count", desc: "distinct accounts that traded" },
  { key: "copies", label: "Copies", unit: "count", desc: "positions opened with the Copy button" },
  { key: "theses", label: "Theses", unit: "count", desc: "theses posted" },
  { key: "newTraders", label: "New traders", unit: "count", desc: "wallets that signed in for the first time" },
];

export type StatsPoint = { t: string } & Record<StatsMetric, number>;
export type Stats = {
  range: StatsRange;
  bucket: StatsBucket;
  series: StatsPoint[];
  /** last 30 days, the 30 before that, and all time */
  totals: { d30: Record<StatsMetric, number>; prev30: Record<StatsMetric, number>; all: Record<StatsMetric, number> };
  /** share of builder fees the protocol keeps today (the rest is earmarked for key holders once payouts are live) */
  revenueShare: number;
  at: string;
};

const EMPTY = (): Record<StatsMetric, number> => ({ volume: 0, fees: 0, trades: 0, traders: 0, copies: 0, theses: 0, newTraders: 0 });
const cache = new Map<string, { at: number; value: Stats }>();

type Row = { d: Date; volume: number | string | null; fees: number | string | null; trades: number | string | bigint | null; traders: number | string | bigint | null };
type CountRow = { d: Date; n: number | string | bigint };
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

async function bucketed(bucket: StatsBucket, since: Date | null) {
  const sinceSql = since ? Prisma.sql`AND f.time >= ${since}` : Prisma.empty;
  const fills = await prisma.$queryRaw<Row[]>`
    SELECT date_trunc(${bucket}, f.time) AS d,
           SUM(f.px * f.sz) AS volume,
           SUM(COALESCE(f."builderFee", 0)) AS fees,
           COUNT(*) AS trades,
           COUNT(DISTINCT f.address) AS traders
    FROM "Fill" f
    JOIN "User" u ON u.address = f.address AND u."claimedAt" IS NOT NULL
    WHERE TRUE ${sinceSql}
    GROUP BY 1 ORDER BY 1`;
  const copies = await prisma.$queryRaw<CountRow[]>`
    SELECT date_trunc(${bucket}, p."openedAt") AS d, COUNT(*) AS n FROM "Position" p
    WHERE p."copiedFromPositionId" IS NOT NULL ${since ? Prisma.sql`AND p."openedAt" >= ${since}` : Prisma.empty}
    GROUP BY 1 ORDER BY 1`;
  const theses = await prisma.$queryRaw<CountRow[]>`
    SELECT date_trunc(${bucket}, t."createdAt") AS d, COUNT(*) AS n FROM "Thesis" t
    WHERE TRUE ${since ? Prisma.sql`AND t."createdAt" >= ${since}` : Prisma.empty}
    GROUP BY 1 ORDER BY 1`;
  const users = await prisma.$queryRaw<CountRow[]>`
    SELECT date_trunc(${bucket}, u."claimedAt") AS d, COUNT(*) AS n FROM "User" u
    WHERE u."claimedAt" IS NOT NULL ${since ? Prisma.sql`AND u."claimedAt" >= ${since}` : Prisma.empty}
    GROUP BY 1 ORDER BY 1`;
  const map = new Map<string, StatsPoint>();
  const get = (d: Date) => {
    const k = d.toISOString();
    let p = map.get(k);
    if (!p) map.set(k, (p = { t: k, ...EMPTY() }));
    return p;
  };
  for (const r of fills) Object.assign(get(r.d), { volume: num(r.volume), fees: num(r.fees), trades: num(r.trades), traders: num(r.traders) });
  for (const r of copies) get(r.d).copies = num(r.n);
  for (const r of theses) get(r.d).theses = num(r.n);
  for (const r of users) get(r.d).newTraders = num(r.n);
  return [...map.values()].sort((a, b) => a.t.localeCompare(b.t));
}

/** fill the gaps so the chart has a bar (possibly zero) for every bucket in the range */
function dense(series: StatsPoint[], bucket: StatsBucket, since: Date | null, until: Date): StatsPoint[] {
  const step = (d: Date) => {
    const n = new Date(d);
    if (bucket === "day") n.setUTCDate(n.getUTCDate() + 1);
    else if (bucket === "week") n.setUTCDate(n.getUTCDate() + 7);
    else n.setUTCMonth(n.getUTCMonth() + 1);
    return n;
  };
  const floor = (d: Date) => {
    const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), bucket === "month" ? 1 : d.getUTCDate()));
    if (bucket === "week") n.setUTCDate(n.getUTCDate() - ((n.getUTCDay() + 6) % 7)); // monday, like date_trunc
    return n;
  };
  const start = floor(since ?? (series[0] ? new Date(series[0].t) : until));
  const end = floor(until);
  const have = new Map(series.map((p) => [p.t, p]));
  const out: StatsPoint[] = [];
  for (let d = start; d <= end && out.length < 2000; d = step(d)) out.push(have.get(d.toISOString()) ?? { t: d.toISOString(), ...EMPTY() });
  return out;
}

async function totalsSince(since: Date | null, until?: Date): Promise<Record<StatsMetric, number>> {
  const fromSql = since ? Prisma.sql`AND f.time >= ${since}` : Prisma.empty;
  const toSql = until ? Prisma.sql`AND f.time < ${until}` : Prisma.empty;
  const [f] = await prisma.$queryRaw<Row[]>`
    SELECT NOW() AS d, SUM(f.px * f.sz) AS volume, SUM(COALESCE(f."builderFee", 0)) AS fees, COUNT(*) AS trades, COUNT(DISTINCT f.address) AS traders
    FROM "Fill" f JOIN "User" u ON u.address = f.address AND u."claimedAt" IS NOT NULL
    WHERE TRUE ${fromSql} ${toSql}`;
  const win = (field: "openedAt" | "createdAt" | "claimedAt") => ({ ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) }) as Record<string, Date>;
  const [copies, theses, newTraders] = await Promise.all([
    prisma.position.count({ where: { copiedFromPositionId: { not: null }, openedAt: win("openedAt") } }),
    prisma.thesis.count({ where: { createdAt: win("createdAt") } }),
    prisma.user.count({ where: { claimedAt: since || until ? win("claimedAt") : { not: null } } }),
  ]);
  return { volume: num(f?.volume), fees: num(f?.fees), trades: num(f?.trades), traders: num(f?.traders), copies, theses, newTraders };
}

export async function protocolStats(range: StatsRange = "90d", bucket: StatsBucket = "day"): Promise<Stats> {
  const key = `${range}:${bucket}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const now = new Date();
  const days = range === "30d" ? 30 : range === "90d" ? 90 : range === "1y" ? 365 : null;
  const since = days ? new Date(now.getTime() - days * 86_400_000) : null;
  const d30 = new Date(now.getTime() - 30 * 86_400_000), d60 = new Date(now.getTime() - 60 * 86_400_000);
  const [series, t30, tPrev, tAll] = await Promise.all([bucketed(bucket, since), totalsSince(d30), totalsSince(d60, d30), totalsSince(null)]);
  const value: Stats = { range, bucket, series: dense(series, bucket, since, now), totals: { d30: t30, prev30: tPrev, all: tAll }, revenueShare: 1, at: now.toISOString() };
  cache.set(key, { at: Date.now(), value });
  return value;
}
