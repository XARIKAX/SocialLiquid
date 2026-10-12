import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { getSession, hasInvite } from "@/lib/session";
import { sellSpotForUsdc } from "@/lib/trade";
import * as HL from "@/lib/hl";

/** sell a spot coin for USDC on hyperliquid spot (agent-signed). `coin` is the spot coin (USOL); sz defaults to everything available */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  if (!(await hasInvite())) throw new HttpError(403, "invite required");
  const input = await body(req, z.object({ coin: z.string().min(1).max(12), sz: z.number().positive().optional() }));
  const spot = await HL.spotBalances(s.address);
  const have = spot.find((b) => b.coin === input.coin);
  const available = have ? Math.max(0, have.total - have.hold) : 0;
  if (!(available > 0)) throw new HttpError(400, `no ${input.coin} in your spot balance`);
  const size = Math.min(input.sz ?? available, available);
  const r = await sellSpotForUsdc(s.userId, s.address, input.coin, size);
  return json(r);
});
