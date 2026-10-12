import { z } from "zod";
import { handler, json } from "@/lib/api";
import * as HL from "@/lib/hl";
import type { HlCandleInterval } from "@/lib/hl-types";

export const dynamic = "force-dynamic";

const INTERVALS: HlCandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
const Q = z.object({
  coin: z.string().min(1).max(48),
  interval: z.enum(INTERVALS as [HlCandleInterval, ...HlCandleInterval[]]).default("1h"),
  bars: z.coerce.number().min(10).max(1000).default(300),
});

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const q = Q.parse(Object.fromEntries(u.searchParams));
  const ms = ({ "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 3.6e6, "4h": 1.44e7, "1d": 8.64e7, "1w": 6.048e8 } as Record<string, number>)[q.interval];
  const end = Date.now();
  const candles = await HL.candleSnapshot(q.coin, q.interval, end - ms * q.bars, end);
  return json({
    candles: candles.map((c) => ({ time: Math.floor(c.t / 1000), open: +c.o, high: +c.h, low: +c.l, close: +c.c, volume: +c.v })),
  });
});
