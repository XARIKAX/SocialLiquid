import { z } from "zod";
import { body, handler, json } from "@/lib/api";
import { count, touch } from "@/lib/presence";

export const dynamic = "force-dynamic";

/** heartbeat: "I am on this market" → how many are */
export const POST = handler(async (req: Request) => {
  const { coin, id } = await body(req, z.object({ coin: z.string().min(1).max(48), id: z.string().min(8).max(64) }));
  return json({ watching: touch(coin, id) });
});

export const GET = handler(async (req: Request) => {
  const coin = new URL(req.url).searchParams.get("coin") ?? "";
  return json({ watching: coin ? count(coin) : 0 });
});
