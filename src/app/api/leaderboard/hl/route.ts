import { z } from "zod";
import { handler, json } from "@/lib/api";
import { hlLeaderboard } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * hyperliquid's own leaderboard, mirrored by the worker: the top accounts of every window (24h, 7d, 30d, all time),
 * figures as hyperliquid reports them. `window`, `sort` (pnl | roi | vlm | accountValue), `q` search, `claimed=1`, `limit`.
 */
export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const s = await getSession();
  const window = z.enum(["day", "week", "month", "allTime"]).catch("month").parse(u.searchParams.get("window") ?? "month");
  const sort = z.enum(["pnl", "roi", "vlm", "accountValue"]).catch("pnl").parse(u.searchParams.get("sort") ?? "pnl");
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get("limit") ?? 100) || 100));
  return json(await hlLeaderboard({ window, sort, q: u.searchParams.get("q") ?? undefined, claimedOnly: u.searchParams.get("claimed") === "1", all: u.searchParams.get("all") === "1", limit, viewerId: s?.userId }));
});
