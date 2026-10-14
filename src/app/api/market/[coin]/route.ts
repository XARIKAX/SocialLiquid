import { handler, json, plain, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { usersByAddress } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, ctx: { params: Promise<{ coin: string }> }) => {
  const { coin: ref } = await ctx.params;
  const u = new URL(req.url);
  const s = await getSession();
  const market = await HL.marketByRef(decodeURIComponent(ref));
  if (!market) throw new HttpError(404, "unknown market");
  const coin = market.coin;

  const thesisOnly = u.searchParams.get("thesis") === "1";
  const following = u.searchParams.get("following") === "1";
  let addresses: string[] | undefined;
  if (following && s) {
    const f = await prisma.follow.findMany({ where: { followerId: s.userId }, select: { following: { select: { address: true } } } });
    addresses = f.map((x) => x.following.address);
  } else if (following) addresses = [];

  const INCLUDE = { theses: { orderBy: { createdAt: "desc" as const }, take: 1, include: { _count: { select: { likes: true } } } } };
  const baseWhere = { coin, closedAt: null, ...(addresses ? { address: { in: addresses } } : {}), ...(thesisOnly ? { theses: { some: {} } } : {}) };
  // the biggest books, plus the viewer's own positions and the latest ones with a thesis: a small trader who just
  // posted must see themselves on the chart even when 200 whales sit above them
  const [big, own, withThesis] = await Promise.all([
    prisma.position.findMany({ where: baseWhere, orderBy: { sizeUsd: "desc" }, take: 200, include: INCLUDE }),
    s ? prisma.position.findMany({ where: { ...baseWhere, address: s.address }, include: INCLUDE }) : [],
    prisma.position.findMany({ where: { ...baseWhere, theses: { some: {} } }, orderBy: { openedAt: "desc" }, take: 50, include: INCLUDE }),
  ]);
  const seen = new Set<string>();
  const positions = [...big, ...own, ...withThesis].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const fills = await prisma.fill.findMany({ where: { coin }, orderBy: { time: "desc" }, take: 60 });
  const dayFills = await prisma.fill.findMany({ where: { coin, time: { gte: new Date(Date.now() - 86_400_000) } }, select: { dir: true, px: true, sz: true } });
  const flow = dayFills.reduce(
    (acc, f) => {
      const usd = Number(f.px) * Number(f.sz);
      if (/open long|short > long/i.test(f.dir)) acc.longUsd += usd;
      else if (/open short|long > short/i.test(f.dir)) acc.shortUsd += usd;
      acc.count++;
      return acc;
    },
    { longUsd: 0, shortUsd: 0, count: 0 },
  );
  const users = await usersByAddress([...positions.map((p) => p.address), ...fills.map((f) => f.address)]);
  // the viewer's follow graph on this market, and how often this market was copied today: the social strip and the chart pins
  const followedSet = new Set<string>(
    addresses ?? (s ? (await prisma.follow.findMany({ where: { followerId: s.userId }, select: { following: { select: { address: true } } } })).map((x) => x.following.address) : []),
  );
  // spot markets: who holds the token, from the spot balances the indexer mirrors
  const holderRows = market.kind === "spot" && market.token ? await prisma.spotHolding.findMany({ where: { coin: market.token, total: { gt: 0 } }, orderBy: { total: "desc" }, take: 100 }) : [];
  const holderUsers = await usersByAddress(holderRows.map((h) => h.address));
  const holders = holderRows.map((h) => ({ address: h.address, user: holderUsers.get(h.address) ?? null, total: Number(h.total), followed: followedSet.has(h.address), updatedAt: h.updatedAt.toISOString() }));
  const copies24h = await prisma.position.count({ where: { coin, copiedFromPositionId: { not: null }, openedAt: { gte: new Date(Date.now() - 86_400_000) } } });
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
      flow24h: flow,
      copies24h,
      holders: market.kind === "spot" ? holders : undefined,
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
        followed: followedSet.has(p.address),
        mine: !!s && p.address === s.address,
        closedCount: holdAgg.get(p.address)?.n ?? 0,
        avgHoldMs: holdAgg.get(p.address) ? holdAgg.get(p.address)!.total / holdAgg.get(p.address)!.n : null,
        thesis: p.theses[0] ? { id: p.theses[0].id, text: p.theses[0].text, likes: p.theses[0]._count.likes, outcome: p.theses[0].outcome } : null,
      })),
    }),
  );
});
