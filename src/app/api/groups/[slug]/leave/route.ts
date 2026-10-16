import { handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { groupBySlug } from "@/lib/groups";

export const dynamic = "force-dynamic";

/** leave. the owner hands the group to its longest-standing member, or deletes it when alone */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const g = await groupBySlug(slug);
  const me = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: s.userId } } });
  if (!me) return json({ ok: true, already: true });
  if (g.ownerId === s.userId) {
    const next = await prisma.groupMember.findFirst({ where: { groupId: g.id, userId: { not: s.userId } }, orderBy: { joinedAt: "asc" } });
    if (!next) {
      await prisma.group.delete({ where: { id: g.id } });
      return json({ ok: true, deleted: true });
    }
    await prisma.$transaction([
      prisma.group.update({ where: { id: g.id }, data: { ownerId: next.userId } }),
      prisma.groupMember.update({ where: { groupId_userId: { groupId: g.id, userId: next.userId } }, data: { role: "OWNER" } }),
      prisma.groupMember.delete({ where: { groupId_userId: { groupId: g.id, userId: s.userId } } }),
    ]);
    return json({ ok: true, newOwner: next.userId });
  }
  await prisma.groupMember.delete({ where: { groupId_userId: { groupId: g.id, userId: s.userId } } });
  return json({ ok: true });
});
