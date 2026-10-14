import { handler, json } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export type TrendRow = { coin: string; count: number };
export type Trending = { mostOpened: TrendRow[]; mostOpened1h: TrendRow[]; mostCopied: TrendRow[]; mostTheses: TrendRow[]; followed: TrendRow[] | null; at: string };

const TOP = 8;
let cache: { at: number; value: Omit<Trending, "followed"> } | null = null;

/** markets ranked by social signal rather than volume: opens, copies and theses in the last 24h (and opens in the last hour) */
export const GET = handler(async () => {
  const s = await getSession();
  const now = Date.now();
  if (!cache || now - cache.at > 30_000) {
    const day = new Date(now - 86_400_000);
    const hour = new Date(now - 3_600_000);
    const [opened, opened1h, copied, theses] = await Promise.all([
      prisma.feedEvent.groupBy({ by: ["coin"], where: { type: { in: ["LONG", "SHORT"] }, time: { gte: day } }, _count: { _all: true }, orderBy: { _count: { coin: "desc" } }, take: TOP }),
      prisma.feedEvent.groupBy({ by: ["coin"], where: { type: { in: ["LONG", "SHORT"] }, time: { gte: hour } }, _count: { _all: true }, orderBy: { _count: { coin: "desc" } }, take: TOP }),
      prisma.position.groupBy({ by: ["coin"], where: { copiedFromPositionId: { not: null }, openedAt: { gte: day } }, _count: { _all: true }, orderBy: { _count: { coin: "desc" } }, take: TOP }),
      prisma.feedEvent.groupBy({ by: ["coin"], where: { type: "THESIS", time: { gte: day } }, _count: { _all: true }, orderBy: { _count: { coin: "desc" } }, take: TOP }),
    ]);
    const rows = (g: { coin: string; _count: { _all: number } }[]): TrendRow[] => g.map((x) => ({ coin: x.coin, count: x._count._all }));
    cache = { at: now, value: { mostOpened: rows(opened), mostOpened1h: rows(opened1h), mostCopied: rows(copied), mostTheses: rows(theses), at: new Date(now).toISOString() } };
  }
  let followed: TrendRow[] | null = null;
  if (s) {
    const f = await prisma.follow.findMany({ where: { followerId: s.userId }, select: { following: { select: { address: true } } } });
    const addrs = f.map((x) => x.following.address);
    if (addrs.length) {
      const g = await prisma.feedEvent.groupBy({ by: ["coin"], where: { type: { in: ["LONG", "SHORT"] }, address: { in: addrs }, time: { gte: new Date(now - 86_400_000) } }, _count: { _all: true }, orderBy: { _count: { coin: "desc" } }, take: TOP });
      followed = g.map((x) => ({ coin: x.coin, count: x._count._all }));
    } else followed = [];
  }
  return json({ ...cache.value, followed });
});
