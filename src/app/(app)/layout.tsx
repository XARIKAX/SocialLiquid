import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";

/** the dapp: wallet providers + fomo shell. the landing page at / stays outside this group and ships no wallet code. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
