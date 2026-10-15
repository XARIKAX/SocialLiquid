import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { liveOnly } from "@/lib/keys-guard";
import { quote } from "@/lib/keys-pay";
import { getSession } from "@/lib/session";

/** start or renew a subscription: free feeds subscribe at once, paid ones get a quote of the transfers to sign */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { handle } = await body(req, z.object({ handle: z.string().min(1).max(64) }));
  return json(await quote({ id: s.userId, address: s.address }, handle));
});
