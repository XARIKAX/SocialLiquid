"use client";
/** /keys/market: every trader's key, ranked. the top three on a podium, the rest in a sortable list */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useKeys } from "@/hooks/use-keys";
import { HOLDER_SHARE } from "@/lib/keys";
import type { KeysTrader } from "@/lib/keys-model";
import { fmtNum, fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { Face, KeysState, ResetPreview, Sparkline, priceLabel, usdBig } from "./parts";

type Sort = "top" | "rising" | "yield" | "cheap";
const SORTS: { key: Sort; label: string; by: (a: KeysTrader, b: KeysTrader) => number }[] = [
  { key: "top", label: "Top", by: (a, b) => b.key.price * b.key.minted - a.key.price * a.key.minted },
  { key: "rising", label: "Rising", by: (a, b) => b.key.change24h - a.key.change24h },
  { key: "yield", label: "Highest yield", by: (a, b) => b.key.yieldPct - a.key.yieldPct },
  { key: "cheap", label: "Cheapest sub", by: (a, b) => a.sub.price - b.sub.price },
];

export function KeysMarket() {
  const [sort, setSort] = useState<Sort>("top");
  const data = useKeys();
  const { platform } = data;
  // the market is for keys: live, only traders who listed theirs onchain
  const keyed = useMemo(() => data.traders.filter((t) => t.key.listed), [data.traders]);
  const ranked = useMemo(() => [...keyed].sort(SORTS[0].by), [keyed]);
  const podium = ranked.slice(0, 3);
  const rest = useMemo(() => [...keyed].sort(SORTS.find((s) => s.key === sort)!.by), [keyed, sort]);
  const tape = keyed.length >= 4 ? [...keyed, ...keyed] : [];
  return (
    <div data-testid="keys-market">
      {/* tape */}
      {tape.length > 0 && <div className="card overflow-hidden !rounded-[16px]" aria-label="Key prices">
        <div className="k-tape">
          {tape.map((t, i) => (
            <Link key={i} href={`/keys/${t.handle}`} className="inline-flex items-center gap-2.5 px-6 h-11 text-[13.5px] whitespace-nowrap border-r border-[var(--hair)] hover:bg-[var(--row-hover)]" tabIndex={i < keyed.length ? 0 : -1}>
              <b>{t.handle}</b>
              <span className="num text-fg-2">{fmtUsd(t.key.price)}</span>
              <span className={`num font-semibold ${t.key.change24h >= 0 ? "text-up" : "text-down"}`}>{t.key.change24h >= 0 ? "+" : ""}{t.key.change24h}%</span>
            </Link>
          ))}
        </div>
      </div>}

      {/* header */}
      <section className="text-center pt-14 @3xl:pt-16">
        <h1 className="k-display text-[46px] @3xl:text-[64px] @6xl:text-[76px] font-bold">
          Own a piece of
          <br />
          the <span className="k-brand-glow">best traders.</span>
        </h1>
        <p className="mt-6 mx-auto max-w-[600px] text-[17px] leading-relaxed text-fg-2">
          A key is a share of a trader. Holders split {Math.round(HOLDER_SHARE * 100)}% of the trading fees that trader&apos;s followers generate, paid in USDC. Each key costs a little more than the one before it, and every key can always be sold back.
        </p>
        <div className="card inline-grid grid-cols-3 mt-9 !rounded-[22px] overflow-hidden text-left">
          {[
            { v: fmtUsd(platform.paidToHolders30d, { compact: true }), l: "paid to holders this month", brand: true },
            { v: usdBig(platform.heldInKeys), l: "held in keys" },
            { v: `${platform.avgYield}%`, l: "average holder yield" },
          ].map((s, i) => (
            <div key={s.l} className={`px-5 @3xl:px-8 py-5 ${i ? "border-l border-[var(--hair)]" : ""}`}>
              <div className={`num text-[22px] @3xl:text-[26px] font-semibold tracking-[-0.03em] ${s.brand ? "text-brand" : ""}`}>{s.v}</div>
              <div className="text-[12.5px] @3xl:text-[13.5px] text-muted mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {data.mode === "live" && data.ready && keyed.length === 0 && (
        <div className="mt-16">
          <KeysState title="No keys listed yet" body="Traders list their key from the creator studio. The first ones will show up here the moment they do." action={<Link href="/keys/studio" className="btn btn-primary h-12 px-6 rounded-[14px]">List yours</Link>} />
        </div>
      )}

      {/* podium */}
      {podium.length > 0 && <section className={`grid gap-5 items-end mt-16 ${podium.length === 3 ? "@3xl:grid-cols-3" : podium.length === 2 ? "@3xl:grid-cols-2 max-w-[760px] mx-auto" : "max-w-[400px] mx-auto"}`} data-testid="keys-podium">
        {(podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium).map((t) => (
          <PodiumCard key={t.handle} t={t} rank={ranked.indexOf(t) + 1} />
        ))}
      </section>}

      {/* list */}
      {rest.length > 0 && <section className="mt-16">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-[30px] font-bold tracking-[-0.035em]">All keys</h2>
          <div className="seg" role="tablist" aria-label="Sort keys">
            {SORTS.map((s) => (
              <button key={s.key} type="button" role="tab" aria-selected={sort === s.key} className={`seg-item inline-flex items-center h-8 px-3.5 text-[13px] ${sort === s.key ? "seg-active" : ""}`} onClick={() => setSort(s.key)} data-testid={`keys-sort-${s.key}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card !rounded-[26px] mt-5 overflow-x-auto relative">
          <table className="w-full min-w-[860px] text-left" data-testid="keys-table">
            <thead>
              <tr className="text-[12.5px] text-muted">
                <th className="font-medium pl-7 py-4 w-10">#</th>
                <th className="font-medium py-4">Trader</th>
                <th className="font-medium py-4">30-day PnL</th>
                <th className="font-medium py-4 text-right">Key price</th>
                <th className="font-medium py-4"><span className="sr-only">30-day trend</span></th>
                <th className="font-medium py-4 text-right">Yield</th>
                <th className="font-medium py-4 text-right">Subscription</th>
                <th className="py-4 pr-7"><span className="sr-only">Buy</span></th>
              </tr>
            </thead>
            <tbody>
              {rest.map((t, i) => (
                <tr key={t.handle} className="border-t border-[var(--row)] row-hover">
                  <td className="pl-7 py-4 num text-muted">{i + 1}</td>
                  <td className="py-4">
                    <Link href={`/keys/${t.handle}`} className="flex items-center gap-3.5 min-w-0">
                      <Face who={t} size={44} />
                      <span className="min-w-0">
                        <span className="block text-[15.5px] font-bold truncate">{t.handle}</span>
                        <span className="block text-[12.5px] text-muted truncate">{t.style}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={`py-4 num text-[15px] font-semibold ${t.pnl30d >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(t.pnl30d, { compact: true, sign: true })}</td>
                  <td className="py-4 text-right">
                    <span className="block num text-[15.5px] font-semibold">{fmtUsd(t.key.price)}</span>
                    <span className={`block num text-[12.5px] ${t.key.change24h >= 0 ? "text-up" : "text-down"}`}>{t.key.change24h >= 0 ? "+" : ""}{t.key.change24h}%</span>
                  </td>
                  <td className="py-4 pl-4"><Sparkline data={t.key.history} /></td>
                  <td className="py-4 text-right num text-[15.5px] font-semibold text-brand">{t.key.yieldPct}%</td>
                  <td className="py-4 text-right num text-[14.5px] text-fg-2">{priceLabel(t.sub.price)}{t.sub.price > 0 && <span className="text-muted">/mo</span>}</td>
                  <td className="py-4 pr-7 text-right">
                    <Link href={`/keys/${t.handle}#key`} className="btn h-10 px-4 rounded-[12px]">Buy</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}

      <ResetPreview />
    </div>
  );
}

const MEDAL: Record<number, string> = { 1: "#f5b236", 2: "#c3ccd3", 3: "#c08322" };

function PodiumCard({ t, rank }: { t: KeysTrader; rank: number }) {
  const first = rank === 1;
  return (
    <article className={`${first ? "k-holo order-first @3xl:order-none" : "card !rounded-[30px]"} ${first ? "" : "p-0"}`} data-testid={`podium-${rank}`}>
      <div className={`${first ? "k-holo-in theme-dark !justify-start" : ""} relative overflow-hidden rounded-[29px] flex flex-col items-center text-center ${first ? "px-7 pt-12 pb-8" : "px-6 pt-9 pb-7"}`}>
        <span className="absolute top-5 left-5 w-9 h-9 rounded-full inline-flex items-center justify-center num text-[15px] font-bold text-[#05080a]" style={{ background: MEDAL[rank] }} aria-label={`Rank ${rank}`}>{rank}</span>
        <Face who={t} size={first ? 116 : 92} ring={t.live ? "live" : "off"} live={!!t.live} />
        <h3 className="text-[23px] font-bold tracking-tight mt-5">{t.handle}</h3>
        <p className="text-[13.5px] text-muted mt-0.5">{t.style}</p>
        <div className={`num font-semibold tracking-[-0.045em] leading-none mt-6 ${first ? "text-[52px]" : "text-[40px]"}`}>{fmtUsd(t.key.price)}</div>
        <div className={`num text-[14.5px] font-semibold mt-2 ${t.key.change24h >= 0 ? "text-up" : "text-down"}`}>{t.key.change24h >= 0 ? "+" : ""}{t.key.change24h}% today</div>
        <div className="grid grid-cols-3 gap-2 w-full mt-6">
          {[
            { v: `${t.key.yieldPct}%`, l: "yield", brand: true },
            { v: fmtNum(t.key.holders), l: "holders" },
            { v: priceLabel(t.sub.price), l: "sub / mo" },
          ].map((s) => (
            <div key={s.l} className="card-2 !rounded-[13px] py-3 px-1">
              <div className={`num text-[15.5px] font-semibold ${s.brand ? "text-brand" : ""}`}>{s.v}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>
        <Link href={`/keys/${t.handle}#key`} className={`btn w-full h-12 mt-6 rounded-[15px] text-[14.5px] ${first ? "btn-primary btn-glow" : ""}`}>
          <Icon.key /> Buy key
        </Link>
      </div>
    </article>
  );
}
