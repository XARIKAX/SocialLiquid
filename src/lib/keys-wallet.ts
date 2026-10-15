/**
 * linking a Solana wallet to an account. keys live on Solana while accounts are hyperliquid wallets, so a trader or
 * holder proves they own a Solana wallet by signing a one-time message with it; the server checks the ed25519
 * signature and stores the wallet. one wallet per account, one account per wallet.
 */
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { requireEnv } from "./env";

const COOKIE = "sl_solnonce";
const secret = () => new TextEncoder().encode(requireEnv("SESSION_SECRET"));

export const isSolanaAddress = (a: string) => {
  try {
    return bs58.decode(a).length === 32;
  } catch {
    return false;
  }
};

export function linkMessage(solana: string, account: string, nonce: string) {
  return `socialLiquid: link this Solana wallet to your account.\n\nsolana wallet: ${solana}\naccount: ${account.toLowerCase()}\nnonce: ${nonce}\n\nthis signature costs nothing and moves no funds.`;
}

/** a nonce for this account and wallet, kept in a short-lived signed cookie */
export async function issueLinkNonce(solana: string, account: string): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const token = await new SignJWT({ nonce, solana, account }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  return nonce;
}

/** the nonce issued for exactly this account and wallet, consumed; null if missing, expired or for another pair */
export async function consumeLinkNonce(solana: string, account: string): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  jar.delete(COOKIE);
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.solana === solana && payload.account === account && typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

/** does `signature` (base64) sign `message` for the wallet `solana`? */
export function verifyLink(solana: string, message: string, signature: string): boolean {
  try {
    const sig = Uint8Array.from(Buffer.from(signature, "base64"));
    return sig.length === 64 && ed25519.verify(sig, new TextEncoder().encode(message), bs58.decode(solana));
  } catch {
    return false;
  }
}
