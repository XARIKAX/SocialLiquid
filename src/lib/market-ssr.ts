import "server-only";
import { prisma } from "./db";
import * as HL from "./hl";
import { usersByAddress } from "./queries";
import { plain } from "./api";

/** initial market payload for ssr (same shape as /api/market/[coin]) */
export async function marketInitial(coin: string) {
  const markets = await HL.markets().catch(() => []);
  const market = markets.find((m) => m.coin === coin);
  if (!market) return null;
  // a db outage or missing schema must not take the page down; the client refetches and /api/health explains
  const positions = await prisma.position
    .findMany({
      where: { coin, closedAt: null },
      orderBy: { sizeUsd: "desc" },
      take: 200,
      include: { theses: { orderBy: { createdAt: "desc" }, take: 1, include: { _count: { select: { likes: true } } } } },
    })
    .catch((e: Error) => {
      console.error("[ssr] positions query failed:", e.message.split("\n").filter(Boolean).slice(-1)[0]);
      return [];
    });
  const users = await usersByAddress(positions.map((p) => p.address)).catch(() => new Map());
  const longUsd = positions.filter((p) => p.side === "LONG").reduce((a, p) => a + Number(p.sizeUsd), 0);
  const shortUsd = positions.filter((p) => p.side === "SHORT").reduce((a, p) => a + Number(p.sizeUsd), 0);
  return plain({
    market,
    longShort: { longUsd, shortUsd, ratio: longUsd + shortUsd > 0 ? longUsd / (longUsd + shortUsd) : 0.5 },
    trades: [],
    flow24h: { longUsd: 0, shortUsd: 0, count: 0 },
    positions: positions.map((p) => ({
      id: p.id,
      address: p.address,
      user: users.get(p.address) ?? null,
      side: p.side,
      size: Number(p.size),
      sizeUsd: Number(p.sizeUsd),
      leverage: p.leverage,
      entryPx: Number(p.entryPx),
      openedAt: p.openedAt.toISOString(),
      unrealisedPnl: Number(p.unrealisedPnl),
      closedCount: 0,
      avgHoldMs: null,
      thesis: p.theses[0] ? { id: p.theses[0].id, text: p.theses[0].text, likes: p.theses[0]._count.likes, outcome: p.theses[0].outcome } : null,
    })),
  });
}
