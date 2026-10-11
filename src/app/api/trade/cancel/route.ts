import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { cancelOrders } from "@/lib/trade";

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { cancels } = await body(req, z.object({ cancels: z.array(z.object({ coin: z.string(), oid: z.number().int() })).min(1).max(50) }));
  return json(await cancelOrders(s.userId, s.address, cancels));
});
