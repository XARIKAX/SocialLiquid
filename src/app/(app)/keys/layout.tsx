import "@/components/keys/keys.css";
import { KeysFrame } from "@/components/keys/parts";

/** the keys section: a trader's key is the pass to their private feed, and pays holders from their fee flow */
export default function KeysLayout({ children }: { children: React.ReactNode }) {
  return <KeysFrame>{children}</KeysFrame>;
}
