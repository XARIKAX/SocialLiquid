import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { freeSlug, groupLite, mintJoinCode, type GroupLite } from "@/lib/groups";

export const dynamic = "force-dynamic";

const MAX_OWNED = 10;

/** the viewer's groups and the public ones worth discovering */
export const GET = handler(async () => {
  const s = await getSession();
  const inc = { owner: { select: { address: true, handle: true, displayName: true, avatarUrl: true } }, _count: { select: { members: true } } } as const;
  const [mineRows, pub] = await Promise.all([
    s ? prisma.groupMember.findMany({ where: { userId: s.userId }, orderBy: { joinedAt: "desc" }, include: { group: { include: inc } } }) : [],
    prisma.group.findMany({ where: { isPublic: true }, orderBy: [{ members: { _count: "desc" } }, { createdAt: "desc" }], take: 20, include: inc }),
  ]);
  const mine: GroupLite[] = [];
  for (const m of mineRows) mine.push(await groupLite(m.group, m));
  const mineIds = new Set(mine.map((g) => g.id));
  const discover: GroupLite[] = [];
  for (const g of pub) if (!mineIds.has(g.id)) discover.push(await groupLite(g, null));
  return json({ mine, discover });
});

/** create a group; the creator is its owner and first member */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const b = await body(req, z.object({ name: z.string().trim().min(2, "name too short").max(40), description: z.string().trim().max(200).optional().nullable(), isPublic: z.boolean().optional() }));
  const owned = await prisma.group.count({ where: { ownerId: s.userId } });
  if (owned >= MAX_OWNED) throw new HttpError(400, `you already own ${MAX_OWNED} groups`);
  const slug = await freeSlug(b.name);
  const g = await prisma.group.create({
    data: { slug, name: b.name, description: b.description || null, ownerId: s.userId, joinCode: mintJoinCode(), isPublic: !!b.isPublic, members: { create: { userId: s.userId, role: "OWNER" } } },
    include: { owner: { select: { address: true, handle: true, displayName: true, avatarUrl: true } }, _count: { select: { members: true } } },
  });
  return json({ group: await groupLite(g, { role: "OWNER" }), joinCode: g.joinCode });
});
