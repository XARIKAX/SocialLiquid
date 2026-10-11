import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const rows = await HL.historicalOrders(s.address);
  return json({
    orders: rows.slice(0, 200).map((h) => ({
      oid: h.order.oid,
      coin: h.order.coin,
      side: h.order.side,
      type: h.order.orderType,
      limitPx: Number(h.order.limitPx),
      sz: Number(h.order.sz),
      origSz: Number(h.order.origSz),
      isTrigger: h.order.isTrigger,
      triggerPx: Number(h.order.triggerPx),
      reduceOnly: h.order.reduceOnly,
      status: h.status,
      time: h.statusTimestamp,
    })),
  });
});
