import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { positionTpsl } from "@/lib/trade";

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { coin, tp, sl } = await body(req, z.object({ coin: z.string(), tp: z.number().positive().optional(), sl: z.number().positive().optional() }));
  return json(await positionTpsl(s.userId, s.address, coin, tp, sl));
});
