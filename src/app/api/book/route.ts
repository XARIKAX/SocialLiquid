import { z } from "zod";
import { handler, json } from "@/lib/api";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";
const Q = z.object({ coin: z.string().min(1).max(48), sig: z.coerce.number().int().min(2).max(5).optional() });

export const GET = handler(async (req: Request) => {
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const book = await HL.l2Book(q.coin, q.sig as 2 | 3 | 4 | 5 | undefined);
  const [bids, asks] = book.levels;
  return json({
    coin: book.coin,
    time: book.time,
    bids: bids.map((l) => ({ px: Number(l.px), sz: Number(l.sz), n: l.n })),
    asks: asks.map((l) => ({ px: Number(l.px), sz: Number(l.sz), n: l.n })),
  });
});
