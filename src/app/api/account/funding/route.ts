import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const rows = await HL.userFunding(s.address, Date.now() - 30 * 86_400_000);
  return json({ rows: rows.slice(0, 300).map((r) => ({ time: r.time, coin: r.delta.coin, usdc: Number(r.delta.usdc), szi: Number(r.delta.szi), rate: Number(r.delta.fundingRate) })) });
});
