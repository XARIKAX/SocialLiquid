import { z } from "zod";
import { verifyMessage } from "viem";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { consumeNonce, createSession, signInMessage } from "@/lib/session";
import { attributeReferral } from "@/lib/invites";

export const POST = handler(async (req: Request) => {
  const { address, signature } = await body(
    req,
    z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  );
  const nonce = await consumeNonce();
  if (!nonce) throw new HttpError(400, "nonce expired, try again");
  const ok = await verifyMessage({ address: address as `0x${string}`, message: signInMessage(address, nonce), signature: signature as `0x${string}` });
  if (!ok) throw new HttpError(401, "bad signature");
  const lower = address.toLowerCase();
  const before = await prisma.user.findUnique({ where: { address: lower }, select: { claimedAt: true } });
  const user = await prisma.user.upsert({ where: { address: lower }, create: { address: lower, claimedAt: new Date() }, update: { claimedAt: before?.claimedAt ?? new Date() } });
  // first sign-in of this wallet with a referral cookie: credit the inviter
  if (!before?.claimedAt) await attributeReferral(user.id).catch((e) => console.warn("[auth] referral failed", (e as Error).message));
  await prisma.trackedAddress.upsert({ where: { address: lower }, create: { address: lower, source: "USER" }, update: { source: "USER" } });
  await createSession({ userId: user.id, address: lower });
  return json({ user: { id: user.id, address: user.address, handle: user.handle } });
});
