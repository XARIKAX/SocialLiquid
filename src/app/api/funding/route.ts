import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const coin = u.searchParams.get("coin");
  if (!coin) throw new HttpError(400, "coin required");
  const days = Math.min(30, Number(u.searchParams.get("days") ?? 7) || 7);
  const rows = await HL.fundingHistory(coin, Date.now() - days * 86_400_000);
  return json({ rows: rows.map((r) => ({ time: r.time, rate: Number(r.fundingRate), premium: Number(r.premium) })) });
});
