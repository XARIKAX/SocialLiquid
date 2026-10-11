import { z } from "zod";
import { body, handler, json, err } from "@/lib/api";
import { INVITE_REQUIRED } from "@/lib/env";
import { grantInvite, hasInvite } from "@/lib/session";

export const GET = handler(async () => json({ required: INVITE_REQUIRED, ok: await hasInvite() }));

export const POST = handler(async (req: Request) => {
  const { code } = await body(req, z.object({ code: z.string().min(1).max(64) }));
  if (!(await grantInvite(code))) return err(403, "invalid invite code");
  return json({ ok: true });
});
