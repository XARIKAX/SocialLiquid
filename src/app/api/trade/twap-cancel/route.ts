import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { cancelTwap } from "@/lib/trade";

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { coin, twapId } = await body(req, z.object({ coin: z.string(), twapId: z.number().int() }));
  await cancelTwap(s.userId, s.address, coin, twapId);
  return json({ ok: true });
});
