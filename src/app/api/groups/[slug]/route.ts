import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { groupBySlug, groupLite, groupMembers, membershipOf, mintJoinCode } from "@/lib/groups";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

/** the group page payload. outsiders of a private group get the card and member count, nothing more */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const s = await getSession();
  const g = await groupBySlug(slug);
  const m = await membershipOf(g.id, s?.userId);
  const lite = await groupLite(g, m);
  const readable = g.isPublic || !!m;
  const members = readable ? await groupMembers(g.id, s?.userId) : [];
  return json({ group: lite, members, joinCode: m ? g.joinCode : null, readable });
});

/** owner: description, visibility, rotate the join code */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const g = await groupBySlug(slug);
  if (g.ownerId !== s.userId) throw new HttpError(403, "owner only");
  const b = await body(req, z.object({ name: z.string().trim().min(2).max(40).optional(), description: z.string().trim().max(200).optional().nullable(), isPublic: z.boolean().optional(), rotateCode: z.boolean().optional() }));
  const upd = await prisma.group.update({ where: { id: g.id }, data: { ...(b.name !== undefined ? { name: b.name } : {}), ...(b.description !== undefined ? { description: b.description || null } : {}), ...(b.isPublic !== undefined ? { isPublic: b.isPublic } : {}), ...(b.rotateCode ? { joinCode: mintJoinCode() } : {}) } });
  return json({ ok: true, joinCode: upd.joinCode, isPublic: upd.isPublic, description: upd.description, name: upd.name });
});

/** owner: delete the group */
export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const g = await groupBySlug(slug);
  if (g.ownerId !== s.userId) throw new HttpError(403, "owner only");
  await prisma.group.delete({ where: { id: g.id } });
  return json({ ok: true });
});
