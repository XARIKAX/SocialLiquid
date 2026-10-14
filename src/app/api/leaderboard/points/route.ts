import { z } from "zod";
import { handler, json } from "@/lib/api";
import { prisma } from "@/lib/db";
import { pointsSince, streaksBulk } from "@/lib/points";
import { traderStatsBulk, type UserLite } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export type PointsRow = { rank: number; user: UserLite; points: number; weekPoints: number; streak: number; bestStreak: number; closedTrades: number; winRate: number | null; followers: number; isFollowing: boolean };

/** points board: all time or the last 7 days. only claimed socialLiquid accounts, because only they earn points */
export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const window = z.enum(["all", "7d"]).catch("all").parse(u.searchParams.get("window") ?? "all");
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? 50)));
  const s = await getSession();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const base = { id: true, address: true, handle: true, displayName: true, xHandle: true, avatarUrl: true, style: true, points: true, winStreak: true, bestStreak: true } as const;
  let users: { id: string; address: string; handle: string | null; displayName: string | null; xHandle: string | null; avatarUrl: string | null; style: string | null; points: number; winStreak: number; bestStreak: number }[];
  let week = new Map<string, number>();
  if (window === "7d") {
    const g = await prisma.pointEvent.groupBy({ by: ["userId"], where: { createdAt: { gte: since } }, _sum: { points: true }, orderBy: { _sum: { points: "desc" } }, take: limit });
    week = new Map(g.map((x) => [x.userId, x._sum.points ?? 0]));
    const rows = await prisma.user.findMany({ where: { id: { in: g.map((x) => x.userId) }, claimedAt: { not: null } }, select: base });
    users = g.map((x) => rows.find((r) => r.id === x.userId)).filter((r): r is NonNullable<typeof r> => !!r);
  } else {
    users = await prisma.user.findMany({ where: { claimedAt: { not: null }, points: { gt: 0 } }, orderBy: [{ points: "desc" }, { createdAt: "asc" }], take: limit, select: base });
    week = await pointsSince(users.map((x) => x.id), since);
  }
  const ids = users.map((x) => x.id);
  const addrs = users.map((x) => x.address);
  const [stats, streaks, followerCounts, mine] = await Promise.all([
    traderStatsBulk(addrs),
    streaksBulk(addrs),
    ids.length ? prisma.follow.groupBy({ by: ["followingId"], where: { followingId: { in: ids } }, _count: { _all: true } }) : [],
    s && ids.length ? prisma.follow.findMany({ where: { followerId: s.userId, followingId: { in: ids } }, select: { followingId: true } }) : [],
  ]);
  const fc = new Map(followerCounts.map((f) => [f.followingId, f._count._all]));
  const followed = new Set(mine.map((m) => m.followingId));
  const rows: PointsRow[] = users.map((x, i) => {
    const st = stats.get(x.address);
    const sk = streaks.get(x.address);
    return {
      rank: i + 1,
      user: { id: x.id, address: x.address, handle: x.handle, displayName: x.displayName, xHandle: x.xHandle, avatarUrl: x.avatarUrl, claimed: true, style: x.style, winStreak: x.winStreak, points: x.points },
      points: x.points,
      weekPoints: week.get(x.id) ?? 0,
      streak: sk?.current ?? x.winStreak,
      bestStreak: sk?.best ?? x.bestStreak,
      closedTrades: st?.closedTrades ?? 0,
      winRate: st?.winRate ?? null,
      followers: fc.get(x.id) ?? 0,
      isFollowing: followed.has(x.id),
    };
  });
  return json({ window, rows, at: new Date().toISOString() });
});
