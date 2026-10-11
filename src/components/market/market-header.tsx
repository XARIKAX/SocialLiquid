"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMarkets } from "@/hooks/use-market";
import type { MarketSummary } from "@/lib/hl-types";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { CoinIcon, Icon } from "../ui";

function useCountdown() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const next = Math.ceil(now / 3_600_000) * 3_600_000;
      setS(Math.max(0, Math.floor((next - now) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function MarketHeader({ coin, market, mid, longShort }: { coin: string; market?: MarketSummary; mid?: number; longShort?: { ratio: number } }) {
  const up = (market?.change24h ?? 0) >= 0;
  const countdown = useCountdown();
  const abs = market ? market.markPx - market.prevDayPx : 0;
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 px-1">
      <CoinSelect coin={coin} market={market} />
      <div className="grid grid-cols-3 sm:flex sm:items-stretch sm:flex-wrap gap-x-4 gap-y-2 sm:gap-x-5 2xl:gap-x-7 text-[12.5px] flex-1 min-w-0 py-1 pr-1">
        <H label="Mark"><span className={up ? "text-up" : "text-down"}>{fmtPx(mid ?? market?.markPx)}</span></H>
        <H label="Oracle">{fmtPx(market?.oraclePx)}</H>
        <H label="24h Change"><span className={up ? "text-up" : "text-down"}>{market ? `${abs >= 0 ? "+" : ""}${fmtPx(abs)} / ${fmtPct(market.change24h)}` : "–"}</span></H>
        <H label="24h Volume">{market ? fmtUsd(market.volume24h) : "–"}</H>
        <H label="Open Interest">{market ? fmtUsd(market.openInterestUsd) : "–"}</H>
        <H label="Funding / Countdown" className="pr-2">
          <span className={(market?.funding ?? 0) >= 0 ? "text-up" : "text-down"}>{market ? `${(market.funding * 100).toFixed(4)}%` : "–"}</span> <span className="text-fg-2">{countdown}</span>
        </H>
        <H label="Long / Short" className="hidden xl:flex">
          <span className="flex items-center gap-1.5">
            <span className="text-up">{Math.round((longShort?.ratio ?? 0.5) * 100)}%</span>
            <span className="inline-block w-14 h-1.5 rounded-full bg-down overflow-hidden"><span className="block h-full bg-up" style={{ width: `${(longShort?.ratio ?? 0.5) * 100}%` }} /></span>
            <span className="text-down">{Math.round((1 - (longShort?.ratio ?? 0.5)) * 100)}%</span>
          </span>
        </H>
      </div>
    </div>
  );
}

function H({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col justify-center shrink-0 ${className}`}>
      <span className="text-[11px] text-muted underline decoration-dotted decoration-line-2 underline-offset-4">{label}</span>
      <span className="num font-medium mt-0.5 whitespace-nowrap">{children}</span>
    </div>
  );
}

function CoinSelect({ coin, market }: { coin: string; market?: MarketSummary }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const markets = useMarkets();
  useEffect(() => {
    try {
      setFavs(JSON.parse(localStorage.getItem("sl:favs") ?? "[]"));
    } catch {}
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggleFav = (c: string) => {
    const next = favs.includes(c) ? favs.filter((x) => x !== c) : [...favs, c];
    setFavs(next);
    try {
      localStorage.setItem("sl:favs", JSON.stringify(next));
    } catch {}
  };
  const list = useMemo(() => {
    const all = markets.data ?? [];
    const f = all.filter((m) => m.coin.toLowerCase().includes(q.toLowerCase()));
    return [...f.filter((m) => favs.includes(m.coin)), ...f.filter((m) => !favs.includes(m.coin))];
  }, [markets.data, q, favs]);
  const isFav = favs.includes(coin);
  return (
    <div ref={ref} className="relative flex items-center gap-2 shrink-0">
      <button className="flex items-center gap-2.5 h-11 pl-1 pr-2 rounded-xl hover:bg-panel-2 transition-colors" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <CoinIcon coin={coin} size={30} />
        <span className="text-[19px] font-semibold tracking-tight">{coin}-USD</span>
        <span className="text-muted"><Icon.chevron /></span>
        <span className="pill pill-brand num">{market?.maxLeverage ?? "–"}x</span>
      </button>
      <button className={`p-1.5 rounded-md ${isFav ? "text-warn" : "text-dim hover:text-fg"}`} onClick={() => toggleFav(coin)} title="watchlist"><Icon.star /></button>
      {open && (
        <div className="absolute left-0 top-12 z-40 w-[440px] max-w-[92vw] card shadow-2xl shadow-black/70 overflow-hidden">
          <div className="p-2 border-b border-line">
            <div className="flex items-center h-9 card-2 px-2.5 gap-2">
              <span className="text-dim"><Icon.search /></span>
              <input autoFocus className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-dim" placeholder="Search markets" value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="kbd">esc</span>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] text-[11px] text-dim px-3 h-7 items-center gap-3">
            <span>Market</span><span className="text-right w-20">Price</span><span className="text-right w-16">24h</span><span className="text-right w-16">Volume</span>
          </div>
          <div className="max-h-[360px] overflow-y-auto" role="listbox">
            {list.map((m) => (
              <Link key={m.coin} href={`/m/${m.coin}`} onClick={() => setOpen(false)} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 h-10 row-hover text-[13px] ${m.coin === coin ? "bg-panel-2" : ""}`} role="option" aria-selected={m.coin === coin}>
                <span className="flex items-center gap-2 min-w-0">
                  <button className={`${favs.includes(m.coin) ? "text-warn" : "text-dim hover:text-fg"}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(m.coin); }} aria-label="favourite"><Icon.star /></button>
                  <CoinIcon coin={m.coin} size={20} />
                  <span className="font-semibold">{m.coin}</span>
                  <span className="text-dim text-[11px]">{m.maxLeverage}x</span>
                </span>
                <span className="num text-right w-20">{fmtPx(m.markPx)}</span>
                <span className={`num text-right w-16 ${m.change24h >= 0 ? "text-up" : "text-down"}`}>{fmtPct(m.change24h)}</span>
                <span className="num text-right w-16 text-muted">{fmtUsd(m.volume24h, { compact: true })}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
