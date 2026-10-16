import { handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { feed, usersByAddress, type UserLite } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export type Note = { id: string; type: "COPIED" | "REPLY" | "REACTION" | "THESIS_SETTLED" | "CREATOR_POST"; actorAddress: string | null; actor: UserLite | null; coin: string | null; eventId: string | null; thesisId: string | null; positionId: string | null; payload: Record<string, unknown>; createdAt: string };

/** latest events from the traders the caller follows, the caller's social notifications, and how many of both arrived since the bell was last opened */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) return json({ items: [], notes: [], seenAt: null, unread: 0 });
  const [items, me, rows] = await Promise.all([
    feed({ followingOf: s.userId, viewerId: s.userId, limit: 30, minUsd: 0 }),
    prisma.user.findUnique({ where: { id: s.userId }, select: { alertsSeenAt: true } }),
    prisma.notification.findMany({ where: { userId: s.userId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const actors = await usersByAddress(rows.map((r) => r.actorAddress).filter((a): a is string => !!a));
  const notes: Note[] = rows.map((r) => ({ id: r.id, type: r.type, actorAddress: r.actorAddress, actor: r.actorAddress ? actors.get(r.actorAddress) ?? null : null, coin: r.coin, eventId: r.eventId, thesisId: r.thesisId, positionId: r.positionId, payload: (r.payload ?? {}) as Record<string, unknown>, createdAt: r.createdAt.toISOString() }));
  const seenAt = me?.alertsSeenAt ?? null;
  const unread = (seenAt ? items.filter((i) => new Date(i.time) > seenAt).length : items.length) + (seenAt ? notes.filter((n) => new Date(n.createdAt) > seenAt).length : notes.length);
  return json({ items, notes, seenAt: seenAt?.toISOString() ?? null, unread });
});

/** mark everything up to now as seen */
export const POST = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  await prisma.user.update({ where: { id: s.userId }, data: { alertsSeenAt: new Date() } });
  return json({ ok: true });
});
