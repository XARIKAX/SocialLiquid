import { Tokens } from "@/components/feed/feed-column";

export const metadata = { title: "tokens" };

export default function TokensPage() {
  return (
    <div className="max-w-5xl space-y-3 pb-3">
      <h1 className="text-[22px] font-semibold tracking-tight">Markets</h1>
      <section className="card overflow-hidden">
        <Tokens full />
      </section>
    </div>
  );
}
