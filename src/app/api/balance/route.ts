import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, "bad address");
  const [s, spot] = await Promise.all([HL.clearinghouseState(address), HL.spotBalances(address).catch(() => null)]);
  return json({
    spot,
    accountValue: Number(s.marginSummary.accountValue),
    withdrawable: Number(s.withdrawable),
    marginUsed: Number(s.marginSummary.totalMarginUsed),
    positions: s.assetPositions.map((p) => ({
      coin: p.position.coin,
      szi: Number(p.position.szi),
      entryPx: Number(p.position.entryPx),
      positionValue: Number(p.position.positionValue),
      unrealizedPnl: Number(p.position.unrealizedPnl),
      leverage: p.position.leverage.value,
      liquidationPx: p.position.liquidationPx ? Number(p.position.liquidationPx) : null,
      returnOnEquity: Number(p.position.returnOnEquity),
    })),
  });
});
