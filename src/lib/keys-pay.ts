/**
 * subscription payments. nothing is custodied: the subscriber sends USDC on Hyperliquid straight to the creator
 * (and the platform's share to the treasury, when one is set), then the server finds those transfers in the
 * subscriber's ledger and grants a month. a quote (PaymentIntent) pins the amounts, the addresses and a time
 * window; each transfer hash can pay for one month only, ever.
 */
import { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { prisma } from "./db";
import { HL_MOCK } from "./env";
import { clearinghouseState, isUnified, spotBalances, spotTokens, usdcTransfersFrom, userAbstraction, type HlTransfer } from "./hl";
import { SUB_INTENT_TTL_MIN, SUB_PERIOD_DAYS, SUBS_TREASURY, subSplit } from "./keys";

const DAY = 86_400_000;
/** a transfer may settle a little before the quote's timestamp (clock skew between us and hyperliquid) */
const SKEW_MS = 60_000;
/** cents: a transfer must cover the quoted amount to the cent */
const CENT = 0.005;
/** free feeds: a subscription is a standing follow that never lapses on its own */
const FREE_UNTIL_DAYS = 3650;

export type PayMethod = "usdSend" | "spotSend";
export type Quote = {
  intentId: string;
  method: PayMethod;
  /** "USDC:0x…" for spotSend */
  token: string | null;
  transfers: { to: string; amount: string; label: "creator" | "platform" }[];
  total: number;
  expiresAt: string;
};

async function creatorByHandle(handle: string) {
  const c = await prisma.creator.findFirst({
    where: { active: true, user: { handle: { equals: handle, mode: "insensitive" }, claimedAt: { not: null } } },
    include: { user: { select: { id: true, address: true, handle: true } } },
  });
  if (!c) throw new HttpError(404, "no creator with that handle");
  return c;
}

/**
 * which balance pays: unified accounts send USDC from spot (usdSend is disabled for them); everyone else sends
 * from perps, falling back to spot when that is where the USDC sits. refuses when neither balance covers it.
 */
async function payMethod(address: string, total: number): Promise<{ method: PayMethod; token: string | null }> {
  if (HL_MOCK) return { method: "usdSend", token: null };
  const usdc = (await spotTokens())["USDC"];
  const token = usdc ? `USDC:${usdc.tokenId}` : null;
  const [abs, perps, spot] = await Promise.all([userAbstraction(address), clearinghouseState(address).catch(() => null), spotBalances(address).catch(() => [])]);
  const spotFree = spot.filter((b) => b.coin === "USDC").reduce((a, b) => a + b.total - b.hold, 0);
  if (isUnified(abs)) {
    if (spotFree + CENT < total) throw new HttpError(402, `not enough USDC on Hyperliquid: $${total.toFixed(2)} needed, $${spotFree.toFixed(2)} free`);
    return { method: "spotSend", token };
  }
  const withdrawable = Number(perps?.withdrawable ?? 0);
  if (withdrawable + CENT >= total) return { method: "usdSend", token: null };
  if (spotFree + CENT >= total && token) return { method: "spotSend", token };
  throw new HttpError(402, `not enough USDC on Hyperliquid: $${total.toFixed(2)} needed, $${Math.max(withdrawable, spotFree).toFixed(2)} free`);
}

/** start or renew: a free feed subscribes at once; a paid one returns the transfers to sign */
export async function quote(payer: { id: string; address: string }, handle: string): Promise<{ subscribed: true; paidUntil: string } | ({ subscribed: false } & Quote)> {
  const c = await creatorByHandle(handle);
  if (c.userId === payer.id) throw new HttpError(400, "that is your own feed");
  const price = Number(c.priceUsd);
  if (price <= 0) {
    const paidUntil = new Date(Date.now() + FREE_UNTIL_DAYS * DAY);
    await prisma.subscription.upsert({
      where: { creatorId_subscriberId: { creatorId: c.id, subscriberId: payer.id } },
      create: { creatorId: c.id, subscriberId: payer.id, paidUntil },
      update: { paidUntil, cancelledAt: null },
    });
    return { subscribed: true, paidUntil: paidUntil.toISOString() };
  }
  const split = subSplit(price, SUBS_TREASURY);
  const { method, token } = await payMethod(payer.address, price);
  const expiresAt = new Date(Date.now() + SUB_INTENT_TTL_MIN * 60_000);
  const intent = await prisma.paymentIntent.create({
    data: {
      creatorId: c.id,
      payerId: payer.id,
      payerAddress: payer.address.toLowerCase(),
      creatorAddress: c.payoutAddress.toLowerCase(),
      amountCreator: split.creator,
      treasuryAddress: split.platform > 0 ? SUBS_TREASURY : null,
      amountTreasury: split.platform,
      expiresAt,
    },
  });
  const transfers: Quote["transfers"] = [{ to: intent.creatorAddress, amount: split.creator.toFixed(2), label: "creator" }];
  if (intent.treasuryAddress) transfers.push({ to: intent.treasuryAddress, amount: split.platform.toFixed(2), label: "platform" });
  return { subscribed: false, intentId: intent.id, method, token, transfers, total: price, expiresAt: expiresAt.toISOString() };
}

/** the first transfer in `list` to `to` covering `amount` that no other payment has used */
function pick(list: HlTransfer[], to: string, amount: number, used: Set<string>): HlTransfer | null {
  return list.find((t) => t.to === to && t.usd + CENT >= amount && !used.has(t.hash)) ?? null;
}

/**
 * look for the quote's transfers in the payer's ledger and, when they are all there, extend the subscription by a
 * period from whichever is later, now or the current paid-up date. returns null while a transfer is still missing
 * (the client polls). `mockPaid` is honoured only with HL_MOCK, where there is no ledger to read.
 */
export async function confirm(payerId: string, intentId: string, mockPaid = false): Promise<{ paidUntil: string } | null> {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId }, include: { creator: { include: { user: { select: { handle: true } } } } } });
  if (!intent || intent.payerId !== payerId) throw new HttpError(404, "no such payment");
  if (intent.usedAt) {
    const sub = await prisma.subscription.findUnique({ where: { creatorId_subscriberId: { creatorId: intent.creatorId, subscriberId: payerId } } });
    return { paidUntil: (sub?.paidUntil ?? new Date()).toISOString() };
  }
  const creatorAmt = Number(intent.amountCreator);
  const treasuryAmt = Number(intent.amountTreasury);
  let creatorHash: string;
  let treasuryHash: string | null = null;
  if (HL_MOCK) {
    if (!mockPaid) return null;
    creatorHash = `mock:${intent.id}:creator`;
    if (intent.treasuryAddress) treasuryHash = `mock:${intent.id}:platform`;
  } else {
    const transfers = await usdcTransfersFrom(intent.payerAddress, intent.createdAt.getTime() - SKEW_MS, Math.min(Date.now(), intent.expiresAt.getTime() + SKEW_MS));
    const candidates = transfers.map((t) => t.hash);
    const usedRows = candidates.length
      ? await prisma.subscriptionPayment.findMany({ where: { OR: [{ creatorHash: { in: candidates } }, { treasuryHash: { in: candidates } }] }, select: { creatorHash: true, treasuryHash: true } })
      : [];
    const used = new Set(usedRows.flatMap((r) => [r.creatorHash, r.treasuryHash ?? ""]));
    const toCreator = pick(transfers, intent.creatorAddress, creatorAmt, used);
    if (!toCreator) {
      if (Date.now() > intent.expiresAt.getTime() + SKEW_MS) throw new HttpError(410, "this payment quote expired before the transfer arrived. start again; if USDC already left your account, contact support with the transaction");
      return null;
    }
    creatorHash = toCreator.hash;
    if (intent.treasuryAddress && treasuryAmt > 0) {
      used.add(toCreator.hash);
      const toTreasury = pick(transfers, intent.treasuryAddress, treasuryAmt, used);
      if (!toTreasury) {
        if (Date.now() > intent.expiresAt.getTime() + SKEW_MS) throw new HttpError(410, "the platform share did not arrive before the quote expired. contact support with both transactions");
        return null;
      }
      treasuryHash = toTreasury.hash;
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      // claim the quote first: a second confirm racing this one fails here instead of granting two months
      const claimed = await tx.paymentIntent.updateMany({ where: { id: intent.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count === 0) throw new HttpError(409, "this payment was already confirmed");
      const now = new Date();
      const existing = await tx.subscription.findUnique({ where: { creatorId_subscriberId: { creatorId: intent.creatorId, subscriberId: payerId } } });
      // a free-feed follow carries a far-off date; paying replaces it rather than stacking on top
      const base = existing && existing.paidUntil > now && existing.paidUntil.getTime() - now.getTime() < 400 * DAY ? existing.paidUntil : now;
      const end = new Date(base.getTime() + SUB_PERIOD_DAYS * DAY);
      const sub = await tx.subscription.upsert({
        where: { creatorId_subscriberId: { creatorId: intent.creatorId, subscriberId: payerId } },
        create: { creatorId: intent.creatorId, subscriberId: payerId, paidUntil: end },
        update: { paidUntil: end, cancelledAt: null },
      });
      await tx.subscriptionPayment.create({ data: { subscriptionId: sub.id, intentId: intent.id, amountUsd: creatorAmt + treasuryAmt, creatorHash, treasuryHash, periodStart: base, periodEnd: end } });
      return { paidUntil: end.toISOString() };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "that transfer already paid for another month");
    throw e;
  }
}
