/** db queries shared by route handlers and server components */
import { Prisma, type FeedEventType } from "@prisma/client";
import { prisma } from "./db";
import { reactionCounts } from "./reactions";
import { getHlBoardStatus, refreshHlLeaderboard } from "./indexer";
import { plain } from "./api";

/** handle is only set for claimed accounts and is what /t/[handle] resolves. displayName is the hyperliquid leaderboard name. */
export type UserLite = { id: string; address: string; handle: string | null; displayName: string | null; xHandle: string | null; avatarUrl: string | null; claimed: boolean; /** trading-style tag the trader picked */ style?: string | null };

export async function usersByAddress(addresses: string[]): Promise<Map<string, UserLite>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!uniq.length) return new Map();
  const users = await prisma.user.findMany({
    where: { address: { in: uniq } },
    select: { id: true, address: true, handle: true, displayName: true, xHandle: true, avatarUrl: true, claimedAt: true, style: true },
  });
  const tracked = await prisma.trackedAddress.findMany({ where: { address: { in: uniq }, displayName: { not: null } }, select: { address: true, displayName: true } });
  const map = new Map<string, UserLite>();
  const names = new Map(tracked.map((t) => [t.address, t.displayName]));
  for (const u of users) map.set(u.address, { id: u.id, address: u.address, handle: u.claimedAt ? u.handle : null, displayName: (u.claimedAt ? u.displayName : null) ?? names.get(u.address) ?? null, xHandle: u.xHandle, avatarUrl: u.avatarUrl, claimed: !!u.claimedAt, style: u.claimedAt ? u.style : null });
  for (const t of tracked) if (!map.has(t.address)) map.set(t.address, { id: "", address: t.address, handle: null, displayName: t.displayName, xHandle: null, avatarUrl: null, claimed: false });
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
    /** who this position copies, when it was opened through "copy" */
    copiedFrom: { address: string; handle: string | null; displayName: string | null } | null;
    /** how many positions copied this one */
    copiers: number;
  } | null;
  thesis: { id: string; text: string; outcome: string; likes: number; likedByMe: boolean; replies: number; createdAt: string } | null;
  /** fire / skull / eyes counts on this event and which ones the viewer pressed */
  reactions: { fire: number; skull: number; eyes: number; mine: ("fire" | "skull" | "eyes")[] };
  /** comments under a trade event (theses count their own replies) */
  comments: number;
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
  /** the viewer's own address: their own events always pass the size filter */
  viewerAddress?: string;
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
      thesis: { include: { _count: { select: { likes: true, replies: true } }, likes: f.viewerId ? { where: { userId: f.viewerId }, select: { userId: true } } : false } },
    },
  });
  const copiedFromAddrs = rows.map((r) => r.position?.copiedFromAddress).filter((a): a is string => !!a);
  const users = await usersByAddress([...rows.map((r) => r.address), ...copiedFromAddrs]);
  const posIds = rows.map((r) => r.position?.id).filter((x): x is string => !!x);
  const copierRows = posIds.length ? await prisma.position.groupBy({ by: ["copiedFromPositionId"], where: { copiedFromPositionId: { in: posIds } }, _count: { _all: true } }) : [];
  const copiers = new Map(copierRows.map((c) => [c.copiedFromPositionId as string, c._count._all]));
  const ids = rows.map((r) => r.id);
  const [reactions, commentRows] = await Promise.all([
    reactionCounts(ids, f.viewerId),
    ids.length ? prisma.eventReply.groupBy({ by: ["eventId"], where: { eventId: { in: ids } }, _count: { _all: true } }) : [],
  ]);
  const comments = new Map(commentRows.map((c) => [c.eventId, c._count._all]));
  const items: FeedItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    address: r.address,
    coin: r.coin,
    time: r.time.toISOString(),
    payload: (r.payload ?? {}) as Record<string, unknown>,
    user: users.get(r.address) ?? null,
    reactions: reactions.get(r.id) ?? { fire: 0, skull: 0, eyes: 0, mine: [] },
    comments: comments.get(r.id) ?? 0,
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
          copiedFrom: r.position.copiedFromAddress
            ? { address: r.position.copiedFromAddress, handle: users.get(r.position.copiedFromAddress)?.handle ?? null, displayName: users.get(r.position.copiedFromAddress)?.displayName ?? null }
            : null,
          copiers: copiers.get(r.position.id) ?? 0,
        }
      : null,
    thesis: r.thesis
      ? {
          id: r.thesis.id,
          text: r.thesis.text,
          outcome: r.thesis.outcome,
          likes: r.thesis._count.likes,
          likedByMe: Array.isArray(r.thesis.likes) && r.thesis.likes.length > 0,
          replies: r.thesis._count.replies,
          createdAt: r.thesis.createdAt.toISOString(),
        }
      : null,
  }));
  // the size filter is a whale filter for trades: theses are content and always show, and so does everything you posted yourself
  const min = f.minUsd ?? 0;
  const me = f.viewerAddress?.toLowerCase();
  const filtered = min > 0 ? items.filter((i) => i.type === "THESIS" || (me && i.address === me) || Number(i.payload.sizeUsd ?? i.position?.sizeUsd ?? 0) >= min) : items;
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
  /** distinct traders who copied this one, how many positions that was, and what those copies made */
  copiers: number;
  copyTrades: number;
  copiersPnl: number;
};

/** stats for many addresses in three queries instead of two per address */
export async function traderStatsBulk(addresses: string[]): Promise<Map<string, TraderStats>> {
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, TraderStats>();
  if (!addrs.length) return out;
  const now = Date.now();
  const [closed, theses, copies] = await Promise.all([
    prisma.position.findMany({
      where: { address: { in: addrs }, closedAt: { not: null } },
      select: { address: true, realisedPnl: true, openedAt: true, closedAt: true },
    }),
    prisma.thesis.findMany({ where: { user: { address: { in: addrs } } }, select: { outcome: true, user: { select: { address: true } } } }),
    prisma.position.findMany({ where: { copiedFromAddress: { in: addrs } }, select: { address: true, copiedFromAddress: true, realisedPnl: true, unrealisedPnl: true, closedAt: true } }),
  ]);
  type Acc = { n: number; wins: number; pnl7: number; pnl30: number; pnlAll: number; hold: number; th: number; settled: number; profit: number; copiers: Set<string>; copyTrades: number; copiersPnl: number };
  const acc = new Map<string, Acc>();
  const get = (a: string) => {
    let x = acc.get(a);
    if (!x) acc.set(a, (x = { n: 0, wins: 0, pnl7: 0, pnl30: 0, pnlAll: 0, hold: 0, th: 0, settled: 0, profit: 0, copiers: new Set(), copyTrades: 0, copiersPnl: 0 }));
    return x;
  };
  for (const c of copies) {
    const x = get(c.copiedFromAddress!);
    x.copiers.add(c.address);
    x.copyTrades++;
    x.copiersPnl += c.closedAt ? Number(c.realisedPnl ?? 0) : Number(c.unrealisedPnl);
  }
  for (const p of closed) {
    const x = get(p.address);
    const pnl = Number(p.realisedPnl ?? 0);
    const t = p.closedAt!.getTime();
    x.n++;
    if (pnl > 0) x.wins++;
    x.pnlAll += pnl;
    if (t >= now - 7 * 86_400_000) x.pnl7 += pnl;
    if (t >= now - 30 * 86_400_000) x.pnl30 += pnl;
    x.hold += t - p.openedAt.getTime();
  }
  for (const t of theses) {
    const x = get(t.user.address);
    x.th++;
    if (t.outcome !== "OPEN") x.settled++;
    if (t.outcome === "PROFIT") x.profit++;
  }
  for (const a of addrs) {
    const x = get(a);
    out.set(a, {
      winRate: x.n ? x.wins / x.n : null,
      closedTrades: x.n,
      pnl7d: x.pnl7,
      pnl30d: x.pnl30,
      pnlAll: x.pnlAll,
      avgHoldMs: x.n ? x.hold / x.n : null,
      thesisCount: x.th,
      thesisAccuracy: x.settled ? x.profit / x.settled : null,
      copiers: x.copiers.size,
      copyTrades: x.copyTrades,
      copiersPnl: x.copiersPnl,
    });
  }
  return out;
}

export async function traderStats(address: string): Promise<TraderStats> {
  return (await traderStatsBulk([address])).get(address.toLowerCase())!;
}

export type LeaderboardRow = {
  rank: number;
  user: UserLite;
  stats: TraderStats;
  followers: number;
};

const MIN_CLOSED = 5;
const lbCache = new Map<string, { at: number; rows: LeaderboardRow[] }>();

export async function leaderboardRows(by: "pnl7d" | "winRate" | "thesisAccuracy" | "followers", limit = 50): Promise<LeaderboardRow[]> {
  const key = `${by}:${limit}`;
  const hit = lbCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.rows;
  const rows = await computeLeaderboard(by, limit);
  lbCache.set(key, { at: Date.now(), rows });
  return rows;
}

async function computeLeaderboard(by: "pnl7d" | "winRate" | "thesisAccuracy" | "followers", limit: number): Promise<LeaderboardRow[]> {
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
  const stats = await traderStatsBulk(addrs);
  const rows: LeaderboardRow[] = addrs.map((a) => {
    const user = users.get(a) ?? { id: "", address: a, handle: null, displayName: null, xHandle: null, avatarUrl: null, claimed: false };
    return { rank: 0, user, stats: stats.get(a)!, followers: user.id ? (fc.get(user.id) ?? 0) : 0 };
  });
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
  if (!u?.claimedAt) return null;
  return { address: u.address, user: u };
}

// ---------- hyperliquid leaderboard mirror (30d top N, figures as reported by hyperliquid) ----------

export type HlBoardRow = {
  /** rank within the requested window and sort */
  rank: number;
  /** hyperliquid's own 30d rank for this account in the mirrored pool */
  rank30d: number;
  user: UserLite;
  accountValue: number;
  /** figures for the requested window */
  pnl: number;
  roi: number;
  vlm: number;
  /** kept for the 30d widgets */
  pnl30d: number;
  roi30d: number;
  vlm30d: number;
  pnl7d: number;
  followers: number;
  isFollowing: boolean;
};
export type HlBoardWindow = "day" | "week" | "month" | "allTime";
export type HlBoardSort = "pnl" | "roi" | "vlm" | "accountValue";
export type HlBoardQuery = { window?: HlBoardWindow; sort?: HlBoardSort; q?: string; claimedOnly?: boolean; limit?: number; viewerId?: string; /** include accounts that lost money in the window (hidden by default: a leaderboard lists winners) */ all?: boolean };

const HL_BOARD_REFRESH_MS = Number(process.env.HL_LEADERBOARD_REFRESH_MS ?? 60 * 60_000);
const HL_BOARD_TOP_N = Number(process.env.HL_LEADERBOARD_TOP_N ?? 100);
let hlBoardRefreshing: Promise<number> | null = null;
/** one refresh at a time per process; the worker normally does this, the web process covers for it */
function refreshHlBoardOnce(): Promise<number> {
  if (!hlBoardRefreshing) {
    hlBoardRefreshing = refreshHlLeaderboard(HL_BOARD_TOP_N).finally(() => {
      hlBoardRefreshing = null;
    });
  }
  return hlBoardRefreshing;
}

export type HlBoard = { rows: HlBoardRow[]; updatedAt: string | null; source: "leaderboard" | "portfolio" | null; error: string | null; window: HlBoardWindow; sort: HlBoardSort; total: number; /** why the fallback is showing, when it is */ note: string | null };

export async function hlLeaderboard(opts: HlBoardQuery = {}): Promise<HlBoard> {
  const window: HlBoardWindow = opts.window ?? "month";
  const sort: HlBoardSort = opts.sort ?? "pnl";
  const empty = (error: string | null): HlBoard => ({ rows: [], updatedAt: null, source: null, error, window, sort, total: 0, note: null });
  let entries = await prisma.hlLeaderboardEntry.findMany({ orderBy: { rank: "asc" } });
  if (!entries.length) {
    // first visitor on a fresh database: fetch hyperliquid's board right now
    try {
      if (await refreshHlBoardOnce()) entries = await prisma.hlLeaderboardEntry.findMany({ orderBy: { rank: "asc" } });
    } catch (e) {
      return empty((e as Error).message);
    }
    if (!entries.length) return empty(getHlBoardStatus().lastError ?? "no rows returned");
  } else if (Date.now() - entries[0].updatedAt.getTime() > HL_BOARD_REFRESH_MS) {
    void refreshHlBoardOnce().catch(() => {});
  }
  const users = await usersByAddress(entries.map((e) => e.address));
  const userIds = [...users.values()].filter((u) => u.id).map((u) => u.id);
  const [followerRows, myFollows] = await Promise.all([
    userIds.length ? prisma.follow.groupBy({ by: ["followingId"], where: { followingId: { in: userIds } }, _count: { _all: true } }) : [],
    opts.viewerId && userIds.length ? prisma.follow.findMany({ where: { followerId: opts.viewerId, followingId: { in: userIds } }, select: { followingId: true } }) : [],
  ]);
  const followers = new Map(followerRows.map((f) => [f.followingId, f._count._all]));
  const following = new Set(myFollows.map((f) => f.followingId));
  const pick = (e: (typeof entries)[number]) =>
    window === "day" ? { pnl: e.pnl1d, roi: e.roi1d, vlm: e.vlm1d } : window === "week" ? { pnl: e.pnl7d, roi: e.roi7d, vlm: e.vlm7d } : window === "allTime" ? { pnl: e.pnlAll, roi: e.roiAll, vlm: e.vlmAll } : { pnl: e.pnl30d, roi: e.roi30d, vlm: e.vlm30d };
  let rows: HlBoardRow[] = entries.map((e) => {
    const user = users.get(e.address) ?? { id: "", address: e.address, handle: null, displayName: e.displayName, xHandle: null, avatarUrl: null, claimed: false };
    const w = pick(e);
    return {
      rank: 0,
      rank30d: e.rank,
      user,
      accountValue: Number(e.accountValue),
      pnl: Number(w.pnl),
      roi: Number(w.roi),
      vlm: Number(w.vlm),
      pnl30d: Number(e.pnl30d),
      roi30d: Number(e.roi30d),
      vlm30d: Number(e.vlm30d),
      pnl7d: Number(e.pnl7d),
      followers: user.id ? (followers.get(user.id) ?? 0) : 0,
      isFollowing: !!user.id && following.has(user.id),
    };
  });
  // a leaderboard lists winners: accounts that lost money in this window only show with all=1
  if (!opts.all) rows = rows.filter((r) => r.pnl > 0);
  // hyperliquid ranks every window by pnl; roi/volume/account value sorts are ours, on the same pool
  rows.sort((a, b) => (sort === "roi" ? b.roi - a.roi : sort === "vlm" ? b.vlm - a.vlm : sort === "accountValue" ? b.accountValue - a.accountValue : b.pnl - a.pnl));
  rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const total = rows.length;
  if (opts.claimedOnly) rows = rows.filter((r) => r.user.claimed);
  if (opts.q) {
    const q = opts.q.trim().toLowerCase();
    rows = rows.filter((r) => r.user.address.includes(q) || (r.user.handle ?? "").toLowerCase().includes(q) || (r.user.displayName ?? "").toLowerCase().includes(q));
  }
  if (opts.limit) rows = rows.slice(0, opts.limit);
  const source = entries[0].source === "portfolio" ? "portfolio" : "leaderboard";
  return { rows, updatedAt: entries[0].updatedAt.toISOString(), source, error: null, window, sort, total, note: source === "portfolio" ? `showing the featured traders only: hyperliquid's leaderboard feed could not be read (${getHlBoardStatus().lastError ?? "unknown reason"}); retried hourly` : null };
}
