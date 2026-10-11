import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env";

function key(): Buffer {
  const hex = requireEnv("AGENT_KEY_SECRET");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("AGENT_KEY_SECRET must be 32 bytes hex (openssl rand -hex 32)");
  return buf;
}

/** aes-256-gcm. output: base64(iv | tag | ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
