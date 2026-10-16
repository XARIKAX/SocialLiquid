import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

/** the caller opened a trader's feed: its unread count goes back to zero */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { handle } = await body(req, z.object({ handle: z.string().min(1).max(64) }));
  const creator = await prisma.creator.findFirst({ where: { user: { handle: { equals: handle, mode: "insensitive" } } }, select: { id: true } });
  if (!creator) return json({ ok: true });
  const now = new Date();
  await prisma.feedRead.upsert({ where: { userId_creatorId: { userId: s.userId, creatorId: creator.id } }, create: { userId: s.userId, creatorId: creator.id, readAt: now }, update: { readAt: now } });
  return json({ ok: true });
});
