import { z } from "zod";
import { handler, json, HttpError } from "@/lib/api";
import { getSession } from "@/lib/session";
import * as HL from "@/lib/hl";

/** everything the browser needs to sell `sz` of a spot coin for USDC with its own wallet: asset id, floored size, IOC price */
export const GET = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const q = z.object({ coin: z.string().min(1).max(12), sz: z.coerce.number().positive().optional() }).parse(Object.fromEntries(new URL(req.url).searchParams));
  const pair = await HL.spotPair(q.coin);
  if (!pair) throw new HttpError(400, `${q.coin} has no USDC spot market on Hyperliquid`);
  const spot = await HL.spotBalances(s.address);
  const have = spot.find((b) => b.coin === q.coin);
  const available = have ? Math.max(0, have.total - have.hold) : 0;
  if (!(available > 0)) throw new HttpError(400, `no ${q.coin} in your spot balance`);
  const size = Math.min(q.sz ?? available, available);
  const szStr = HL.formatSz(size, pair.szDecimals, "floor");
  if (!(Number(szStr) > 0)) throw new HttpError(400, `amount too small: ${q.coin} trades in steps of ${10 ** -pair.szDecimals}`);
  const perpName = q.coin.startsWith("U") ? q.coin.slice(1) : q.coin;
  const mids = await HL.allMidsAll();
  const mid = Number(mids[pair.name] ?? mids[`@${pair.pairIndex}`] ?? mids[perpName]);
  if (!Number.isFinite(mid) || mid <= 0) throw new HttpError(400, `no price for ${q.coin}`);
  if (Number(szStr) * mid < 10) throw new HttpError(400, `Hyperliquid's minimum order is $10; ${szStr} ${q.coin} is worth about $${(Number(szStr) * mid).toFixed(2)}`);
  return json({ assetId: pair.assetId, pair: pair.name, sz: szStr, px: HL.formatSpotPx(mid * 0.98, pair.szDecimals), mid, available });
});
