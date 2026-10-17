import { z } from "zod";
import { handler, json } from "@/lib/api";
import { protocolStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** protocol stats: `range` 30d | 90d | 1y | all, `bucket` day | week | month. `format=csv` downloads the series */
export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const range = z.enum(["30d", "90d", "1y", "all"]).catch("90d").parse(u.searchParams.get("range") ?? "90d");
  const bucket = z.enum(["day", "week", "month"]).catch("day").parse(u.searchParams.get("bucket") ?? "day");
  const stats = await protocolStats(range, bucket);
  if (u.searchParams.get("format") === "csv") {
    const cols = ["date", "volume", "fees", "trades", "traders", "copies", "theses", "newTraders"] as const;
    const lines = [cols.join(","), ...stats.series.map((p) => [p.t.slice(0, 10), p.volume.toFixed(2), p.fees.toFixed(4), p.trades, p.traders, p.copies, p.theses, p.newTraders].join(","))];
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="socialliquid-${range}-${bucket}.csv"` } });
  }
  return json(stats);
});
