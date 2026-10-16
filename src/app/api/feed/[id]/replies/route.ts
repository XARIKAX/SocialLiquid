import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { notifyAddress } from "@/lib/notify";

export const dynamic = "force-dynamic";

const USER = { select: { id: true, address: true, handle: true, displayName: true, avatarUrl: true } } as const;

/** comments under a trade event, oldest first */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const replies = await prisma.eventReply.findMany({ where: { eventId: id }, orderBy: { createdAt: "asc" }, take: 200, include: { user: USER } });
  return json({ replies });
});

/** comment on a trade. signed in with a claimed handle. the trader gets a notification. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const me = await prisma.user.findUnique({ where: { id: s.userId }, select: { handle: true } });
  if (!me?.handle) throw new HttpError(403, "set up your profile first");
  const { id } = await ctx.params;
  const ev = await prisma.feedEvent.findUnique({ where: { id }, select: { id: true, address: true, coin: true, type: true } });
  if (!ev) throw new HttpError(404, "event not found");
  const { text } = await body(req, z.object({ text: z.string().trim().min(1).max(280) }));
  const reply = await prisma.eventReply.create({ data: { eventId: id, userId: s.userId, text }, include: { user: USER } });
  const count = await prisma.eventReply.count({ where: { eventId: id } });
  await notifyAddress(ev.address, { type: "REPLY", actorAddress: s.address, coin: ev.coin, eventId: id, payload: { text: text.slice(0, 140), eventType: ev.type } }).catch(() => null);
  return json({ reply, count });
});
