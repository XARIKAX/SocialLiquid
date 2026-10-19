import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import { prisma } from "@/lib/db";
import { BUILDER_FEE_TENTHS_BP, INVITE_REQUIRED, IS_TESTNET } from "@/lib/env";
import * as HL from "@/lib/hl";
import { feed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "socialLiquid — the social layer for perpetual markets",
  description: "The social layer for perpetual markets. Follow the best traders, see every position as it opens, post a thesis and trade alongside them.",
  openGraph: { title: "socialLiquid", description: "the social layer for perpetual markets. follow the best traders, see every position live, trade alongside them." },
};

/** never let a slow upstream hold the landing page: resolve to the fallback after `ms` */
function within<T>(p: Promise<T>, fb: T, ms = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((r) => {
    timer = setTimeout(() => r(fb), ms);
  });
  return Promise.race([p.catch(() => fb), late]).finally(() => clearTimeout(timer));
}

/**
 * module-level memo that stores the promise, so concurrent misses share one upstream call.
 * an empty or failed result is kept only briefly so the next request retries.
 */
function shared<T extends unknown[]>(ttl: number, load: () => Promise<T>) {
  let c: { at: number; ttl: number; p: Promise<T> } | undefined;
  return () => {
    if (c && Date.now() - c.at < c.ttl) return c.p;
    const entry = { at: Date.now(), ttl, p: load().catch(() => [] as unknown as T) };
    entry.p.then((v) => {
      if (!v.length) entry.ttl = 5_000;
    });
    c = entry;
    return entry.p;
  };
}

// candleSnapshot weighs 20 of hyperliquid's 1,200/min per-ip budget: one fetch a minute for every visitor
const btcCandles = shared(60_000, () => HL.candleSnapshot("BTC", "1h", Date.now() - 48 * 3_600_000));
// markets() caches 10s itself; this only dedupes the concurrent misses at expiry
const allMarkets = shared(10_000, () => HL.markets());

export default async function Home() {
  const [markets, items, traders, tracked, candles] = await Promise.all([
    within(allMarkets(), []),
    within(feed({ limit: 7, minUsd: 0 }), []),
    // only people who signed up count as traders (not leaderboard addresses we mirror)
    within(prisma.trackedAddress.findMany({ where: { source: "USER" }, select: { address: true, displayName: true }, take: 12, orderBy: { lastPolledAt: "desc" } }), []),
    within(prisma.trackedAddress.count({ where: { source: "USER" } }), 0),
    within(btcCandles(), []),
  ]);
  const btc = markets.find((m) => m.coin === "BTC" && Number.isFinite(m.markPx) && m.markPx > 0);
  const tape = [...markets]
    .filter((m) => m.markPx > 0)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 18)
    .map((m) => ({ coin: m.coin, markPx: m.markPx, change24h: m.change24h, volume24h: m.volume24h, maxLeverage: m.maxLeverage }));
  return (
    <Landing
      stats={{
        markets: markets.length,
        volume24h: markets.reduce((a, m) => a + m.volume24h, 0),
        openInterest: markets.reduce((a, m) => a + m.openInterestUsd, 0),
        maxLeverage: markets.reduce((a, m) => Math.max(a, m.maxLeverage), 0),
        traders: tracked,
      }}
      btc={btc ? { markPx: btc.markPx, change24h: btc.change24h, volume24h: btc.volume24h, openInterestUsd: btc.openInterestUsd, funding: btc.funding, maxLeverage: btc.maxLeverage } : null}
      candles={candles.map((c) => ({ t: c.t, o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c) }))}
      tape={tape}
      items={items}
      traders={traders}
      testnet={IS_TESTNET}
      inviteOnly={INVITE_REQUIRED}
      builderFeePct={BUILDER_FEE_TENTHS_BP / 1000}
    />
  );
}
