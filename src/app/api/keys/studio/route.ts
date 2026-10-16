import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { CADENCE_KEYS, KEY_START_MAX, KEY_START_MIN, OFFER_KEYS } from "@/lib/keys";
import { readTrader } from "@/lib/keys-chain";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

const Settings = z.object({
  /** the key's starting price in USDC, whole cents. fixed once the key is listed */
  startPrice: z.number().min(KEY_START_MIN).max(KEY_START_MAX).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "whole cents"),
  offers: z.array(z.enum(OFFER_KEYS)).min(1).max(OFFER_KEYS.length),
  cadence: z.enum(CADENCE_KEYS),
  pinned: z.string().trim().max(500).optional(),
  payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  active: z.boolean().optional(),
});

/** create or update the caller's trader page: their key's starting price, what it unlocks, how often they post */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const input = await body(req, Settings);
  const user = await prisma.user.findUnique({ where: { id: s.userId }, include: { creator: true } });
  if (!user?.claimedAt) throw new HttpError(401, "sign in first");
  if (!user.handle) throw new HttpError(400, "pick a handle on your profile first: it is the address of your page");
  const start = Math.round(input.startPrice * 100) / 100;
  // the curve is fixed onchain at listing: holders are owed exactly what their keys put in
  if (user.creator?.keysListed && Number(user.creator.keyStartPrice) !== start) throw new HttpError(409, `your key is listed at $${Number(user.creator.keyStartPrice)} and its starting price is fixed`);
  const payoutAddress = (input.payoutAddress ?? user.creator?.payoutAddress ?? user.address).toLowerCase();
  const data = { keyStartPrice: start, offers: [...new Set(input.offers)], cadence: input.cadence, pinned: input.pinned || null, payoutAddress, ...(input.active !== undefined ? { active: input.active } : {}) };
  const creator = user.creator
    ? await prisma.creator.update({ where: { id: user.creator.id }, data })
    : await prisma.creator.create({ data: { ...data, userId: user.id } });
  // a trader who listed from their linked wallet before setting up the page: take the chain's word for the price
  if (!creator.keysListed) {
    const onchain = await readTrader(user.solanaAddress);
    if (onchain?.listed) await prisma.creator.update({ where: { id: creator.id }, data: { keysListed: true, keyStartPrice: onchain.start } });
  }
  const fresh = await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } });
  return json({ ok: true, creator: { startPrice: Number(fresh.keyStartPrice), offers: fresh.offers, cadence: fresh.cadence, pinned: fresh.pinned ?? "", payoutAddress: fresh.payoutAddress, keysListed: fresh.keysListed, active: fresh.active } });
});
