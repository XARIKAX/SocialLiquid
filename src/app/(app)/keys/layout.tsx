import "@/components/keys/keys.css";
import { KeysFrame } from "@/components/keys/parts";

/** the keys section: subscriptions to traders' private feeds, and keys that pay holders from a trader's fee flow */
export default function KeysLayout({ children }: { children: React.ReactNode }) {
  return <KeysFrame>{children}</KeysFrame>;
}
