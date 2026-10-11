import { handler, json, plain, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { usersByAddress } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, ctx: { params: Promise<{ coin: string }> }) => {
  const { coin } = await ctx.params;
  const u = new URL(req.url);
  const s = await getSession();
  const markets = await HL.markets();
  const market = markets.find((m) => m.coin === coin);
  if (!market) throw new HttpError(404, "unknown market");

  const thesisOnly = u.searchParams.get("thesis") === "1";
  const following = u.searchParams.get("following") === "1";
  let addresses: string[] | undefined;
  if (following && s) {
    const f = await prisma.follow.findMany({ where: { followerId: s.userId }, select: { following: { select: { address: true } } } });
    addresses = f.map((x) => x.following.address);
  } else if (following) addresses = [];

  const positions = await prisma.position.findMany({
    where: { coin, closedAt: null, ...(addresses ? { address: { in: addresses } } : {}), ...(thesisOnly ? { theses: { some: {} } } : {}) },
    orderBy: { sizeUsd: "desc" },
    take: 200,
    include: { theses: { orderBy: { createdAt: "desc" }, take: 1, include: { _count: { select: { likes: true } } } } },
  });
  const fills = await prisma.fill.findMany({ where: { coin }, orderBy: { time: "desc" }, take: 60 });
  const users = await usersByAddress([...positions.map((p) => p.address), ...fills.map((f) => f.address)]);
  const longUsd = positions.filter((p) => p.side === "LONG").reduce((a, p) => a + Number(p.sizeUsd), 0);
  const shortUsd = positions.filter((p) => p.side === "SHORT").reduce((a, p) => a + Number(p.sizeUsd), 0);

  // avg hold per trader on this coin (from their closed positions)
  const closed = await prisma.position.findMany({
    where: { coin, closedAt: { not: null }, address: { in: [...new Set(positions.map((p) => p.address))] } },
    select: { address: true, openedAt: true, closedAt: true },
  });
  const holdAgg = new Map<string, { n: number; total: number }>();
  for (const c of closed) {
    const h = holdAgg.get(c.address) ?? { n: 0, total: 0 };
    h.n++;
    h.total += c.closedAt!.getTime() - c.openedAt.getTime();
    holdAgg.set(c.address, h);
  }

  return json(
    plain({
      market,
      longShort: { longUsd, shortUsd, ratio: longUsd + shortUsd > 0 ? longUsd / (longUsd + shortUsd) : 0.5 },
      trades: fills.map((f) => ({
        id: f.id,
        address: f.address,
        user: users.get(f.address) ?? null,
        dir: f.dir,
        side: f.side,
        px: Number(f.px),
        sz: Number(f.sz),
        usd: Number(f.px) * Number(f.sz),
        closedPnl: Number(f.closedPnl),
        liquidation: f.liquidation,
        time: f.time.toISOString(),
      })),
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
        closedCount: holdAgg.get(p.address)?.n ?? 0,
        avgHoldMs: holdAgg.get(p.address) ? holdAgg.get(p.address)!.total / holdAgg.get(p.address)!.n : null,
        thesis: p.theses[0] ? { id: p.theses[0].id, text: p.theses[0].text, likes: p.theses[0]._count.likes, outcome: p.theses[0].outcome } : null,
      })),
    }),
  );
});
