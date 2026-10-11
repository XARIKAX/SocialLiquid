import { z } from "zod";
import { handler, json } from "@/lib/api";
import { leaderboardRows } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const by = z.enum(["pnl7d", "winRate", "thesisAccuracy", "followers"]).catch("pnl7d").parse(new URL(req.url).searchParams.get("by") ?? "pnl7d");
  return json({ by, rows: await leaderboardRows(by) });
});
