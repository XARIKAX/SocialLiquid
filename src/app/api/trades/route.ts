import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const coin = new URL(req.url).searchParams.get("coin");
  if (!coin) throw new HttpError(400, "coin required");
  const t = await HL.recentTrades(coin);
  return json({ trades: t.map((x) => ({ px: Number(x.px), sz: Number(x.sz), side: x.side, time: x.time, tid: x.tid })) });
});
