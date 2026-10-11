import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const orders = await HL.openOrders(s.address);
  return json({
    orders: orders.map((o) => ({
      oid: o.oid,
      coin: o.coin,
      side: o.side,
      type: o.orderType,
      limitPx: Number(o.limitPx),
      sz: Number(o.sz),
      origSz: Number(o.origSz),
      isTrigger: o.isTrigger,
      triggerPx: Number(o.triggerPx),
      triggerCondition: o.triggerCondition,
      reduceOnly: o.reduceOnly,
      isPositionTpsl: o.isPositionTpsl,
      tif: o.tif,
      time: o.timestamp,
    })),
  });
});
