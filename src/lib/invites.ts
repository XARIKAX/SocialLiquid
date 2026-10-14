import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { award } from "./points";

type Db = PrismaClient | Prisma.TransactionClient;
const REF_COOKIE = "sl_ref";
/** no 0/O/1/I so codes survive being read aloud */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function mint(): string {
  const b = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

/** the user's personal invite code, minted the first time it is asked for */
export async function inviteCodeFor(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
  if (u?.inviteCode) return u.inviteCode;
  for (let i = 0; i < 8; i++) {
    const code = mint();
    if (await prisma.user.findFirst({ where: { inviteCode: code }, select: { id: true } })) continue;
    const r = await prisma.user.updateMany({ where: { id: userId, inviteCode: null }, data: { inviteCode: code } });
    if (r.count === 0) return (await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } }))!.inviteCode!;
    return code;
  }
  throw new Error("could not mint an invite code");
}

export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/** who owns a personal code (null for the shared env code or an unknown one) */
export async function inviterByCode(code: string, db: Db = prisma) {
  const c = normaliseCode(code);
  if (c.length < 6) return null;
  return db.user.findFirst({ where: { inviteCode: c, claimedAt: { not: null } }, select: { id: true, address: true, handle: true, displayName: true, avatarUrl: true } });
}

/** remember which personal code brought this browser here, until the wallet signs in */
export async function rememberRef(code: string) {
  (await cookies()).set(REF_COOKIE, normaliseCode(code), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function readRef(): Promise<string | null> {
  return (await cookies()).get(REF_COOKIE)?.value ?? null;
}

/**
 * on a wallet's first sign-in: credit the inviter whose code this browser carried.
 * the invitee scores INVITE_JOINED now; the inviter scores INVITED once the invitee's first order fills (see creditInviterOnTrade).
 */
export async function attributeReferral(userId: string): Promise<boolean> {
  const code = await readRef();
  if (!code) return false;
  const inviter = await inviterByCode(code);
  if (!inviter || inviter.id === userId) return false;
  const r = await prisma.user.updateMany({ where: { id: userId, invitedById: null }, data: { invitedById: inviter.id, invitedAt: new Date() } });
  if (r.count === 0) return false;
  await award(userId, "INVITE_JOINED", inviter.id).catch(() => null);
  (await cookies()).delete(REF_COOKIE);
  return true;
}

/** first filled order of an invited account → the inviter gets paid, once */
export async function creditInviterOnTrade(userId: string, db: Db = prisma): Promise<void> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { invitedById: true } });
  if (!u?.invitedById) return;
  await award(u.invitedById, "INVITED", userId, db);
}

export type InviteeRow = { id: string; address: string; handle: string | null; displayName: string | null; avatarUrl: string | null; joinedAt: string; trading: boolean; points: number };

/** the signed-in user's invite page data */
export async function inviteSummary(userId: string) {
  const code = await inviteCodeFor(userId);
  const [invitees, paid] = await Promise.all([
    prisma.user.findMany({ where: { invitedById: userId }, orderBy: { invitedAt: "desc" }, select: { id: true, address: true, handle: true, displayName: true, avatarUrl: true, invitedAt: true, points: true } }),
    prisma.pointEvent.findMany({ where: { userId, kind: { in: ["INVITED"] } }, select: { refId: true, points: true } }),
  ]);
  const paidFor = new Map(paid.map((p) => [p.refId, p.points]));
  const rows: InviteeRow[] = invitees.map((u) => ({ id: u.id, address: u.address, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, joinedAt: (u.invitedAt ?? new Date()).toISOString(), trading: paidFor.has(u.id), points: u.points }));
  const earned = paid.reduce((a, p) => a + p.points, 0);
  return { code, invitees: rows, stats: { joined: rows.length, trading: rows.filter((r) => r.trading).length, earned } };
}
