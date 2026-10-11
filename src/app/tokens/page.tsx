import { Tokens } from "@/components/feed/feed-column";

export const metadata = { title: "tokens" };

export default function TokensPage() {
  return (
    <div className="max-w-4xl">
      <div className="px-3 h-10 flex items-center border-b border-line text-sm font-semibold">tokens</div>
      <Tokens full />
    </div>
  );
}
