import { z } from "zod";
import { body, handler, json, err } from "@/lib/api";
import { INVITE_REQUIRED } from "@/lib/env";
import { grantInvite, hasInvite } from "@/lib/session";
import { inviterByCode, rememberRef } from "@/lib/invites";

export const GET = handler(async () => json({ required: INVITE_REQUIRED, ok: await hasInvite() }));

export const POST = handler(async (req: Request) => {
  const { code } = await body(req, z.object({ code: z.string().min(1).max(64) }));
  if (!(await grantInvite(code))) return err(403, "invalid invite code");
  // a personal code also counts as a referral for the account that signs in next
  const inviter = await inviterByCode(code);
  if (inviter) await rememberRef(code);
  return json({ ok: true, invitedBy: inviter ? { handle: inviter.handle, displayName: inviter.displayName, address: inviter.address } : null });
});
