import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const fills = await HL.userFills(s.address);
  return json({
    fills: fills.slice(0, 200).map((f) => ({
      tid: f.tid,
      coin: f.coin,
      side: f.side,
      dir: f.dir,
      px: Number(f.px),
      sz: Number(f.sz),
      fee: Number(f.fee),
      builderFee: f.builderFee !== undefined ? Number(f.builderFee) : 0,
      closedPnl: Number(f.closedPnl),
      time: f.time,
      hash: f.hash,
      liquidation: !!f.liquidation,
    })),
  });
});
