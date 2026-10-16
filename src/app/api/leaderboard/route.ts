import { z } from "zod";
import { handler, json } from "@/lib/api";
import { leaderboardRows } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * socialLiquid's own board, from positions we track. `by`: pnl7d | pnl30d | pnlAll | winRate | thesisAccuracy | followers |
 * copiersPnl (best to follow: what copiers made) | copiers | drawdown | consistency. `copyable=1` hides market makers and bots,
 * `size` = s | m | l | xl buckets account value.
 */
export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const s = await getSession();
  const by = z.enum(["pnl7d", "pnl30d", "pnlAll", "winRate", "thesisAccuracy", "followers", "copiersPnl", "copiers", "drawdown", "consistency"]).catch("pnl7d").parse(u.searchParams.get("by") ?? "pnl7d");
  const size = z.enum(["s", "m", "l", "xl"]).optional().catch(undefined).parse(u.searchParams.get("size") ?? undefined);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? 50) || 50));
  return json({ by, rows: await leaderboardRows(by, limit, { copyable: u.searchParams.get("copyable") === "1", size, viewerId: s?.userId }) });
});
