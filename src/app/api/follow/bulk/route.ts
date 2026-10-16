import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** follow up to 25 addresses in one go: "follow the top 10" from a board */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { addresses } = await body(req, z.object({ addresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).min(1).max(25) }));
  const targets = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => a !== s.address);
  let added = 0;
  for (const address of targets) {
    const u = await prisma.user.upsert({ where: { address }, create: { address }, update: {}, select: { id: true } });
    const r = await prisma.follow.createMany({ data: { followerId: s.userId, followingId: u.id }, skipDuplicates: true });
    added += r.count;
  }
  return json({ ok: true, added, following: targets });
});
