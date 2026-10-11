import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import { prisma } from "@/lib/db";
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
  return (
    <Landing
      stats={{
        markets: markets.length,
        volume24h: markets.reduce((a, m) => a + m.volume24h, 0),
        traders: tracked,
      }}
      btc={btc ? { markPx: btc.markPx, change24h: btc.change24h, volume24h: btc.volume24h, openInterestUsd: btc.openInterestUsd, funding: btc.funding, maxLeverage: btc.maxLeverage } : null}
      candles={candles.map((c) => Number(c.c))}
      items={items}
      traders={traders}
    />
  );
}
