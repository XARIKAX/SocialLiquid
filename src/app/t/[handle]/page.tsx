import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { TraderProfile, type Profile } from "@/components/trader/profile";
import { resolveTrader } from "@/lib/queries";
import { shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const t = await resolveTrader(handle);
  if (!t) return { title: "trader" };
  return { title: t.user?.handle ?? shortAddr(t.address), description: `live perp positions, pnl and theses on socialLiquid` };
}

export default async function TraderPage({ params }: Props) {
  const { handle } = await params;
  const t = await resolveTrader(handle);
  if (!t) notFound();
  // reuse the route handler so the server and client payload stay identical
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const res = await fetch(`${proto}://${host}/api/trader/${encodeURIComponent(handle)}`, { headers: { cookie: h.get("cookie") ?? "" }, cache: "no-store" });
  if (!res.ok) notFound();
  const initial = (await res.json()) as Profile;
  return <TraderProfile handle={handle} initial={initial} />;
}
