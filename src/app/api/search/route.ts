import { handler, json } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return json({ coins: [], traders: [] });
  const markets = HL.sortMarkets(await HL.markets());
  const coins = markets.filter((m) => m.coin.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  const traders = await prisma.user.findMany({
    where: { OR: [{ handle: { contains: q, mode: "insensitive" } }, { address: { startsWith: q.toLowerCase() } }] },
    select: { address: true, handle: true, avatarUrl: true },
    take: 6,
  });
  const isAddr = /^0x[0-9a-fA-F]{40}$/.test(q);
  return json({
    coins: coins.map((c) => ({ coin: c.coin, markPx: c.markPx, change24h: c.change24h })),
    traders: isAddr && !traders.length ? [{ address: q.toLowerCase(), handle: null, avatarUrl: null }] : traders,
  });
});
