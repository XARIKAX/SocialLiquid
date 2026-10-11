import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { setLeverage } from "@/lib/trade";

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { coin, leverage, isCross } = await body(req, z.object({ coin: z.string(), leverage: z.number().min(1).max(100), isCross: z.boolean().default(true) }));
  return json(await setLeverage(s.userId, s.address, coin, leverage, isCross));
});
