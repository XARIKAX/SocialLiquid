/** db queries shared by route handlers and server components */
import { Prisma, type FeedEventType } from "@prisma/client";
import { prisma } from "./db";
import { reactionCounts } from "./reactions";
import { getHlBoardStatus, refreshHlLeaderboard } from "./indexer";
import { plain } from "./api";

/** handle is only set for claimed accounts and is what /t/[handle] resolves. displayName is the hyperliquid leaderboard name. */
export type UserLite = { id: string; address: string; handle: string | null; displayName: string | null; xHandle: string | null; avatarUrl: string | null; claimed: boolean; /** trading-style tag the trader picked */ style?: string | null; /** consecutive profitable closes, maintained by the indexer */ winStreak?: number; points?: number };

export async function usersByAddress(addresses: string[]): Promise<Map<string, UserLite>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!uniq.length) return new Map();
  const users = await prisma.user.findMany({
    where: { address: { in: uniq } },
    select: { id: true, address: true, handle: true, displayName: true, xHandle: true, avatarUrl: true, claimedAt: true, style: true, winStreak: true, points: true },
  });
  const tracked = await prisma.trackedAddress.findMany({ where: { address: { in: uniq }, displayName: { not: null } }, select: { address: true, displayName: true } });
  const map = new Map<string, UserLite>();
  const names = new Map(tracked.map((t) => [t.address, t.displayName]));
  for (const u of users) map.set(u.address, { id: u.id, address: u.address, handle: u.claimedAt ? u.handle : null, displayName: (u.claimedAt ? u.displayName : null) ?? names.get(u.address) ?? null, xHandle: u.xHandle, avatarUrl: u.avatarUrl, claimed: !!u.claimedAt, style: u.claimedAt ? u.style : null, winStreak: u.claimedAt ? u.winStreak : 0, points: u.claimedAt ? u.points : 0 });
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
  /** closes in the last 7 days */
  trades7d: number;
  /** deepest fall of cumulative realised pnl from its peak, in USDC (0 = never below a peak) */
  maxDrawdown: number;
  /** share of trading weeks that ended positive; null under 2 weeks of history */
  consistency: number | null;
  weeks: number;
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
  type Acc = { n: number; wins: number; pnl7: number; n7: number; pnl30: number; pnlAll: number; hold: number; th: number; settled: number; profit: number; copiers: Set<string>; copyTrades: number; copiersPnl: number; closes: { t: number; pnl: number }[] };
  const acc = new Map<string, Acc>();
  const get = (a: string) => {
    let x = acc.get(a);
    if (!x) acc.set(a, (x = { n: 0, wins: 0, pnl7: 0, n7: 0, pnl30: 0, pnlAll: 0, hold: 0, th: 0, settled: 0, profit: 0, copiers: new Set(), copyTrades: 0, copiersPnl: 0, closes: [] }));
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
    if (t >= now - 7 * 86_400_000) {
      x.pnl7 += pnl;
      x.n7++;
    }
    if (t >= now - 30 * 86_400_000) x.pnl30 += pnl;
    x.hold += t - p.openedAt.getTime();
    x.closes.push({ t, pnl });
  }
  for (const t of theses) {
    const x = get(t.user.address);
    x.th++;
    if (t.outcome !== "OPEN") x.settled++;
    if (t.outcome === "PROFIT") x.profit++;
  }
  for (const a of addrs) {
    const x = get(a);
    // drawdown of the realised curve and the share of positive weeks
    x.closes.sort((p, q) => p.t - q.t);
    let cum = 0, peak = 0, dd = 0;
    const weeks = new Map<number, number>();
    for (const c of x.closes) {
      cum += c.pnl;
      if (cum > peak) peak = cum;
      if (peak - cum > dd) dd = peak - cum;
      const wk = Math.floor(c.t / (7 * 86_400_000));
      weeks.set(wk, (weeks.get(wk) ?? 0) + c.pnl);
    }
    const positiveWeeks = [...weeks.values()].filter((v) => v > 0).length;
    out.set(a, {
      trades7d: x.n7,
      maxDrawdown: dd,
      consistency: weeks.size >= 2 ? positiveWeeks / weeks.size : null,
      weeks: weeks.size,
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

// ---------- shared enrichment: what every board row carries besides its own numbers ----------

/** the biggest open position right now, and how many there are */
export type LiveState = { count: number; coin: string; side: string; sizeUsd: number; leverage: number; positionId: string } | null;
export type { TradeStyle, SizeBucket } from "./board-shared";
import { inSizeBucket, type SizeBucket, type TradeStyle } from "./board-shared";
export { SIZE_BUCKETS, TRADE_STYLE_LABEL, inSizeBucket } from "./board-shared";

export function tradeStyleOf(s: TraderStats | undefined): TradeStyle {
  if (!s || s.closedTrades < 5 || s.avgHoldMs === null) return null;
  if (s.avgHoldMs < 120_000 || s.trades7d > 700) return "bot";
  if (s.avgHoldMs < 3_600_000) return "scalper";
  if (s.avgHoldMs < 86_400_000) return "day";
  if (s.avgHoldMs < 7 * 86_400_000) return "swing";
  return "position";
}


export type Enrich = { user: UserLite; stats: TraderStats; live: LiveState; streak: number; style: TradeStyle; followers: number; isFollowing: boolean; accountValue: number | null };

/** everything social and behavioural about a set of addresses, in a handful of queries */
export async function enrichAddresses(addresses: string[], viewerId?: string): Promise<Map<string, Enrich>> {
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, Enrich>();
  if (!addrs.length) return out;
  const [users, stats, open, tracked] = await Promise.all([
    usersByAddress(addrs),
    traderStatsBulk(addrs),
    prisma.position.findMany({ where: { address: { in: addrs }, closedAt: null }, orderBy: { sizeUsd: "desc" }, select: { id: true, address: true, coin: true, side: true, sizeUsd: true, leverage: true } }),
    prisma.trackedAddress.findMany({ where: { address: { in: addrs } }, select: { address: true, accountValue: true } }),
  ]);
  const userIds = [...users.values()].filter((u) => u.id).map((u) => u.id);
  const [followerRows, myFollows] = await Promise.all([
    userIds.length ? prisma.follow.groupBy({ by: ["followingId"], where: { followingId: { in: userIds } }, _count: { _all: true } }) : [],
    viewerId && userIds.length ? prisma.follow.findMany({ where: { followerId: viewerId, followingId: { in: userIds } }, select: { followingId: true } }) : [],
  ]);
  const followers = new Map(followerRows.map((f) => [f.followingId, f._count._all]));
  const following = new Set(myFollows.map((f) => f.followingId));
  const live = new Map<string, LiveState>();
  for (const p of open) {
    const cur = live.get(p.address);
    if (!cur) live.set(p.address, { count: 1, coin: p.coin, side: p.side, sizeUsd: Number(p.sizeUsd), leverage: p.leverage, positionId: p.id });
    else cur.count++;
  }
  const av = new Map(tracked.map((t) => [t.address, t.accountValue === null ? null : Number(t.accountValue)]));
  for (const a of addrs) {
    const user = users.get(a) ?? { id: "", address: a, handle: null, displayName: null, xHandle: null, avatarUrl: null, claimed: false };
    const st = stats.get(a)!;
    out.set(a, { user, stats: st, live: live.get(a) ?? null, streak: user.winStreak ?? 0, style: tradeStyleOf(st), followers: user.id ? (followers.get(user.id) ?? 0) : 0, isFollowing: !!user.id && following.has(user.id), accountValue: av.get(a) ?? null });
  }
  return out;
}

export type LeaderboardRow = {
  rank: number;
  user: UserLite;
  stats: TraderStats;
  followers: number;
  isFollowing: boolean;
  live: LiveState;
  streak: number;
  style: TradeStyle;
  accountValue: number | null;
};
export type OwnBoardBy = "pnl7d" | "pnl30d" | "pnlAll" | "winRate" | "thesisAccuracy" | "followers" | "copiersPnl" | "copiers" | "drawdown" | "consistency";
export type BoardFilters = { copyable?: boolean; size?: SizeBucket; viewerId?: string };

const MIN_CLOSED = 5;
const lbCache = new Map<string, { at: number; rows: Omit<LeaderboardRow, "isFollowing">[] }>();

export async function leaderboardRows(by: OwnBoardBy, limit = 50, f: BoardFilters = {}): Promise<LeaderboardRow[]> {
  const key = `${by}:${limit}:${f.copyable ? 1 : 0}:${f.size ?? ""}`;
  const hit = lbCache.get(key);
  let rows = hit && Date.now() - hit.at < 30_000 ? hit.rows : null;
  if (!rows) {
    rows = await computeLeaderboard(by, limit, f);
    lbCache.set(key, { at: Date.now(), rows });
  }
  // who the viewer follows is per request, never cached
  const ids = rows.map((r) => r.user.id).filter(Boolean);
  const mine = f.viewerId && ids.length ? new Set((await prisma.follow.findMany({ where: { followerId: f.viewerId, followingId: { in: ids } }, select: { followingId: true } })).map((x) => x.followingId)) : new Set<string>();
  return rows.map((r) => ({ ...r, isFollowing: !!r.user.id && mine.has(r.user.id) }));
}

async function computeLeaderboard(by: OwnBoardBy, limit: number, f: BoardFilters): Promise<Omit<LeaderboardRow, "isFollowing">[]> {
  // candidates: addresses with >= 5 closed positions (any copied trade counts for the best-to-follow board)
  const grouped = await prisma.position.groupBy({
    by: ["address"],
    where: { closedAt: { not: null } },
    _count: { _all: true },
    having: { address: { _count: { gte: MIN_CLOSED } } },
    orderBy: { _count: { address: "desc" } },
    take: 400,
  });
  const copied = by === "copiersPnl" || by === "copiers" ? await prisma.position.findMany({ where: { copiedFromAddress: { not: null } }, distinct: ["copiedFromAddress"], select: { copiedFromAddress: true } }) : [];
  const addrs = [...new Set([...grouped.map((g) => g.address), ...copied.map((c) => c.copiedFromAddress!)])];
  const en = await enrichAddresses(addrs);
  let rows: Omit<LeaderboardRow, "isFollowing">[] = addrs.map((a) => {
    const e = en.get(a)!;
    return { rank: 0, user: e.user, stats: e.stats, followers: e.followers, live: e.live, streak: e.streak, style: e.style, accountValue: e.accountValue };
  });
  if (f.copyable) rows = rows.filter((r) => r.style !== "bot");
  if (f.size) rows = rows.filter((r) => inSizeBucket(r.accountValue, f.size));
  if (by === "copiersPnl" || by === "copiers") rows = rows.filter((r) => r.stats.copyTrades > 0);
  if (by === "drawdown" || by === "consistency") rows = rows.filter((r) => r.stats.closedTrades >= 10);
  const key = (r: Omit<LeaderboardRow, "isFollowing">) =>
    by === "pnl7d" ? r.stats.pnl7d
    : by === "pnl30d" ? r.stats.pnl30d
    : by === "pnlAll" ? r.stats.pnlAll
    : by === "winRate" ? (r.stats.winRate ?? -1)
    : by === "thesisAccuracy" ? (r.stats.thesisAccuracy ?? -1)
    : by === "copiersPnl" ? r.stats.copiersPnl
    : by === "copiers" ? r.stats.copiers
    : by === "drawdown" ? -(r.stats.maxDrawdown / Math.max(1, Math.abs(r.stats.pnlAll) + r.stats.maxDrawdown)) // smallest drawdown per unit of pnl first
    : by === "consistency" ? (r.stats.consistency ?? -1)
    : r.followers;
  rows.sort((x, y) => key(y) - key(x) || y.stats.pnl30d - x.stats.pnl30d);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------- per-market board: who makes money on one coin ----------
export type MarketBoardRow = { rank: number; user: UserLite; pnl: number; trades: number; wins: number; winRate: number | null; live: LiveState; streak: number; style: TradeStyle; followers: number; isFollowing: boolean; copiers: number };
export async function marketLeaderboard(coin: string, window: "7d" | "30d" | "all", viewerId?: string, limit = 50): Promise<MarketBoardRow[]> {
  const since = window === "7d" ? new Date(Date.now() - 7 * 86_400_000) : window === "30d" ? new Date(Date.now() - 30 * 86_400_000) : undefined;
  const where = { coin, closedAt: since ? { gte: since } : { not: null } } as const;
  const [sums, wins] = await Promise.all([
    prisma.position.groupBy({ by: ["address"], where, _sum: { realisedPnl: true }, _count: { _all: true }, orderBy: { _sum: { realisedPnl: "desc" } }, take: limit }),
    prisma.position.groupBy({ by: ["address"], where: { ...where, realisedPnl: { gt: 0 } }, _count: { _all: true } }),
  ]);
  const w = new Map(wins.map((x) => [x.address, x._count._all]));
  const en = await enrichAddresses(sums.map((x) => x.address), viewerId);
  return sums
    .filter((x) => Number(x._sum.realisedPnl ?? 0) > 0)
    .map((x, i) => {
      const e = en.get(x.address)!;
      const trades = x._count._all;
      return { rank: i + 1, user: e.user, pnl: Number(x._sum.realisedPnl ?? 0), trades, wins: w.get(x.address) ?? 0, winRate: trades ? (w.get(x.address) ?? 0) / trades : null, live: e.live, streak: e.streak, style: e.style, followers: e.followers, isFollowing: e.isFollowing, copiers: e.stats.copiers };
    });
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
  /** places gained since the previous hourly refresh in this window (negative = fell); null when not ranked before */
  delta: number | null;
  /** first appeared in the mirrored pool at the latest refresh */
  isNew: boolean;
  /** pnl per dollar traded in the window */
  pnlPerVlm: number;
  stats: TraderStats;
  live: LiveState;
  streak: number;
  style: TradeStyle;
};
export type HlBoardWindow = "day" | "week" | "month" | "allTime";
export type HlBoardSort = "pnl" | "roi" | "vlm" | "accountValue" | "movers" | "copiersPnl" | "copiers" | "drawdown" | "consistency" | "pnlPerVlm";
export type HlBoardQuery = { window?: HlBoardWindow; sort?: HlBoardSort; q?: string; claimedOnly?: boolean; limit?: number; viewerId?: string; /** include accounts that lost money in the window (hidden by default: a leaderboard lists winners) */ all?: boolean; /** hide market makers and bots */ copyable?: boolean; size?: SizeBucket };

const HL_BOARD_REFRESH_MS = Number(process.env.HL_LEADERBOARD_REFRESH_MS ?? 60 * 60_000);
const HL_BOARD_TOP_N = Number(process.env.HL_LEADERBOARD_TOP_N ?? 150);
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
  const en = await enrichAddresses(entries.map((e) => e.address), opts.viewerId);
  const pick = (e: (typeof entries)[number]) =>
    window === "day" ? { pnl: e.pnl1d, roi: e.roi1d, vlm: e.vlm1d, cur: e.rank1d, prev: e.prev1d } : window === "week" ? { pnl: e.pnl7d, roi: e.roi7d, vlm: e.vlm7d, cur: e.rank7d, prev: e.prev7d } : window === "allTime" ? { pnl: e.pnlAll, roi: e.roiAll, vlm: e.vlmAll, cur: e.rankAll, prev: e.prevAll } : { pnl: e.pnl30d, roi: e.roi30d, vlm: e.vlm30d, cur: e.rank, prev: e.prev30d };
  const latest = entries[0].updatedAt.getTime();
  let rows: HlBoardRow[] = entries.map((e) => {
    const x = en.get(e.address)!;
    const user = x.user.displayName || x.user.handle ? x.user : { ...x.user, displayName: e.displayName };
    const w = pick(e);
    const pnl = Number(w.pnl), vlm = Number(w.vlm);
    return {
      rank: 0,
      rank30d: e.rank,
      user,
      accountValue: Number(e.accountValue),
      pnl,
      roi: Number(w.roi),
      vlm,
      pnl30d: Number(e.pnl30d),
      roi30d: Number(e.roi30d),
      vlm30d: Number(e.vlm30d),
      pnl7d: Number(e.pnl7d),
      followers: x.followers,
      isFollowing: x.isFollowing,
      delta: w.cur !== null && w.prev !== null ? w.prev - w.cur : null,
      isNew: !!e.firstSeenAt && Math.abs(latest - e.firstSeenAt.getTime()) < 5_000,
      pnlPerVlm: vlm > 0 ? pnl / vlm : 0,
      stats: x.stats,
      live: x.live,
      streak: x.streak,
      style: x.style,
    };
  });
  // a leaderboard lists winners: accounts that lost money in this window only show with all=1
  if (!opts.all) rows = rows.filter((r) => r.pnl > 0);
  if (opts.copyable) rows = rows.filter((r) => r.style !== "bot");
  if (opts.size) rows = rows.filter((r) => inSizeBucket(r.accountValue, opts.size));
  // hyperliquid ranks every window by pnl; the other sorts are ours, on the same pool
  const key = (r: HlBoardRow) =>
    sort === "roi" ? r.roi
    : sort === "vlm" ? r.vlm
    : sort === "accountValue" ? r.accountValue
    : sort === "movers" ? (r.delta ?? Number.NEGATIVE_INFINITY)
    : sort === "copiersPnl" ? r.stats.copiersPnl
    : sort === "copiers" ? r.stats.copiers
    : sort === "drawdown" ? -(r.stats.maxDrawdown / Math.max(1, r.accountValue))
    : sort === "consistency" ? (r.stats.consistency ?? -1)
    : sort === "pnlPerVlm" ? r.pnlPerVlm
    : r.pnl;
  rows.sort((a, b) => key(b) - key(a) || b.pnl - a.pnl);
  if (sort === "movers") rows = rows.filter((r) => r.delta !== null && r.delta > 0);
  rows = rows.map((r, i) => ({ ...r, rank: sort === "pnl" ? i + 1 : i + 1 }));
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
