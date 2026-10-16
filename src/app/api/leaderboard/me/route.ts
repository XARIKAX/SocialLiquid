import { handler, json } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hlLeaderboard, leaderboardRows } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export type MyRank = {
  points: { rank: number; total: number; gap: number | null; above: { handle: string | null; address: string } | null } | null;
  pnl7d: { rank: number | null; pnl: number; gap: number | null; of: number };
  hl: { rank: number; delta: number | null; window: "month" } | null;
};

/** where the signed-in user stands on each board, and what separates them from the next place up */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) return json({ me: null });
  const me = await prisma.user.findUnique({ where: { id: s.userId }, select: { points: true, address: true } });
  if (!me) return json({ me: null });
  const [above, nextUp, own, hl] = await Promise.all([
    prisma.user.count({ where: { claimedAt: { not: null }, points: { gt: me.points } } }),
    prisma.user.findFirst({ where: { claimedAt: { not: null }, points: { gt: me.points } }, orderBy: { points: "asc" }, select: { points: true, handle: true, address: true } }),
    leaderboardRows("pnl7d", 200),
    hlLeaderboard({ window: "month", limit: 500 }),
  ]);
  const i = own.findIndex((r) => r.user.address === me.address);
  const mine = i >= 0 ? own[i] : null;
  const hlRow = hl.rows.find((r) => r.user.address === me.address);
  const out: MyRank = {
    points: me.points > 0 ? { rank: above + 1, total: me.points, gap: nextUp ? nextUp.points - me.points : null, above: nextUp ? { handle: nextUp.handle, address: nextUp.address } : null } : null,
    pnl7d: { rank: mine ? mine.rank : null, pnl: mine?.stats.pnl7d ?? 0, gap: mine && i > 0 ? own[i - 1].stats.pnl7d - mine.stats.pnl7d : null, of: own.length },
    hl: hlRow ? { rank: hlRow.rank, delta: hlRow.delta, window: "month" } : null,
  };
  return json({ me: out });
});
