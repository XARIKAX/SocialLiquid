import { handler, json } from "@/lib/api";
import { feed } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  const s = await getSession();
  const following = u.searchParams.get("following") === "1";
  const items = await feed({
    coin: u.searchParams.get("coin") || undefined,
    minUsd: Number(u.searchParams.get("minUsd") ?? 0) || 0,
    thesisOnly: u.searchParams.get("thesis") === "1",
    followingOf: following && s ? s.userId : undefined,
    addresses: u.searchParams.get("address") ? [u.searchParams.get("address")!.toLowerCase()] : undefined,
    before: u.searchParams.get("before") || undefined,
    limit: Math.min(100, Number(u.searchParams.get("limit") ?? 50) || 50),
    viewerId: s?.userId,
    viewerAddress: s?.address,
  });
  // following filter with no session = empty, by design
  return json({ items: following && !s ? [] : items });
});
