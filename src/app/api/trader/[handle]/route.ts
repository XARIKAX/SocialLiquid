import { handler, json, plain, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { resolveTrader, traderStats } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ handle: string }> }) => {
  const { handle } = await ctx.params;
  const t = await resolveTrader(handle);
  if (!t) throw new HttpError(404, "trader not found");
  const s = await getSession();
  const [stats, state, theses, followers, isFollowing, tracked] = await Promise.all([
    traderStats(t.address),
    HL.clearinghouseState(t.address).catch(() => null),
    t.user
      ? prisma.thesis.findMany({
          where: { userId: t.user.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { position: true, _count: { select: { likes: true } }, likes: s ? { where: { userId: s.userId } } : false },
        })
      : [],
    t.user ? prisma.follow.count({ where: { followingId: t.user.id } }) : 0,
    t.user && s ? prisma.follow.findUnique({ where: { followerId_followingId: { followerId: s.userId, followingId: t.user.id } } }) : null,
    prisma.trackedAddress.findUnique({ where: { address: t.address } }),
  ]);
  // open positions live from chain, joined to our mirrored rows for ids / theses
  const openRows = await prisma.position.findMany({ where: { address: t.address, closedAt: null }, include: { theses: { take: 1, orderBy: { createdAt: "desc" } } } });
  const open = (state?.assetPositions ?? [])
    .filter((p) => Number(p.position.szi) !== 0)
    .map((p) => {
      const row = openRows.find((r) => r.coin === p.position.coin);
      return {
        id: row?.id ?? null,
        coin: p.position.coin,
        side: HL.sideOf(p.position.szi),
        size: Math.abs(Number(p.position.szi)),
        sizeUsd: Number(p.position.positionValue),
        leverage: p.position.leverage.value,
        entryPx: Number(p.position.entryPx),
        unrealisedPnl: Number(p.position.unrealizedPnl),
        roe: Number(p.position.returnOnEquity),
        liquidationPx: p.position.liquidationPx ? Number(p.position.liquidationPx) : null,
        openedAt: row?.openedAt.toISOString() ?? null,
        thesis: row?.theses[0] ? { id: row.theses[0].id, text: row.theses[0].text } : null,
      };
    });
  const recentClosed = await prisma.position.findMany({ where: { address: t.address, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 20 });
  return json(
    plain({
      address: t.address,
      user: t.user ? { id: t.user.id, handle: t.user.handle, xHandle: t.user.xHandle, avatarUrl: t.user.avatarUrl, createdAt: t.user.createdAt } : null,
      displayName: tracked?.displayName ?? null,
      claimed: !!t.user?.claimedAt,
      isMe: s?.address === t.address,
      isFollowing: !!isFollowing,
      followers,
      stats,
      accountValue: state ? Number(state.marginSummary.accountValue) : null,
      open,
      recentClosed: recentClosed.map((p) => ({
        id: p.id,
        coin: p.coin,
        side: p.side,
        sizeUsd: Number(p.sizeUsd),
        leverage: p.leverage,
        entryPx: Number(p.entryPx),
        closePx: p.closePx === null ? null : Number(p.closePx),
        realisedPnl: p.realisedPnl === null ? null : Number(p.realisedPnl),
        openedAt: p.openedAt.toISOString(),
        closedAt: p.closedAt!.toISOString(),
        liquidated: p.liquidated,
      })),
      theses: theses.map((th) => ({
        id: th.id,
        coin: th.coin,
        text: th.text,
        outcome: th.outcome,
        createdAt: th.createdAt.toISOString(),
        likes: th._count.likes,
        likedByMe: Array.isArray(th.likes) && th.likes.length > 0,
        position: th.position
          ? {
              id: th.position.id,
              side: th.position.side,
              sizeUsd: Number(th.position.sizeUsd),
              leverage: th.position.leverage,
              entryPx: Number(th.position.entryPx),
              size: Number(th.position.size),
              closedAt: th.position.closedAt?.toISOString() ?? null,
              realisedPnl: th.position.realisedPnl === null ? null : Number(th.position.realisedPnl),
              unrealisedPnl: Number(th.position.unrealisedPnl),
              openedAt: th.position.openedAt.toISOString(),
            }
          : null,
      })),
    }),
  );
});
