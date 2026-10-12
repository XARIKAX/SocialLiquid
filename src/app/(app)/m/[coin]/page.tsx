import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketView } from "@/components/market/market-view";
import { marketInitial } from "@/lib/market-ssr";
import { fmtPx } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ coin: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { coin } = await params;
  const ref = decodeURIComponent(coin);
  const initial = await marketInitial(ref);
  return { title: initial ? `${initial.market.name} ${fmtPx(initial.market.markPx)}` : ref.toUpperCase() };
}

export default async function MarketPage({ params }: Props) {
  const { coin } = await params;
  const initial = await marketInitial(decodeURIComponent(coin));
  if (!initial) notFound();
  return <MarketView coin={initial.market.coin} initial={initial} />;
}
