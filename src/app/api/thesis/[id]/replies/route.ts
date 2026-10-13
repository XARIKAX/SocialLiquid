import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

const USER = { select: { id: true, address: true, handle: true, displayName: true, avatarUrl: true } } as const;

/** replies on a thesis, oldest first */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const replies = await prisma.thesisReply.findMany({ where: { thesisId: id }, orderBy: { createdAt: "asc" }, take: 200, include: { user: USER } });
  return json({ replies });
});

/** post a reply. signed in with a claimed handle. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const me = await prisma.user.findUnique({ where: { id: s.userId }, select: { handle: true } });
  if (!me?.handle) throw new HttpError(403, "set up your profile first");
  const { id } = await ctx.params;
  const thesis = await prisma.thesis.findUnique({ where: { id }, select: { id: true, userId: true, coin: true } });
  if (!thesis) throw new HttpError(404, "thesis not found");
  const { text } = await body(req, z.object({ text: z.string().trim().min(1).max(280) }));
  const reply = await prisma.thesisReply.create({ data: { thesisId: id, userId: s.userId, text }, include: { user: USER } });
  const count = await prisma.thesisReply.count({ where: { thesisId: id } });
  await notify({ userId: thesis.userId, type: "REPLY", actorAddress: s.address, coin: thesis.coin, thesisId: id, payload: { text: text.slice(0, 140), eventType: "THESIS" } }).catch(() => null);
  return json({ reply, count });
});
