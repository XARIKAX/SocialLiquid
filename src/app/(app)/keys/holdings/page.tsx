import type { Metadata } from "next";
import { KeysHoldings } from "@/components/keys/holdings-view";

export const metadata: Metadata = { title: "Your keys" };

export default function KeysHoldingsPage() {
  return <KeysHoldings />;
}
