import type { Metadata } from "next";
import { KeysHub } from "@/components/keys/hub-view";

export const metadata: Metadata = { title: "Keys", description: "Hold a trader's key to unlock their private calls, earn from their copiers' fees, and trade alongside them on Hyperliquid." };

export default function KeysPage() {
  return <KeysHub />;
}
