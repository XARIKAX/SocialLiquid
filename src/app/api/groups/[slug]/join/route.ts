import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { groupBySlug } from "@/lib/groups";

export const dynamic = "force-dynamic";
const MAX_MEMBERS = 200;

/** join with the code (or freely when the group is public) */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { code } = await body(req, z.object({ code: z.string().trim().max(32).optional().nullable() }));
  const g = await groupBySlug(slug);
  const already = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: s.userId } } });
  if (already) return json({ ok: true, already: true });
  if (!g.isPublic && (code ?? "").toUpperCase() !== g.joinCode) throw new HttpError(403, "wrong invite code");
  if (g._count.members >= MAX_MEMBERS) throw new HttpError(400, "this group is full");
  await prisma.groupMember.create({ data: { groupId: g.id, userId: s.userId } });
  return json({ ok: true });
});
