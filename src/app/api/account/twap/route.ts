import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const rows = await HL.twapHistory(s.address);
  return json({
    twaps: rows.map((t) => ({
      twapId: t.twapId ?? null,
      coin: t.state.coin,
      side: t.state.side,
      sz: Number(t.state.sz),
      executedSz: Number(t.state.executedSz),
      executedNtl: Number(t.state.executedNtl),
      minutes: t.state.minutes,
      reduceOnly: t.state.reduceOnly,
      randomize: t.state.randomize,
      status: t.status.status,
      error: "description" in t.status ? t.status.description : null,
      time: t.time,
    })),
  });
});
