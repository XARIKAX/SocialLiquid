import { handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { feed } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** latest events from the traders the caller follows, plus how many arrived since they last opened the bell */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) return json({ items: [], seenAt: null, unread: 0 });
  const [items, me] = await Promise.all([
    feed({ followingOf: s.userId, viewerId: s.userId, limit: 30, minUsd: 0 }),
    prisma.user.findUnique({ where: { id: s.userId }, select: { alertsSeenAt: true } }),
  ]);
  const seenAt = me?.alertsSeenAt ?? null;
  const unread = seenAt ? items.filter((i) => new Date(i.time) > seenAt).length : items.length;
  return json({ items, seenAt: seenAt?.toISOString() ?? null, unread });
});

/** mark everything up to now as seen */
export const POST = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  await prisma.user.update({ where: { id: s.userId }, data: { alertsSeenAt: new Date() } });
  return json({ ok: true });
});
