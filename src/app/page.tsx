import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Landing } from "@/components/landing/landing";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { feed, hlLeaderboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "socialLiquid — the social layer for Hyperliquid",
  description: "The social layer for Hyperliquid. Follow the best traders, see every position as it opens, post a thesis and trade alongside them.",
  openGraph: { title: "socialLiquid", description: "the social layer for Hyperliquid. follow the best traders, see every position live, trade alongside them." },
};

/** drop hero.mp4 (and optionally hero.webm) into public/landing and the hero plays it; otherwise the still gets a slow cinematic drift */
const heroVideo = existsSync(join(process.cwd(), "public", "landing", "hero.mp4"));

export default async function Home() {
  const [markets, items, traders, tracked, candles, board] = await Promise.all([
    HL.markets().catch(() => []),
    feed({ limit: 7, minUsd: 0 }).catch(() => []),
    prisma.trackedAddress.findMany({ select: { address: true, displayName: true }, take: 12, orderBy: { lastPolledAt: "desc" } }).catch(() => []),
    prisma.trackedAddress.count().catch(() => 0),
    HL.candleSnapshot("BTC", "1h", Date.now() - 48 * 3_600_000).catch(() => []),
    hlLeaderboard().then((b) => b.rows.slice(0, 5)).catch(() => []),
  ]);
  const btc = markets.find((m) => m.coin === "BTC");
  return (
    <Landing
      heroVideo={heroVideo}
      stats={{
        markets: markets.length,
        volume24h: markets.reduce((a, m) => a + m.volume24h, 0),
        traders: tracked,
      }}
      btc={btc ? { markPx: btc.markPx, change24h: btc.change24h, volume24h: btc.volume24h, openInterestUsd: btc.openInterestUsd, funding: btc.funding, maxLeverage: btc.maxLeverage } : null}
      candles={candles.map((c) => Number(c.c))}
      items={items}
      traders={traders}
      board={board.map((r) => ({ rank: r.rank, address: r.user.address, name: r.user.handle ?? r.user.displayName, pnl30d: r.pnl30d, accountValue: r.accountValue }))}
    />
  );
}
