import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { notifyAddress } from "@/lib/notify";
import { EMOJIS, reactionCounts, type Emoji } from "@/lib/reactions";

/** toggle a reaction on a feed event. returns the event's counts and which ones are mine. */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { eventId, emoji } = await body(req, z.object({ eventId: z.string().min(1).max(40), emoji: z.enum(EMOJIS) }));
  const ev = await prisma.feedEvent.findUnique({ where: { id: eventId }, select: { id: true, address: true, coin: true, type: true } });
  if (!ev) throw new HttpError(404, "event not found");
  const key = { userId_eventId_emoji: { userId: s.userId, eventId, emoji } };
  const existing = await prisma.reaction.findUnique({ where: key });
  if (existing) await prisma.reaction.delete({ where: key });
  else {
    await prisma.reaction.create({ data: { userId: s.userId, eventId, emoji } });
    await notifyAddress(ev.address, { type: "REACTION", actorAddress: s.address, coin: ev.coin, eventId, payload: { emoji: emoji as Emoji, eventType: ev.type } }).catch(() => null);
  }
  const counts = await reactionCounts([eventId], s.userId);
  return json({ reacted: !existing, ...counts.get(eventId)! });
});
