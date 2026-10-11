import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import { prisma } from "@/lib/db";
import { IS_TESTNET } from "@/lib/env";
import * as HL from "@/lib/hl";
import { feed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "socialLiquid — where traders show their receipts",
  description: "The first social trading platform for perpetuals. Post a thesis, open the position on Hyperliquid, and let everyone watch you hold or dump.",
  openGraph: { title: "socialLiquid", description: "where traders show their receipts. social perps on hyperliquid." },
};

export default async function Home() {
  const [markets, items, traders, tracked, candles] = await Promise.all([
    HL.markets().catch(() => []),
    feed({ limit: 7, minUsd: 0 }).catch(() => []),
    prisma.trackedAddress.findMany({ select: { address: true, displayName: true }, take: 12, orderBy: { lastPolledAt: "desc" } }).catch(() => []),
    prisma.trackedAddress.count().catch(() => 0),
    HL.candleSnapshot("BTC", "1h", Date.now() - 48 * 3_600_000).catch(() => []),
  ]);
  const btc = markets.find((m) => m.coin === "BTC");
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
    />
  );
}
