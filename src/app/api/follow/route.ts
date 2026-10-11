import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const GET = handler(async () => {
  const s = await getSession();
  if (!s) return json({ addresses: [] });
  const rows = await prisma.follow.findMany({ where: { followerId: s.userId }, select: { following: { select: { address: true } } } });
  return json({ addresses: rows.map((r) => r.following.address) });
});

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { address, follow } = await body(req, z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), follow: z.boolean() }));
  const lower = address.toLowerCase();
  if (lower === s.address) throw new HttpError(400, "cannot follow yourself");
  // any hyperliquid address can be followed; it gets a shadow user row until claimed
  const target = await prisma.user.upsert({ where: { address: lower }, create: { address: lower }, update: {} });
  if (follow) {
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: s.userId, followingId: target.id } },
      create: { followerId: s.userId, followingId: target.id },
      update: {},
    });
  } else {
    await prisma.follow.deleteMany({ where: { followerId: s.userId, followingId: target.id } });
  }
  const followers = await prisma.follow.count({ where: { followingId: target.id } });
  return json({ following: follow, followers });
});
