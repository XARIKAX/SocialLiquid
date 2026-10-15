/**
 * background work for keys, run by the worker:
 *  - accrue: each closed UTC day, the builder fees paid on copies of a trader's positions are split into the
 *    holder share (deposited into the keys contract for that trader's holders) and the trader's own share.
 *    scripts/keys-distribute.ts pays both out; this only records what is owed.
 *  - remind: a subscriber whose paid month ends within three days gets one alert to renew.
 */
import { prisma } from "./db";
import { CREATOR_FEE_SHARE, HOLDER_SHARE } from "./keys";

const DAY = 86_400_000;

type Row = { trader: string; fills: number; fees: unknown };

/**
 * builder fees by copied trader for [start, end). a fill belongs to the copier's position on that coin whose open
 * window contains it; where two windows touch (a flip), the more recently opened position takes it.
 */
export async function copierFees(start: Date, end: Date): Promise<{ trader: string; fills: number; fees: number }[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p."copiedFromAddress" AS trader, COUNT(*)::int AS fills, COALESCE(SUM(m."builderFee"), 0) AS fees
    FROM (
      SELECT DISTINCT ON (f.id) f.id, f."builderFee", p.id AS pid
      FROM "Fill" f
      JOIN "Position" p ON p.address = f.address AND p.coin = f.coin
        AND f.time >= p."openedAt" - interval '5 seconds'
        AND f.time <= COALESCE(p."closedAt", now()) + interval '5 seconds'
      WHERE f.time >= ${start} AND f.time < ${end} AND f."builderFee" > 0
      ORDER BY f.id, p."openedAt" DESC
    ) m
    JOIN "Position" p ON p.id = m.pid
    WHERE p."copiedFromAddress" IS NOT NULL AND p."copiedFromAddress" <> p.address
    GROUP BY 1`;
  return rows.map((r) => ({ trader: r.trader, fills: Number(r.fills), fees: Number(r.fees ?? 0) }));
}

/**
 * record the split for the last `days` closed days. a day already paid out (either share) is never rewritten; an
 * unpaid one is refreshed, so fills the indexer picks up late still count.
 */
export async function accrueKeyFees(days = 7): Promise<number> {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  let n = 0;
  for (let d = days; d >= 1; d--) {
    const start = new Date(today - d * DAY);
    const end = new Date(start.getTime() + DAY);
    const rows = await copierFees(start, end);
    if (!rows.length) continue;
    const creators = await prisma.creator.findMany({ where: { active: true, user: { address: { in: rows.map((r) => r.trader) } } }, select: { user: { select: { address: true } } } });
    const isCreator = new Set(creators.map((c) => c.user.address));
    for (const r of rows) {
      const data = {
        periodEnd: end,
        fills: r.fills,
        builderFeesUsd: r.fees,
        holderShareUsd: r.fees * HOLDER_SHARE,
        creatorShareUsd: r.fees * CREATOR_FEE_SHARE,
      };
      const existing = await prisma.keyFeeAccrual.findUnique({ where: { traderAddress_periodStart: { traderAddress: r.trader, periodStart: start } } });
      if (!existing) {
        // a trader who never set up keys has no payout address on file: their share stays with the protocol
        await prisma.keyFeeAccrual.create({ data: { traderAddress: r.trader, periodStart: start, ...data, creatorStatus: isCreator.has(r.trader) ? "pending" : "skipped" } });
        n++;
      } else if (existing.holderStatus === "pending" && existing.creatorStatus === "pending" && Number(existing.builderFeesUsd) !== r.fees) {
        await prisma.keyFeeAccrual.update({ where: { id: existing.id }, data });
        n++;
      }
    }
  }
  return n;
}

/** one renewal alert per paid period, three days before it ends, unless the subscriber cancelled */
export async function remindRenewals(): Promise<number> {
  const now = Date.now();
  const due = await prisma.subscription.findMany({
    where: { cancelledAt: null, paidUntil: { gt: new Date(now), lte: new Date(now + 3 * DAY) }, creator: { priceUsd: { gt: 0 } } },
    include: { creator: { select: { priceUsd: true, user: { select: { address: true, handle: true } } } } },
  });
  let n = 0;
  for (const s of due) {
    const actor = s.creator.user.address;
    const sent = await prisma.notification.findFirst({ where: { userId: s.subscriberId, type: "SUB_ENDING", actorAddress: actor, createdAt: { gt: new Date(s.paidUntil.getTime() - 4 * DAY) } }, select: { id: true } });
    if (sent) continue;
    await prisma.notification.create({ data: { userId: s.subscriberId, type: "SUB_ENDING", actorAddress: actor, payload: { handle: s.creator.user.handle, paidUntil: s.paidUntil.toISOString(), price: Number(s.creator.priceUsd) } } });
    n++;
  }
  return n;
}
