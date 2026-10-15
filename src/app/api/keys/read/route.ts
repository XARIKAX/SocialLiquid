import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

/** the caller opened a creator's feed: their unread count goes back to zero */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { handle } = await body(req, z.object({ handle: z.string().min(1).max(64) }));
  await prisma.subscription.updateMany({ where: { subscriberId: s.userId, creator: { user: { handle: { equals: handle, mode: "insensitive" } } } }, data: { readAt: new Date() } });
  return json({ ok: true });
});
