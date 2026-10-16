import type { NotificationType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Db = PrismaClient | Prisma.TransactionClient;

/** the signed-up user behind an address, if any; shadow users (followed but never signed in) get no notifications */
export async function userIdByAddress(address: string, db: Db = prisma): Promise<string | null> {
  const u = await db.user.findUnique({ where: { address: address.toLowerCase() }, select: { id: true, claimedAt: true } });
  return u?.claimedAt ? u.id : null;
}

/**
 * write a social notification. never for yourself, never for an unclaimed address, and never twice for the same
 * actor on the same thing (a reaction toggled on and off should not spam the owner).
 */
export async function notify(
  args: { userId: string; type: NotificationType; actorAddress?: string | null; coin?: string | null; eventId?: string | null; thesisId?: string | null; positionId?: string | null; payload?: Record<string, unknown> },
  db: Db = prisma,
) {
  const actor = args.actorAddress?.toLowerCase() ?? null;
  if (actor) {
    const self = await db.user.findUnique({ where: { id: args.userId }, select: { address: true } });
    if (self?.address === actor) return null;
    const dupe = await db.notification.findFirst({
      where: { userId: args.userId, type: args.type, actorAddress: actor, eventId: args.eventId ?? null, thesisId: args.thesisId ?? null, positionId: args.positionId ?? null },
      select: { id: true },
    });
    if (dupe) return null;
  }
  return db.notification.create({
    data: { userId: args.userId, type: args.type, actorAddress: actor, coin: args.coin ?? null, eventId: args.eventId ?? null, thesisId: args.thesisId ?? null, positionId: args.positionId ?? null, payload: (args.payload ?? {}) as Prisma.InputJsonValue },
  });
}

/** notify the owner of an address, when it belongs to a signed-up user */
export async function notifyAddress(address: string, args: Omit<Parameters<typeof notify>[0], "userId">, db: Db = prisma) {
  const userId = await userIdByAddress(address, db);
  if (!userId) return null;
  return notify({ ...args, userId }, db);
}
