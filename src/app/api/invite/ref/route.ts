import { z } from "zod";
import { body, handler, json } from "@/lib/api";
import { inviterByCode, rememberRef } from "@/lib/invites";
import { grantInvite } from "@/lib/session";

export const dynamic = "force-dynamic";

/** landing on /i/<code>: remember the referral and, on a gated mainnet, open the gate for this browser */
export const POST = handler(async (req: Request) => {
  const { code } = await body(req, z.object({ code: z.string().min(1).max(32) }));
  const inviter = await inviterByCode(code);
  if (!inviter) return json({ ok: false });
  await rememberRef(code);
  await grantInvite(code);
  return json({ ok: true, inviter: { address: inviter.address, handle: inviter.handle, displayName: inviter.displayName } });
});
