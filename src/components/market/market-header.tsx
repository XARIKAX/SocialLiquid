"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

/** the title hyperliquid shows: BTC-USD for perps, SOL/USDC for spot, BRENTOIL-USD for builder-dex perps */
export function marketTitle(m?: MarketSummary, coin?: string) {
  if (!m) return `${coin ?? ""}-USD`;
  return m.kind === "spot" ? m.name : `${m.name}-USD`;
}

export function MarketHeader({ coin, market, mid, longShort, watching }: { coin: string; market?: MarketSummary; mid?: number; longShort?: { ratio: number }; watching?: number | null }) {
  const up = (market?.change24h ?? 0) >= 0;
  const countdown = useCountdown();
  const abs = market ? market.markPx - market.prevDayPx : 0;
  const spot = market?.kind === "spot";
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 px-1">
      <CoinSelect coin={coin} market={market} />
      <div className="grid grid-cols-3 sm:flex sm:items-stretch sm:flex-wrap gap-x-4 gap-y-2 sm:gap-x-5 2xl:gap-x-7 text-[12.5px] flex-1 min-w-0 py-1 pr-1">
        <H label={spot ? "Price" : "Mark"}><span className={up ? "text-up" : "text-down"}>{fmtPx(mid ?? market?.markPx)}</span></H>
        {!spot && <H label="Oracle">{fmtPx(market?.oraclePx)}</H>}
        <H label="24h Change"><span className={up ? "text-up" : "text-down"}>{market ? `${abs >= 0 ? "+" : ""}${fmtPx(abs)} / ${fmtPct(market.change24h)}` : "–"}</span></H>
        <H label="24h Volume">{market ? fmtUsd(market.volume24h) : "–"}</H>
        {!spot && <H label="Open Interest">{market ? fmtUsd(market.openInterestUsd) : "–"}</H>}
        {!spot && (
          <H label="Funding / Countdown" className="pr-2">
            <span className={(market?.funding ?? 0) >= 0 ? "text-up" : "text-down"}>{market ? `${(market.funding * 100).toFixed(4)}%` : "–"}</span> <span className="text-fg-2">{countdown}</span>
          </H>
        )}
        {!spot && (
          <H label="Long / Short" className="hidden xl:flex">
            <span className="flex items-center gap-1.5">
              <span className="text-up">{Math.round((longShort?.ratio ?? 0.5) * 100)}%</span>
              <span className="inline-block w-14 h-1.5 rounded-full bg-down overflow-hidden"><span className="block h-full bg-up" style={{ width: `${(longShort?.ratio ?? 0.5) * 100}%` }} /></span>
              <span className="text-down">{Math.round((1 - (longShort?.ratio ?? 0.5)) * 100)}%</span>
            </span>
          </H>
        )}
        {market?.kind === "hip3" && <H label="Deployed by">{market.dexName ?? market.dex}</H>}
        {watching !== null && watching !== undefined && watching > 0 && (
          <H label="Watching">
            <span className="inline-flex items-center gap-1.5" data-testid="watching"><span className="w-1.5 h-1.5 rounded-full bg-up live-dot" />{watching} {watching === 1 ? "person" : "people"}</span>
          </H>
        )}
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

type Tab = "all" | "perps" | "spot" | "tradfi" | "trending" | "favs";
const TABS: [Tab, string][] = [["all", "All"], ["perps", "Perps"], ["spot", "Spot"], ["tradfi", "Tradfi"], ["trending", "Trending"], ["favs", "★"]];
const TRADFI_SUB = ["All", "Stocks", "Indices", "Commodities", "FX", "Pre-IPO"];
type SortKey = "volume24h" | "change24h" | "funding" | "openInterestUsd" | "markPx";

/**
 * market picker, the way hyperliquid's dialog works: tabs for every market class, search, favourites, sortable columns
 * (price, 24h change, 8h funding, volume, open interest), ⌘K to open and arrow keys to move.
 */
function CoinSelect({ coin, market }: { coin: string; market?: MarketSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sub, setSub] = useState("All");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "volume24h", dir: -1 });
  const [favs, setFavs] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const markets = useMarkets();
  useEffect(() => {
    try {
      setFavs(JSON.parse(localStorage.getItem("sl:favs") ?? "[]"));
    } catch {}
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, []);
  const toggleFav = (c: string) => {
    const next = favs.includes(c) ? favs.filter((x) => x !== c) : [...favs, c];
    setFavs(next);
    try {
      localStorage.setItem("sl:favs", JSON.stringify(next));
    } catch {}
  };
  const counts = useMemo(() => {
    const all = markets.data ?? [];
    return { all: all.length, perps: all.filter((m) => m.kind === "perp").length, spot: all.filter((m) => m.kind === "spot").length, tradfi: all.filter((m) => m.kind === "hip3").length };
  }, [markets.data]);
  const list = useMemo(() => {
    const all = markets.data ?? [];
    const needle = q.trim().toLowerCase();
    let f = all.filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.coin.toLowerCase().includes(needle) || (m.category ?? "").toLowerCase().includes(needle));
    if (tab === "perps") f = f.filter((m) => m.kind === "perp");
    else if (tab === "spot") f = f.filter((m) => m.kind === "spot");
    else if (tab === "tradfi") f = f.filter((m) => m.kind === "hip3" && (sub === "All" || m.category === sub));
    else if (tab === "favs") f = f.filter((m) => favs.includes(m.coin));
    else if (tab === "trending") f = f.filter((m) => m.volume24h > 100_000).sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 30);
    if (tab !== "trending") f = [...f].sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
    if (!needle && tab === "all") f = [...f.filter((m) => favs.includes(m.coin)), ...f.filter((m) => !favs.includes(m.coin))];
    return f;
  }, [markets.data, q, tab, sub, sort, favs]);
  useEffect(() => setCursor(0), [q, tab, sub]);
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const go = (m: MarketSummary) => {
    setOpen(false);
    router.push(`/m/${encodeURIComponent(m.slug)}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(list.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && list[cursor]) go(list[cursor]);
    else if (e.key === "Escape") setOpen(false);
  };
  const th = (key: SortKey, label: string, cls = "") => (
    <button className={`text-right ${cls} hover:text-fg ${sort.key === key ? "text-fg" : ""}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }))}>
      {label}
      {sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
    </button>
  );
  const isFav = favs.includes(coin);
  const title = marketTitle(market, coin);
  return (
    <div ref={ref} className="relative flex items-center gap-2 shrink-0">
      <button className="flex items-center gap-2.5 h-11 pl-1 pr-2 rounded-xl hover:bg-panel-2 transition-colors" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} data-testid="market-select">
        <CoinIcon coin={market?.base ?? coin} size={30} />
        <span className="text-[19px] font-semibold tracking-tight">{title}</span>
        <span className="text-muted"><Icon.chevron /></span>
        {market?.kind === "spot" ? <span className="pill pill-neutral">Spot</span> : <span className="pill pill-brand num">{market?.maxLeverage ?? "–"}x</span>}
        {market?.kind === "hip3" && <span className="pill pill-neutral">{market.dex}</span>}
      </button>
      <button className={`p-1.5 rounded-md ${isFav ? "text-warn" : "text-dim hover:text-fg"}`} onClick={() => toggleFav(coin)} title="watchlist"><Icon.star /></button>
      {open && (
        <div className="absolute left-0 top-12 z-40 w-[760px] max-w-[94vw] card shadow-2xl shadow-black/70 overflow-hidden" onKeyDown={onKey} data-testid="market-list">
          <div className="p-2 border-b border-line">
            <div className="flex items-center h-9 card-2 px-2.5 gap-2">
              <span className="text-dim"><Icon.search /></span>
              <input autoFocus className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-dim" placeholder="Search markets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search markets" />
              <span className="kbd">⌘K</span>
            </div>
            <div className="flex items-center gap-1 mt-2 overflow-x-auto">
              {TABS.map(([t, l]) => (
                <button key={t} className={`tab h-7 px-2.5 text-[12px] shrink-0 ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)} data-testid={`mtab-${t}`}>
                  {l}
                  {t === "perps" || t === "spot" || t === "tradfi" ? <span className="text-dim ml-1 num">{counts[t]}</span> : null}
                </button>
              ))}
            </div>
            {tab === "tradfi" && (
              <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
                {TRADFI_SUB.map((c) => (
                  <button key={c} className={`tab h-6 px-2 text-[11px] shrink-0 ${sub === c ? "tab-active" : ""}`} onClick={() => setSub(c)}>{c}</button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_84px_84px_76px_84px_84px] text-[11px] text-dim px-3 h-7 items-center gap-3">
            <span>Market</span>
            {th("markPx", "Last Price")}
            {th("change24h", "24h Change")}
            {th("funding", "8h Funding")}
            {th("volume24h", "Volume")}
            {th("openInterestUsd", "Open Interest")}
          </div>
          <div className="max-h-[400px] overflow-y-auto" role="listbox" ref={listRef}>
            {list.length === 0 && <div className="px-3 py-6 text-center text-xs text-dim">{markets.isLoading ? "Loading markets…" : "No markets match."}</div>}
            {list.map((m, i) => (
              <Link
                key={m.coin}
                href={`/m/${encodeURIComponent(m.slug)}`}
                onClick={() => setOpen(false)}
                className={`grid grid-cols-[minmax(0,1fr)_84px_84px_76px_84px_84px] items-center gap-3 px-3 h-10 row-hover text-[13px] ${m.coin === coin ? "bg-panel-2" : ""} ${i === cursor ? "ring-1 ring-inset ring-line-2" : ""}`}
                role="option"
                aria-selected={m.coin === coin}
                onMouseEnter={() => setCursor(i)}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <button className={`${favs.includes(m.coin) ? "text-warn" : "text-dim hover:text-fg"}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(m.coin); }} aria-label="favourite"><Icon.star /></button>
                  <CoinIcon coin={m.base} size={20} />
                  <span className="font-semibold truncate">{m.kind === "spot" ? m.name : `${m.name}-USDC`}</span>
                  {m.kind === "spot" ? <span className="pill pill-neutral text-[10px]">Spot</span> : <span className="text-dim text-[11px] num">{m.maxLeverage}x</span>}
                  {m.kind === "hip3" && <span className="pill pill-neutral text-[10px]">{m.dex}</span>}
                </span>
                <span className="num text-right">{fmtPx(m.markPx)}</span>
                <span className={`num text-right ${m.change24h >= 0 ? "text-up" : "text-down"}`}>{fmtPct(m.change24h)}</span>
                <span className={`num text-right ${m.kind === "spot" ? "text-dim" : m.funding >= 0 ? "text-up" : "text-down"}`}>{m.kind === "spot" ? "–" : `${(m.funding * 100).toFixed(4)}%`}</span>
                <span className="num text-right text-muted">{fmtUsd(m.volume24h, { compact: true })}</span>
                <span className="num text-right text-muted">{m.kind === "spot" ? "–" : fmtUsd(m.openInterestUsd, { compact: true })}</span>
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3 px-3 h-7 border-t border-line text-[10px] text-dim">
            <span><span className="kbd">⌘K</span> Open</span>
            <span><span className="kbd">↑↓</span> Navigate</span>
            <span><span className="kbd">Enter</span> Select</span>
            <span><span className="kbd">Esc</span> Close</span>
          </div>
        </div>
      )}
    </div>
  );
}
