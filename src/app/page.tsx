import { MarketView } from "@/components/market/market-view";
import { marketInitial } from "@/lib/market-ssr";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initial = await marketInitial("BTC");
  return <MarketView coin="BTC" initial={initial ?? undefined} />;
}
