import { handler, json, HttpError } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const address = u.searchParams.get("address") ?? "";
  const dex = (u.searchParams.get("dex") ?? "").slice(0, 16);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, "bad address");
  if (dex && !/^[a-z0-9]+$/i.test(dex)) throw new HttpError(400, "bad dex");
  const [s, spot, dexAbstraction] = await Promise.all([HL.clearinghouseState(address, dex), HL.spotBalances(address).catch(() => null), dex ? HL.dexAbstraction(address) : Promise.resolve(null)]);
  return json({
    dex,
    dexAbstraction,
    spot,
    totalNtlPos: Number(s.marginSummary.totalNtlPos),
    maintenanceMargin: s.crossMaintenanceMarginUsed !== undefined ? Number(s.crossMaintenanceMarginUsed) : null,
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
