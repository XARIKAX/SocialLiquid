import { handler, json } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async () => json({ markets: HL.sortMarkets(await HL.markets()) }));
