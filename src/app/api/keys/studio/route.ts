import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { CADENCE_KEYS, OFFER_KEYS, SUB_PRICE_MAX, SUBS_TREASURY } from "@/lib/keys";
import { readTrader } from "@/lib/keys-chain";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

const DAY = 86_400_000;
/** when a free feed starts charging, its followers keep reading for a week before the paywall applies */
const GRACE_DAYS = 7;

const Settings = z.object({
  price: z.number().int().min(0).max(SUB_PRICE_MAX),
  offers: z.array(z.enum(OFFER_KEYS)).min(1).max(OFFER_KEYS.length),
  cadence: z.enum(CADENCE_KEYS),
  pinned: z.string().trim().max(500).optional(),
  payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  active: z.boolean().optional(),
});

/** create or update the caller's creator profile: price, what is included, how often they post */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const input = await body(req, Settings);
  const user = await prisma.user.findUnique({ where: { id: s.userId }, include: { creator: true } });
  if (!user?.claimedAt) throw new HttpError(401, "sign in first");
  if (!user.handle) throw new HttpError(400, "pick a handle on your profile first: it is the address of your page");
  const payoutAddress = (input.payoutAddress ?? user.creator?.payoutAddress ?? user.address).toLowerCase();
  if (SUBS_TREASURY && payoutAddress === SUBS_TREASURY) throw new HttpError(400, "that payout address is the platform's");
  const data = { priceUsd: input.price, offers: [...new Set(input.offers)], cadence: input.cadence, pinned: input.pinned || null, payoutAddress, ...(input.active !== undefined ? { active: input.active } : {}) };
  const wasFree = user.creator ? Number(user.creator.priceUsd) === 0 : false;
  const creator = user.creator
    ? await prisma.creator.update({ where: { id: user.creator.id }, data })
    : await prisma.creator.create({ data: { ...data, userId: user.id, keysListed: !!(await readTrader(user.solanaAddress))?.listed } });
  if (wasFree && input.price > 0) {
    // free followers carry a far-off paid-until; bring it in to a week so the paywall applies after a grace period
    const now = Date.now();
    const until = new Date(now + GRACE_DAYS * DAY);
    const moved = await prisma.subscription.findMany({ where: { creatorId: creator.id, paidUntil: { gt: new Date(now + 400 * DAY) } }, select: { subscriberId: true } });
    if (moved.length) {
      await prisma.subscription.updateMany({ where: { creatorId: creator.id, paidUntil: { gt: new Date(now + 400 * DAY) } }, data: { paidUntil: until } });
      await prisma.notification.createMany({
        data: moved.map((m) => ({ userId: m.subscriberId, type: "SUB_ENDING" as const, actorAddress: user.address, payload: { handle: user.handle, paidUntil: until.toISOString(), price: input.price } })),
      });
    }
  }
  return json({ ok: true, creator: { price: Number(creator.priceUsd), offers: creator.offers, cadence: creator.cadence, pinned: creator.pinned ?? "", payoutAddress: creator.payoutAddress, keysListed: creator.keysListed, active: creator.active } });
});
