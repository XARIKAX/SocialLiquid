import { handler, json, plain, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { resolveTrader, traderStats, usersByAddress } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { syncAddress } from "@/lib/indexer";
import { featuredAddresses } from "@/lib/featured";
import type { HlFill } from "@/lib/hl-types";
import { badgesFor, pointsSince, streaksBulk } from "@/lib/points";

/** fills straight from the exchange for addresses the indexer has not reached yet; one upstream call per address per minute */
const liveFillsCache = new Map<string, { at: number; fills: HlFill[] }>();
async function liveFills(address: string): Promise<HlFill[]> {
  const hit = liveFillsCache.get(address);
  if (hit && Date.now() - hit.at < 60_000) return hit.fills;
  const fills = await HL.userFills(address).catch(() => hit?.fills ?? []);
  liveFillsCache.set(address, { at: Date.now(), fills });
  return fills;
}

/** viewing a tracked or featured profile also indexes it, so profiles fill in even when the worker is not running */
const lastSync = new Map<string, number>();
function syncInBackground(address: string) {
  if (Date.now() - (lastSync.get(address) ?? 0) < 60_000) return;
  lastSync.set(address, Date.now());
  void syncAddress(address).catch((e) => console.warn("[trader] background sync failed", address.slice(0, 10), (e as Error).message));
}

type Win = { pnl: number; vlm: number; startValue: number; curve: { t: number; v: number }[] } | null;

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ handle: string }> }) => {
  const { handle } = await ctx.params;
  const t = await resolveTrader(handle);
  if (!t) throw new HttpError(404, "trader not found");
  const s = await getSession();
  const [stats, state, pf, theses, followers, isFollowing, tracked] = await Promise.all([
    traderStats(t.address),
    HL.clearinghouseState(t.address).catch(() => null),
    HL.portfolio(t.address).catch(() => null),
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
  const copiedUsers = await usersByAddress(openRows.map((r) => r.copiedFromAddress).filter((a): a is string => !!a));
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
        copiedFrom: row?.copiedFromAddress ? { address: row.copiedFromAddress, handle: copiedUsers.get(row.copiedFromAddress)?.handle ?? null, displayName: copiedUsers.get(row.copiedFromAddress)?.displayName ?? null } : null,
      };
    });
  const recentClosed = await prisma.position.findMany({ where: { address: t.address, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 50 });
  // the trade this profile pinned (open or closed), with its thesis if it has one
  const pinnedRow = t.user?.pinnedPositionId ? await prisma.position.findFirst({ where: { id: t.user.pinnedPositionId, address: t.address }, include: { theses: { take: 1, orderBy: { createdAt: "desc" } } } }) : null;
  const pinnedPosition = pinnedRow
    ? { id: pinnedRow.id, coin: pinnedRow.coin, side: pinnedRow.side, sizeUsd: Number(pinnedRow.sizeUsd), leverage: pinnedRow.leverage, entryPx: Number(pinnedRow.entryPx), closePx: pinnedRow.closePx === null ? null : Number(pinnedRow.closePx), realisedPnl: pinnedRow.realisedPnl === null ? null : Number(pinnedRow.realisedPnl), unrealisedPnl: Number(pinnedRow.unrealisedPnl), size: Number(pinnedRow.size), openedAt: pinnedRow.openedAt.toISOString(), closedAt: pinnedRow.closedAt?.toISOString() ?? null, liquidated: pinnedRow.liquidated, thesis: pinnedRow.theses[0] ? { id: pinnedRow.theses[0].id, text: pinnedRow.theses[0].text, outcome: pinnedRow.theses[0].outcome } : null }
    : null;
  const series = await prisma.position.findMany({
    where: { address: t.address, closedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    orderBy: { closedAt: "asc" },
    select: { closedAt: true, realisedPnl: true },
  });
  const indexedFills = await prisma.fill.findMany({ where: { address: t.address }, orderBy: { time: "desc" }, take: 60 });
  // nothing indexed yet: read the exchange directly and start indexing in the background
  const live = indexedFills.length === 0 ? await liveFills(t.address) : [];
  if (tracked || featuredAddresses().includes(t.address)) {
    const stale = !tracked?.lastPolledAt || Date.now() - tracked.lastPolledAt.getTime() > 60_000;
    if (stale) syncInBackground(t.address);
  }
  const fills = indexedFills.length
    ? indexedFills.map((f) => ({ id: f.id, coin: f.coin, dir: f.dir, px: Number(f.px), sz: Number(f.sz), usd: Number(f.px) * Number(f.sz), closedPnl: Number(f.closedPnl), liquidation: f.liquidation, time: f.time.toISOString() }))
    : live.slice(0, 60).map((f) => ({ id: String(f.tid), coin: f.coin, dir: f.dir, px: Number(f.px), sz: Number(f.sz), usd: Number(f.px) * Number(f.sz), closedPnl: Number(f.closedPnl), liquidation: /liquidat/i.test(f.dir), time: new Date(f.time).toISOString() }));
  // closing fills from the exchange's own history, so win rate and trade count exist before the indexer catches up
  const closes = live.filter((f) => Number(f.closedPnl) !== 0);
  const fillStats = live.length ? { fills: live.length, closes: closes.length, wins: closes.filter((f) => Number(f.closedPnl) > 0).length } : null;
  const win = (k: "day" | "week" | "month" | "allTime"): Win => {
    const w = pf?.[k];
    if (!w) return null;
    return {
      pnl: Number(w.pnlHistory[w.pnlHistory.length - 1]?.[1] ?? 0),
      vlm: Number(w.vlm),
      startValue: Number(w.accountValueHistory[0]?.[1] ?? 0),
      curve: w.pnlHistory.map(([tm, v]) => ({ t: tm, v: Number(v) })),
    };
  };
  const hl = pf ? { day: win("day"), week: win("week"), month: win("month"), allTime: win("allTime") } : null;
  const following = t.user ? await prisma.follow.count({ where: { followerId: t.user.id } }) : 0;
  // points, streaks, badges
  const streaks = (await streaksBulk([t.address])).get(t.address)!;
  const claimedUser = t.user?.claimedAt ? t.user : null;
  const [week, profitTheses, invites, above] = await Promise.all([
    claimedUser ? pointsSince([claimedUser.id], new Date(Date.now() - 7 * 86_400_000)).then((m) => m.get(claimedUser.id) ?? 0) : 0,
    claimedUser ? prisma.thesis.count({ where: { userId: claimedUser.id, outcome: "PROFIT" } }) : 0,
    claimedUser ? prisma.user.count({ where: { invitedById: claimedUser.id } }) : 0,
    claimedUser ? prisma.user.count({ where: { claimedAt: { not: null }, points: { gt: claimedUser.points } } }) : 0,
  ]);
  const points = claimedUser ? { total: claimedUser.points, week, rank: above + 1 } : null;
  // keep the denormalised streak (used by feed cards) honest whenever a profile is viewed
  if (claimedUser && (claimedUser.winStreak !== streaks.current || claimedUser.bestStreak !== streaks.best)) await prisma.user.update({ where: { id: claimedUser.id }, data: { winStreak: streaks.current, bestStreak: streaks.best } }).catch(() => null);
  const badges = badgesFor({ closedTrades: stats.closedTrades, winRate: stats.winRate, bestStreak: streaks.best, profitTheses, copiers: stats.copiers, followers, invites, avgHoldMs: stats.avgHoldMs, days: streaks.days });
  // mutuals: accounts this profile follows that follow it back
  const mutuals = t.user ? await prisma.follow.count({ where: { followerId: t.user.id, following: { following: { some: { followingId: t.user.id } } } } }) : 0;
  return json(
    plain({
      address: t.address,
      user: t.user
        ? { id: t.user.id, handle: t.user.handle, displayName: t.user.displayName, xHandle: t.user.xHandle, tgHandle: t.user.tgHandle, bio: t.user.bio, avatarUrl: t.user.avatarUrl, bannerUrl: t.user.bannerUrl, createdAt: t.user.createdAt, style: t.user.style, pinnedThesisId: t.user.pinnedThesisId, pinnedPositionId: t.user.pinnedPositionId }
        : null,
      pinnedPosition,
      points,
      streaks,
      badges,
      invites: claimedUser ? { joined: invites } : null,
      invitedBy: t.user?.invitedById ? await prisma.user.findUnique({ where: { id: t.user.invitedById }, select: { address: true, handle: true, displayName: true } }) : null,
      mutuals,
      displayName: tracked?.displayName ?? null,
      claimed: !!t.user?.claimedAt,
      isMe: s?.address === t.address,
      isFollowing: !!isFollowing,
      followers,
      following,
      stats,
      pnlSeries: series.map((p) => ({ t: p.closedAt!.getTime(), pnl: Number(p.realisedPnl ?? 0) })),
      fills,
      fillsSource: indexedFills.length ? "indexed" : "live",
      fillStats,
      hl,
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
