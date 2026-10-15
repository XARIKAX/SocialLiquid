import type { Metadata } from "next";
import { KeysHub } from "@/components/keys/hub-view";

export const metadata: Metadata = { title: "Keys", description: "Subscribe to traders' private calls, own a share of them with a key, and trade alongside them on Hyperliquid." };

export default function KeysPage() {
  return <KeysHub />;
}
