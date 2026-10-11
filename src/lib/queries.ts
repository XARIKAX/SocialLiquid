/** db queries shared by route handlers and server components */
import { Prisma, type FeedEventType } from "@prisma/client";
import { prisma } from "./db";
import { plain } from "./api";

export type UserLite = { id: string; address: string; handle: string | null; xHandle: string | null; avatarUrl: string | null };

export async function usersByAddress(addresses: string[]): Promise<Map<string, UserLite>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!uniq.length) return new Map();
  const users = await prisma.user.findMany({
    where: { address: { in: uniq } },
    select: { id: true, address: true, handle: true, xHandle: true, avatarUrl: true },
  });
  const tracked = await prisma.trackedAddress.findMany({ where: { address: { in: uniq }, displayName: { not: null } }, select: { address: true, displayName: true } });
  const map = new Map<string, UserLite>();
  for (const u of users) map.set(u.address, u);
  for (const t of tracked) if (!map.has(t.address)) map.set(t.address, { id: "", address: t.address, handle: t.displayName, xHandle: null, avatarUrl: null });
  return map;
}

export type FeedItem = {
  id: string;
  type: FeedEventType;
  address: string;
  coin: string;
  time: string;
  payload: Record<string, unknown>;
  user: UserLite | null;
  position: {
    id: string;
    side: string;
    size: number;
    sizeUsd: number;
    leverage: number;
    entryPx: number;
    openedAt: string;
    closedAt: string | null;
    realisedPnl: number | null;
    unrealisedPnl: number;
    liquidated: boolean;
  } | null;
  thesis: { id: string; text: string; outcome: string; likes: number; likedByMe: boolean; createdAt: string } | null;
};

export type FeedFilters = {
  coin?: string;
  minUsd?: number;
  thesisOnly?: boolean;
  followingOf?: string; // user id
  addresses?: string[];
  before?: string;
  limit?: number;
  viewerId?: string;
};

export async function feed(f: FeedFilters): Promise<FeedItem[]> {
  const where: Prisma.FeedEventWhereInput = {};
  if (f.coin) where.coin = f.coin;
  if (f.thesisOnly) where.type = "THESIS";
  if (f.before) where.time = { lt: new Date(f.before) };
  if (f.addresses) where.address = { in: f.addresses };
  if (f.followingOf) {
    const follows = await prisma.follow.findMany({ where: { followerId: f.followingOf }, select: { following: { select: { address: true } } } });
    const addrs = follows.map((x) => x.following.address);
    where.address = { in: f.addresses ? f.addresses.filter((a) => addrs.includes(a)) : addrs };
  }
  const rows = await prisma.feedEvent.findMany({
    where,
    orderBy: { time: "desc" },
    take: Math.min(200, Math.max(1, (f.limit ?? 50) * (f.minUsd ? 3 : 1))),
    include: {
      position: true,
      thesis: { include: { _count: { select: { likes: true } }, likes: f.viewerId ? { where: { userId: f.viewerId }, select: { userId: true } } : false } },
    },
  });
  const users = await usersByAddress(rows.map((r) => r.address));
  const items: FeedItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    address: r.address,
    coin: r.coin,
    time: r.time.toISOString(),
    payload: (r.payload ?? {}) as Record<string, unknown>,
    user: users.get(r.address) ?? null,
    position: r.position
      ? {
          id: r.position.id,
          side: r.position.side,
          size: Number(r.position.size),
          sizeUsd: Number(r.position.sizeUsd),
          leverage: r.position.leverage,
          entryPx: Number(r.position.entryPx),
          openedAt: r.position.openedAt.toISOString(),
          closedAt: r.position.closedAt?.toISOString() ?? null,
          realisedPnl: r.position.realisedPnl === null ? null : Number(r.position.realisedPnl),
          unrealisedPnl: Number(r.position.unrealisedPnl),
          liquidated: r.position.liquidated,
        }
      : null,
    thesis: r.thesis
      ? {
          id: r.thesis.id,
          text: r.thesis.text,
          outcome: r.thesis.outcome,
          likes: r.thesis._count.likes,
          likedByMe: Array.isArray(r.thesis.likes) && r.thesis.likes.length > 0,
          createdAt: r.thesis.createdAt.toISOString(),
        }
      : null,
  }));
  const min = f.minUsd ?? 0;
  const filtered = min > 0 ? items.filter((i) => Number(i.payload.sizeUsd ?? i.position?.sizeUsd ?? 0) >= min) : items;
  return plain(filtered.slice(0, f.limit ?? 50));
}

// ---------- trader stats ----------

export type TraderStats = {
  winRate: number | null;
  closedTrades: number;
  pnl7d: number;
  pnl30d: number;
  pnlAll: number;
  avgHoldMs: number | null;
  thesisCount: number;
  thesisAccuracy: number | null;
};

export async function traderStats(address: string): Promise<TraderStats> {
  const a = address.toLowerCase();
  const now = Date.now();
  const closed = await prisma.position.findMany({
    where: { address: a, closedAt: { not: null } },
    select: { realisedPnl: true, openedAt: true, closedAt: true },
  });
  const wins = closed.filter((p) => Number(p.realisedPnl ?? 0) > 0).length;
  const pnl = (sinceMs: number) => closed.filter((p) => p.closedAt!.getTime() >= sinceMs).reduce((s, p) => s + Number(p.realisedPnl ?? 0), 0);
  const holds = closed.map((p) => p.closedAt!.getTime() - p.openedAt.getTime());
  const theses = await prisma.thesis.findMany({ where: { user: { address: a } }, select: { outcome: true } });
  const settled = theses.filter((t) => t.outcome !== "OPEN");
  return {
    winRate: closed.length ? wins / closed.length : null,
    closedTrades: closed.length,
    pnl7d: pnl(now - 7 * 86_400_000),
    pnl30d: pnl(now - 30 * 86_400_000),
    pnlAll: pnl(0),
    avgHoldMs: holds.length ? holds.reduce((s, x) => s + x, 0) / holds.length : null,
    thesisCount: theses.length,
    thesisAccuracy: settled.length ? settled.filter((t) => t.outcome === "PROFIT").length / settled.length : null,
  };
}

export type LeaderboardRow = {
  rank: number;
  user: UserLite;
  stats: TraderStats;
  followers: number;
};

const MIN_CLOSED = 5;

export async function leaderboardRows(by: "pnl7d" | "winRate" | "thesisAccuracy" | "followers", limit = 50): Promise<LeaderboardRow[]> {
  // candidates: addresses with >= 5 closed positions
  const grouped = await prisma.position.groupBy({
    by: ["address"],
    where: { closedAt: { not: null } },
    _count: { _all: true },
    having: { address: { _count: { gte: MIN_CLOSED } } },
    orderBy: { _count: { address: "desc" } },
    take: 300,
  });
  const addrs = grouped.map((g) => g.address);
  const users = await usersByAddress(addrs);
  const userIds = [...users.values()].filter((u) => u.id).map((u) => u.id);
  const followerCounts = userIds.length
    ? await prisma.follow.groupBy({ by: ["followingId"], where: { followingId: { in: userIds } }, _count: { _all: true } })
    : [];
  const fc = new Map(followerCounts.map((f) => [f.followingId, f._count._all]));
  const rows = await Promise.all(
    addrs.map(async (a) => {
      const user = users.get(a) ?? { id: "", address: a, handle: null, xHandle: null, avatarUrl: null };
      return { rank: 0, user, stats: await traderStats(a), followers: user.id ? (fc.get(user.id) ?? 0) : 0 };
    }),
  );
  const key = (r: LeaderboardRow) =>
    by === "pnl7d" ? r.stats.pnl7d : by === "winRate" ? (r.stats.winRate ?? -1) : by === "thesisAccuracy" ? (r.stats.thesisAccuracy ?? -1) : r.followers;
  rows.sort((x, y) => key(y) - key(x));
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function resolveTrader(handleOrAddress: string) {
  const s = decodeURIComponent(handleOrAddress);
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    const u = await prisma.user.findUnique({ where: { address: s.toLowerCase() } });
    return { address: s.toLowerCase(), user: u };
  }
  const u = await prisma.user.findUnique({ where: { handle: s } });
  if (!u) return null;
  return { address: u.address, user: u };
}
