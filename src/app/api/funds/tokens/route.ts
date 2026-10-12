import { handler, json } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

/** spot token ids (the "NAME:tokenId" a spotSend needs), from hyperliquid's own spotMeta. ?names=USDC,USOL */
export const GET = handler(async (req: Request) => {
  const names = (new URL(req.url).searchParams.get("names") ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  const all = await HL.spotTokens();
  const tokens: Record<string, (typeof all)[string]> = {};
  for (const n of names.length ? names : Object.keys(all)) if (all[n]) tokens[n] = all[n];
  return json({ tokens });
});
