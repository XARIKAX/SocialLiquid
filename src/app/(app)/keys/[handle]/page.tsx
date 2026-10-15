import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeysTrader } from "@/components/keys/trader-view";
import { KEYS_LIVE } from "@/lib/keys";
import { DEMO_TRADERS, traderByHandle } from "@/lib/keys-demo";

type Props = { params: Promise<{ handle: string }> };

/** the preview's sample traders are known at build time; live traders are looked up as the page loads */
export function generateStaticParams() {
  return KEYS_LIVE ? [] : DEMO_TRADERS.map((t) => ({ handle: t.handle }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const handle = decodeURIComponent((await params).handle);
  if (KEYS_LIVE) return { title: `${handle} · keys` };
  const t = traderByHandle(handle);
  return { title: t ? `${t.handle} · keys` : "Keys" };
}

export default async function KeysTraderPage({ params }: Props) {
  const handle = decodeURIComponent((await params).handle);
  if (KEYS_LIVE) return <KeysTrader handle={handle} />;
  const t = traderByHandle(handle);
  if (!t) notFound();
  return <KeysTrader handle={t.handle} />;
}
