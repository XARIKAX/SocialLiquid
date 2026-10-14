import { z } from "zod";
import { handler, json } from "@/lib/api";
import { getSession } from "@/lib/session";
import { groupMembers, requireReadable } from "@/lib/groups";

export const dynamic = "force-dynamic";

/** members ranked among themselves. no minimum trade count: a group of five should still have a #1 */
export const GET = handler(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const by = z.enum(["pnl7d", "pnl30d", "winRate", "points", "streak"]).catch("pnl7d").parse(new URL(req.url).searchParams.get("by") ?? "pnl7d");
  const s = await getSession();
  const { group } = await requireReadable(slug, s?.userId);
  const rows = await groupMembers(group.id, s?.userId);
  const key = (r: (typeof rows)[number]) => (by === "pnl7d" ? r.stats.pnl7d : by === "pnl30d" ? r.stats.pnl30d : by === "winRate" ? (r.stats.winRate ?? -1) : by === "points" ? (r.user.points ?? 0) : r.streak);
  rows.sort((a, b) => key(b) - key(a) || b.stats.closedTrades - a.stats.closedTrades);
  return json({ by, rows: rows.map((r, i) => ({ rank: i + 1, ...r })) });
});
