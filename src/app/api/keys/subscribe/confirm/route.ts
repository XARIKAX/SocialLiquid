import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { liveOnly } from "@/lib/keys-guard";
import { confirm } from "@/lib/keys-pay";
import { getSession } from "@/lib/session";

/** after signing the transfers: verify them on hyperliquid and grant the month. 202 while they have not landed yet */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { intentId, mockPaid } = await body(req, z.object({ intentId: z.string().min(1).max(64), mockPaid: z.boolean().optional() }));
  const r = await confirm(s.userId, intentId, mockPaid);
  return r ? json({ confirmed: true, ...r }) : json({ confirmed: false }, { status: 202 });
});
