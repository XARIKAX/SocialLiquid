import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Db = PrismaClient | Prisma.TransactionClient;

export { POINTS, POINT_LABELS } from "./points-table";
export type { PointKind } from "./points-table";
import { POINTS, type PointKind } from "./points-table";

/** award once per (user, kind, refId). returns true when the row was new */
export async function award(userId: string, kind: PointKind, refId: string, db: Db = prisma): Promise<boolean> {
  const r = await db.pointEvent.createMany({ data: { userId, kind, refId, points: POINTS[kind] }, skipDuplicates: true });
  if (r.count === 0) return false;
  await db.user.update({ where: { id: userId }, data: { points: { increment: POINTS[kind] } } });
  return true;
}

/** same, keyed by wallet; only claimed socialLiquid accounts earn points */
export async function awardAddress(address: string, kind: PointKind, refId: string, db: Db = prisma): Promise<boolean> {
  const u = await db.user.findFirst({ where: { address: address.toLowerCase(), claimedAt: { not: null } }, select: { id: true } });
  return u ? award(u.id, kind, refId, db) : false;
}

export type Streaks = { current: number; best: number; /** consecutive utc days with a trade opened or closed, ending today or yesterday */ days: number };

/** win streak (consecutive profitable closes, newest first) and best ever, from the closed positions of one address */
export function streaksFrom(closed: { realisedPnl: number; closedAt: Date; openedAt: Date }[]): Streaks {
  const desc = [...closed].sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
  let current = 0;
  for (const p of desc) {
    if (p.realisedPnl > 0) current++;
    else break;
  }
  let best = 0;
  let run = 0;
  for (const p of [...desc].reverse()) {
    run = p.realisedPnl > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  const dayOf = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  const activeDays = new Set<number>();
  for (const p of closed) {
    activeDays.add(dayOf(p.openedAt));
    activeDays.add(dayOf(p.closedAt));
  }
  const today = dayOf(new Date());
  let days = 0;
  let cursor = activeDays.has(today) ? today : activeDays.has(today - 1) ? today - 1 : null;
  while (cursor !== null && activeDays.has(cursor)) {
    days++;
    cursor--;
  }
  return { current, best, days };
}

export async function streaksBulk(addresses: string[], db: Db = prisma): Promise<Map<string, Streaks>> {
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, Streaks>();
  if (!addrs.length) return out;
  const closed = await db.position.findMany({ where: { address: { in: addrs }, closedAt: { not: null } }, select: { address: true, realisedPnl: true, closedAt: true, openedAt: true } });
  const by = new Map<string, { realisedPnl: number; closedAt: Date; openedAt: Date }[]>();
  for (const c of closed) {
    const list = by.get(c.address) ?? [];
    list.push({ realisedPnl: Number(c.realisedPnl ?? 0), closedAt: c.closedAt!, openedAt: c.openedAt });
    by.set(c.address, list);
  }
  for (const a of addrs) out.set(a, streaksFrom(by.get(a) ?? []));
  return out;
}

/** after a close: recompute the address's streaks and store them on the user row so feed cards can show them for free */
export async function refreshStreaks(address: string, db: Db = prisma): Promise<Streaks> {
  const s = (await streaksBulk([address], db)).get(address.toLowerCase())!;
  await db.user.updateMany({ where: { address: address.toLowerCase() }, data: { winStreak: s.current, bestStreak: s.best } });
  return s;
}

export type Badge = { id: string; label: string; emoji: string; desc: string; earned: boolean };

/** badges are derived, never stored: the same inputs always give the same shelf */
export function badgesFor(x: { closedTrades: number; winRate: number | null; bestStreak: number; profitTheses: number; copiers: number; followers: number; invites: number; avgHoldMs: number | null; days: number }): Badge[] {
  return [
    { id: "first_trade", label: "First blood", emoji: "🩸", desc: "Closed a trade on socialLiquid", earned: x.closedTrades >= 1 },
    { id: "ten_trades", label: "Regular", emoji: "🎯", desc: "10 closed trades", earned: x.closedTrades >= 10 },
    { id: "hundred_trades", label: "Terminal rat", emoji: "🐀", desc: "100 closed trades", earned: x.closedTrades >= 100 },
    { id: "hot_hand", label: "Hot hand", emoji: "🔥", desc: "3 winning trades in a row", earned: x.bestStreak >= 3 },
    { id: "on_fire", label: "On fire", emoji: "☄️", desc: "5 winning trades in a row", earned: x.bestStreak >= 5 },
    { id: "sharp", label: "Sharp", emoji: "🧠", desc: "60%+ win rate over 20+ trades", earned: x.closedTrades >= 20 && (x.winRate ?? 0) >= 0.6 },
    { id: "thesis_sniper", label: "Thesis sniper", emoji: "📌", desc: "3 theses settled in profit", earned: x.profitTheses >= 3 },
    { id: "crowd_favourite", label: "Crowd favourite", emoji: "👥", desc: "Copied by 3 different traders", earned: x.copiers >= 3 },
    { id: "influencer", label: "Voice", emoji: "📣", desc: "25 followers", earned: x.followers >= 25 },
    { id: "diamond_hands", label: "Diamond hands", emoji: "💎", desc: "Average hold over 24h across 10+ trades", earned: x.closedTrades >= 10 && (x.avgHoldMs ?? 0) >= 86_400_000 },
    { id: "streak_week", label: "Seven days", emoji: "📆", desc: "Traded 7 days in a row", earned: x.days >= 7 },
    { id: "recruiter", label: "Recruiter", emoji: "🤝", desc: "3 friends joined with your invite", earned: x.invites >= 3 },
  ];
}

/** points earned in a window per user (for the 7d board) */
export async function pointsSince(userIds: string[], since: Date, db: Db = prisma): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const g = await db.pointEvent.groupBy({ by: ["userId"], where: { userId: { in: userIds }, createdAt: { gte: since } }, _sum: { points: true } });
  return new Map(g.map((x) => [x.userId, x._sum.points ?? 0]));
}

/** one-off / startup: award everything the ledger is missing for claimed users. idempotent, cheap at our scale */
export async function backfillPoints(db: Db = prisma): Promise<{ awarded: number }> {
  const users = await db.user.findMany({ where: { claimedAt: { not: null } }, select: { id: true, address: true } });
  const byAddr = new Map(users.map((u) => [u.address, u.id]));
  let awarded = 0;
  const give = async (userId: string | undefined, kind: PointKind, refId: string) => {
    if (userId && (await award(userId, kind, refId, db))) awarded++;
  };
  const closed = await db.position.findMany({ where: { address: { in: [...byAddr.keys()] }, closedAt: { not: null } }, select: { id: true, address: true, realisedPnl: true } });
  for (const p of closed) {
    await give(byAddr.get(p.address), "TRADE_CLOSED", p.id);
    if (Number(p.realisedPnl ?? 0) > 0) await give(byAddr.get(p.address), "TRADE_WIN", p.id);
  }
  const theses = await db.thesis.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true, userId: true, outcome: true } });
  for (const t of theses) {
    await give(t.userId, "THESIS_POSTED", t.id);
    if (t.outcome === "PROFIT") await give(t.userId, "THESIS_PROFIT", t.id);
  }
  const copies = await db.position.findMany({ where: { copiedFromAddress: { not: null } }, select: { id: true, address: true, copiedFromAddress: true } });
  for (const c of copies) {
    await give(byAddr.get(c.copiedFromAddress!), "COPIED", c.id);
    await give(byAddr.get(c.address), "COPY_MADE", c.id);
  }
  for (const a of byAddr.keys()) await refreshStreaks(a, db);
  return { awarded };
}
