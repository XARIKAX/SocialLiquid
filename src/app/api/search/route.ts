import { handler, json } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return json({ coins: [], traders: [] });
  const markets = HL.sortMarkets(await HL.markets());
  // a market answers to its id ("@107", "xyz:GOLD"), its display name ("SOL/USDC") or its symbol; exact names first
  const needle = q.toLowerCase();
  const rank = (m: (typeof markets)[number]) => {
    const n = m.name.toLowerCase();
    const b = m.base.toLowerCase();
    return n === needle || b === needle ? 0 : n.startsWith(needle) || b.startsWith(needle) ? 1 : 2;
  };
  const coins = markets
    .filter((m) => m.coin.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle) || m.base.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6);
  const traders = await prisma.user.findMany({
    where: { OR: [{ handle: { contains: q, mode: "insensitive" } }, { address: { startsWith: q.toLowerCase() } }] },
    select: { address: true, handle: true, avatarUrl: true },
    take: 6,
  });
  const isAddr = /^0x[0-9a-fA-F]{40}$/.test(q);
  return json({
    coins: coins.map((c) => ({ coin: c.coin, slug: c.slug, name: c.name, base: c.base, kind: c.kind, category: c.category ?? null, markPx: c.markPx, change24h: c.change24h })),
    traders: isAddr && !traders.length ? [{ address: q.toLowerCase(), handle: null, avatarUrl: null }] : traders,
  });
});
