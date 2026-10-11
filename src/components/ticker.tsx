"use client";
import Link from "next/link";
import { useMarkets, useMids } from "@/hooks/use-market";
import { fmtPct, fmtPx } from "@/lib/format";
import { CoinIcon, Icon } from "./ui";

const PINNED = ["BTC", "ETH", "SOL", "HYPE"];

export function Ticker() {
  const markets = useMarkets();
  const mids = useMids();
  return (
    <footer className="hidden md:flex fixed bottom-0 inset-x-0 h-8 bg-panel border-t border-line items-center px-4 gap-5 text-xs z-20">
      {PINNED.map((c) => {
        const m = markets.data?.find((x) => x.coin === c);
        const px = mids.data?.[c] ? Number(mids.data[c]) : m?.markPx;
        return (
          <Link key={c} href={`/m/${c}`} className="flex items-center gap-1.5 hover:text-fg text-fg-2">
            <CoinIcon coin={c} size={14} />
            <span className="num">{px ? fmtPx(px) : "…"}</span>
            {m && <span className={`num ${m.change24h >= 0 ? "text-up" : "text-down"}`}>{m.change24h >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(m.change24h), 2, false)}</span>}
          </Link>
        );
      })}
      <span className="ml-auto flex items-center gap-4 text-muted">
        <span className="flex items-center gap-1.5 text-up"><span className="w-1.5 h-1.5 rounded-full bg-up live-dot" /> Live</span>
        <a href="https://hyperliquid.xyz" target="_blank" rel="noreferrer" className="hover:text-fg">Built on Hyperliquid</a>
        <a href="https://x.com" target="_blank" rel="noreferrer" className="hover:text-fg"><Icon.x /></a>
      </span>
    </footer>
  );
}
