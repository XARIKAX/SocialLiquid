import { z } from "zod";
import { handler, json, HttpError } from "@/lib/api";
import { marketLeaderboard } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** who makes money on one market: realised pnl from closed positions on `coin` in the window */
export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const coin = (u.searchParams.get("coin") ?? "").trim();
  if (!coin || coin.length > 40) throw new HttpError(400, "coin required");
  const window = z.enum(["7d", "30d", "all"]).catch("30d").parse(u.searchParams.get("window") ?? "30d");
  const s = await getSession();
  return json({ coin, window, rows: await marketLeaderboard(coin, window, s?.userId) });
});
