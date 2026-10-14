import { handler, json } from "@/lib/api";
import { feed } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { memberAddresses, requireReadable } from "@/lib/groups";

export const dynamic = "force-dynamic";

/** the members' trades, theses and closes: the global feed narrowed to this group */
export const GET = handler(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const u = new URL(req.url);
  const s = await getSession();
  const { group } = await requireReadable(slug, s?.userId);
  const addresses = await memberAddresses(group.id);
  if (!addresses.length) return json({ items: [] });
  const items = await feed({
    addresses,
    coin: u.searchParams.get("coin") || undefined,
    minUsd: Number(u.searchParams.get("minUsd") ?? 0) || 0,
    thesisOnly: u.searchParams.get("thesis") === "1",
    before: u.searchParams.get("before") || undefined,
    limit: Math.min(100, Number(u.searchParams.get("limit") ?? 50) || 50),
    viewerId: s?.userId,
    viewerAddress: s?.address,
  });
  return json({ items });
});
