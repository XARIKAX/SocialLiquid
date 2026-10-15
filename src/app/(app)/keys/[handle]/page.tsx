import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeysTrader } from "@/components/keys/trader-view";
import { DEMO_TRADERS, traderByHandle } from "@/lib/keys-demo";

type Props = { params: Promise<{ handle: string }> };

export function generateStaticParams() {
  return DEMO_TRADERS.map((t) => ({ handle: t.handle }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const t = traderByHandle(decodeURIComponent(handle));
  return { title: t ? `${t.handle} · keys` : "Keys" };
}

export default async function KeysTraderPage({ params }: Props) {
  const { handle } = await params;
  const t = traderByHandle(decodeURIComponent(handle));
  if (!t) notFound();
  return <KeysTrader handle={t.handle} />;
}
