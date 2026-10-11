import { MarketView } from "@/components/market/market-view";
import { marketInitial } from "@/lib/market-ssr";

export const dynamic = "force-dynamic";

export const metadata = { title: "trade" };

export default async function TradeHome() {
  const initial = await marketInitial("BTC");
  return <MarketView coin="BTC" initial={initial ?? undefined} />;
}
