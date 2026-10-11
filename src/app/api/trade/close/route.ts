import { z } from "zod";
import { body, handler, json, HttpError, plain } from "@/lib/api";
import { syncAddress } from "@/lib/indexer";
import { getSession } from "@/lib/session";
import { closePosition } from "@/lib/trade";

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { coin } = await body(req, z.object({ coin: z.string().min(1).max(20) }));
  const result = await closePosition(s.userId, s.address, coin);
  await syncAddress(s.address, { forceFills: true }).catch(() => {});
  return json(plain({ order: result }));
});
