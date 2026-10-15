import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

/**
 * stop renewing (or undo that). nothing auto-debits, so cancelling only stops the renewal reminders; a paid
 * month runs to its end. a free feed is unfollowed outright.
 */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { handle, resume } = await body(req, z.object({ handle: z.string().min(1).max(64), resume: z.boolean().optional() }));
  const sub = await prisma.subscription.findFirst({
    where: { subscriberId: s.userId, creator: { user: { handle: { equals: handle, mode: "insensitive" } } } },
    include: { creator: { select: { priceUsd: true } } },
  });
  if (!sub) throw new HttpError(404, "you are not subscribed to that trader");
  if (Number(sub.creator.priceUsd) <= 0 && !resume) {
    await prisma.subscription.delete({ where: { id: sub.id } });
    return json({ ok: true, removed: true });
  }
  const updated = await prisma.subscription.update({ where: { id: sub.id }, data: { cancelledAt: resume ? null : new Date() } });
  return json({ ok: true, removed: false, paidUntil: updated.paidUntil.toISOString(), cancelled: !!updated.cancelledAt });
});
