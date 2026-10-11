import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { INVITE_CODE, INVITE_REQUIRED, requireEnv } from "./env";

const SESSION_COOKIE = "sl_session";
const NONCE_COOKIE = "sl_nonce";
const INVITE_COOKIE = "sl_invite";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  return new TextEncoder().encode(requireEnv("SESSION_SECRET"));
}

export type Session = { userId: string; address: string };

export async function createSession(s: Session) {
  const token = await new SignJWT(s)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.userId !== "string" || typeof payload.address !== "string") return null;
    return { userId: payload.userId, address: payload.address };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const s = await getSession();
  if (!s) return null;
  return prisma.user.findUnique({ where: { id: s.userId }, include: { agentKey: { select: { agentAddress: true, approvedAt: true, builderApprovedAt: true } } } });
}

// ---------- sign-in nonce ----------

export async function issueNonce(): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const token = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
  (await cookies()).set(NONCE_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return nonce;
}

export async function consumeNonce(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(NONCE_COOKIE)?.value;
  if (!token) return null;
  jar.delete(NONCE_COOKIE);
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

export function signInMessage(address: string, nonce: string) {
  return `socialLiquid wants you to sign in with your wallet.\n\naddress: ${address.toLowerCase()}\nnonce: ${nonce}\n\nthis signature does not cost gas and does not authorise any trade.`;
}

// ---------- invite gate (mainnet only) ----------

export async function hasInvite(): Promise<boolean> {
  if (!INVITE_REQUIRED) return true;
  const v = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!v) return false;
  try {
    const { payload } = await jwtVerify(v, secret());
    return payload.invite === INVITE_CODE;
  } catch {
    return false;
  }
}

export async function grantInvite(code: string): Promise<boolean> {
  if (!INVITE_REQUIRED) return true;
  if (code !== INVITE_CODE) return false;
  const token = await new SignJWT({ invite: code }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("365d").sign(secret());
  (await cookies()).set(INVITE_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return true;
}
