import type { Metadata } from "next";
import { KeysMarket } from "@/components/keys/market-view";

export const metadata: Metadata = { title: "Keys market" };

export default function KeysMarketPage() {
  return <KeysMarket />;
}
