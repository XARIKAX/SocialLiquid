import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { thesisId } = await body(req, z.object({ thesisId: z.string().min(1) }));
  const existing = await prisma.like.findUnique({ where: { userId_thesisId: { userId: s.userId, thesisId } } });
  if (existing) await prisma.like.delete({ where: { userId_thesisId: { userId: s.userId, thesisId } } });
  else await prisma.like.create({ data: { userId: s.userId, thesisId } });
  const likes = await prisma.like.count({ where: { thesisId } });
  return json({ liked: !existing, likes });
});
