"use client";
import "./market-header.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { useMarkets } from "@/hooks/use-market";
import type { MarketSummary } from "@/lib/hl-types";
import { CoinIcon, Icon } from "../ui";

/* =====================================================================
   the market header: who you are trading (a lit coin, the symbol, max
   leverage, the watchlist star) and the numbers that matter, as boxed
   glass chips. mark is the hero: biggest, coloured, it flashes on every
   tick. the selector opens a tradingview-style symbol search ("/").
   layout follows the header's own width (container queries):
   wide = one row, mid = identity + hero over a full-width chip row,
   narrow = identity over one scrolling chip row.
   ===================================================================== */

type LongShort = { ratio: number; longUsd?: number; shortUsd?: number };

const FAVS_KEY = "sl:favs";
const HOUR = 3_600_000;

/* brand light for the coin ring; anything unlisted glows mint */
const COIN_RGB: Record<string, string> = {
  BTC: "247 147 26",
  ETH: "128 150 255",
  SOL: "153 69 255",
  HYPE: "77 227 193",
  ARB: "40 160 240",
  DOGE: "214 182 74",
  XRP: "150 170 190",
  SUI: "77 162 255",
  AVAX: "232 65 66",
  LINK: "55 110 235",
  BNB: "243 186 47",
  PEPE: "92 176 70",
  WIF: "205 160 112",
  TON: "0 152 234",
  ADA: "60 110 230",
  LTC: "170 180 200",
  TRUMP: "235 190 80",
  ENA: "150 150 160",
  APT: "120 220 200",
  TIA: "150 90 230",
  OP: "255 4 32",
  NEAR: "120 200 160",
  INJ: "0 160 250",
  SEI: "200 60 70",
  AAVE: "180 100 200",
};

/* ---------- formatting ---------- */

function usdCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

function pctStr(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const x = v * 100;
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

/** decimals the price itself is shown with, so the absolute change lines up with it */
function pxDecimals(ref: number): number {
  const a = Math.abs(ref);
  if (!Number.isFinite(a) || a === 0) return 2;
  if (a >= 1000) return 1;
  if (a >= 1) return 3;
  if (a >= 0.01) return 4;
  return Math.max(0, 2 - Math.floor(Math.log10(a)));
}

/** a price at a fixed precision for its magnitude, so a live number never changes width on a round tick */
function fmtPrice(v: number | null | undefined, ref?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const r = Math.abs(ref ?? v);
  if (r < 0.01 && ref === undefined) return v.toPrecision(3);
  const d = pxDecimals(r);
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtDelta(d: number, ref: number): string {
  if (!Number.isFinite(d)) return "–";
  return `${d > 0 ? "+" : d < 0 ? "-" : ""}${fmtPrice(Math.abs(d), ref)}`;
}

function clock(ms: number | null): string {
  if (ms === null) return "--:--:--";
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h}:${m}:${String(s % 60).padStart(2, "0")}`;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/* ---------- hooks ---------- */

/** ms to the next hourly funding, ticking on the second (null until mounted, so ssr and the first paint agree) */
function useFundingClock(): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = Date.now();
      setLeft(Math.floor(now / HOUR) * HOUR + HOUR - now);
      t = setTimeout(tick, 1000 - (now % 1000) + 8);
    };
    tick();
    return () => clearTimeout(t);
  }, []);
  return left;
}

/** the watchlist, persisted under sl:favs and kept in sync across tabs */
function useWatchlist(): [string[], (coin: string) => void] {
  const [favs, setFavs] = useState<string[]>([]);
  const latest = useRef<string[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const v = JSON.parse(localStorage.getItem(FAVS_KEY) ?? "[]");
        latest.current = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        setFavs(latest.current);
      } catch {}
    };
    read();
    const onStorage = (e: StorageEvent) => e.key === FAVS_KEY && read();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const toggle = useCallback((c: string) => {
    const prev = latest.current;
    const next = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c];
    latest.current = next;
    setFavs(next);
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(next));
    } catch {}
  }, []);
  return [favs, toggle];
}

/** a chip row that scrolls like a native strip everywhere: soft fades on whichever edge still has chips,
 *  a vertical wheel scrolls it sideways, and a mouse can grab and drag it */
function useChipRail<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute("data-scrollable", max > 1);
      el.toggleAttribute("data-fade-l", max > 1 && el.scrollLeft > 1);
      el.toggleAttribute("data-fade-r", max > 1 && el.scrollLeft < max - 1);
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
    };
    // grab-to-scroll for mice; touch and pens scroll natively
    let drag: { id: number; x: number; left: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || el.scrollWidth - el.clientWidth <= 1) return;
      drag = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        el.setPointerCapture(e.pointerId);
        el.setAttribute("data-dragging", "");
      }
      el.scrollLeft = drag.left - dx;
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) {
        el.removeAttribute("data-dragging");
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        // a drag is not a click
        const swallow = (c: MouseEvent) => c.stopPropagation();
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      }
      drag = null;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      ro.disconnect();
    };
  }, []);
  return ref;
}

/** one shared tooltip for the chips and the identity controls: delegated hover, placed under the element,
 *  never clipped by the scrolling row. the title is the chip's own label unless data-tip-label names one. */
type Tip = { label: string; body: string; kbd?: string; x: number; y: number };
function useChipTips() {
  const rootRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const over = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef(false);
  // right after one tooltip closes the next opens instantly, like a menu bar
  const warmUntil = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    over.current = null;
    if (shown.current) warmUntil.current = Date.now() + 500;
    shown.current = false;
    setTip(null);
  }, []);

  const show = (el: HTMLElement) => {
    const root = rootRef.current;
    if (!root || root.querySelector(".tm-head-pop")) return;
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    shown.current = true;
    setTip({
      label: el.dataset.tipLabel ?? el.querySelector(".chip-label")?.textContent ?? "",
      body: el.dataset.tip ?? "",
      kbd: el.dataset.tipKbd,
      x: r.left - rr.left + r.width / 2,
      y: r.bottom - rr.top + 9,
    });
  };

  // keep it inside the header horizontally once its width is known (before paint, so it never jumps)
  useLayoutEffect(() => {
    const el = tipRef.current;
    const root = rootRef.current;
    if (!el || !root || !tip) return;
    const half = el.offsetWidth / 2;
    const x = Math.min(Math.max(tip.x, half), root.clientWidth - half);
    el.style.left = `${x}px`;
    el.style.setProperty("--tm-head-tip-arrow", `${tip.x - x}px`);
  }, [tip]);

  // any scroll moves the chips out from under it
  useEffect(() => {
    if (!tip) return;
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [tip, hide]);

  const handlers = {
    onPointerOver: (e: ReactPointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const chip = (e.target as Element).closest<HTMLElement>("[data-tip]");
      if (!chip || chip === over.current) return;
      over.current = chip;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => show(chip), Date.now() < warmUntil.current || shown.current ? 0 : 420);
    },
    onPointerOut: (e: ReactPointerEvent) => {
      const cur = over.current;
      if (!cur || cur.contains(e.relatedTarget as Node | null)) return;
      hide();
    },
    onPointerDown: hide,
  };

  const node = tip ? (
    <div ref={tipRef} className="tm-head-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <b>
        {tip.label}
        {tip.kbd && <span className="kbd">{tip.kbd}</span>}
      </b>
      {tip.body}
    </div>
  ) : null;
  return { rootRef, handlers, node };
}

/**
 * the container queries offer the richest layout the header's width allows; the live numbers decide whether it
 * really fits (a sub-cent price or a long symbol needs more room than BTC). each step down is tried in order
 * until nothing overflows: "tight" keeps one row but drops the 24h change's absolute move, "rows" is the
 * two-row layout, "stack" the phone layout. the symbol never truncates and the one-row strip never scrolls.
 */
const FIT_STEPS = ["tight", "rows", "stack"] as const;
function useFit(rootRef: RefObject<HTMLDivElement | null>) {
  const sig = useRef("");
  const check = useCallback(() => {
    const root = rootRef.current;
    const grid = root?.querySelector<HTMLElement>(".tm-head-grid");
    const stats = root?.querySelector<HTMLElement>(".tm-head-stats");
    const sym = root?.querySelector<HTMLElement>(".tm-head-sym");
    if (!root || !grid || !stats || !sym) return;
    const fits = () => sym.scrollWidth <= sym.clientWidth + 1 && (getComputedStyle(grid).display !== "flex" || stats.scrollWidth <= stats.clientWidth + 1);
    root.removeAttribute("data-fit");
    for (const step of FIT_STEPS) {
      if (fits()) return;
      root.setAttribute("data-fit", step);
    }
  }, [rootRef]);

  // the width changing: decided in the next frame, outside the observer, so a new layout never re-triggers it
  useEffect(() => {
    const cq = rootRef.current?.querySelector<HTMLElement>(".tm-head-cq");
    if (!cq) return;
    let w = -1;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const nw = Math.round(entries[0]?.contentRect.width ?? 0);
      if (nw === w) return;
      w = nw;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    });
    ro.observe(cq);
    let live = true;
    document.fonts?.ready.then(() => live && check()).catch(() => {});
    return () => {
      live = false;
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [check, rootRef]);

  // the content changing length (a price gaining a digit, another market): decided before paint
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = `${root.querySelector(".tm-head-sel")?.textContent}|${root.querySelector(".tm-head-stats")?.textContent?.length}`;
    if (s === sig.current) return;
    sig.current = s;
    check();
  });
}

/* ---------- the header ---------- */

export function MarketHeader({ coin, market, mid, longShort }: { coin: string; market?: MarketSummary; mid?: number; longShort?: LongShort }) {
  const [favs, toggleFav] = useWatchlist();
  const px = mid ?? market?.markPx;
  const change = market?.change24h;
  const dir: "up" | "down" | undefined = change === undefined ? undefined : change >= 0 ? "up" : "down";
  const abs = market ? market.markPx - market.prevDayPx : null;
  const statsRef = useChipRail<HTMLDivElement>();
  const restRef = useChipRail<HTMLDivElement>();
  const tips = useChipTips();
  useFit(tips.rootRef);

  return (
    <div className="tm-head" data-tm-head ref={tips.rootRef} {...tips.handlers}>
      {tips.node}
      <div className="tm-head-cq">
        <div className="tm-head-grid">
          <CoinSelect coin={coin} market={market} favs={favs} toggleFav={toggleFav} />

          <div className="tm-head-stats" ref={statsRef}>
            <div className="tm-head-hero">
              <MarkChip key={coin} px={px} dir={dir} oracle={market?.oraclePx} />
              <div
                className="chip tm-head-chip tm-head-change"
                data-dir={dir}
                data-tip={market && abs !== null ? `${fmtDelta(abs, market.markPx)} (${pctStr(change)}) since this time yesterday, from ${fmtPrice(market.prevDayPx)}.` : "Change over the last 24 hours."}
              >
                <span className="chip-label">24h change</span>
                <span className="chip-value num">
                  {market && abs !== null ? (
                    <>
                      <span className="tm-head-abs">{fmtDelta(abs, market.markPx)}</span>
                      <span className="tm-head-pct">{pctStr(change)}</span>
                    </>
                  ) : (
                    <Skel w={92} />
                  )}
                </span>
              </div>
            </div>

            <div className="tm-head-rest" ref={restRef}>
              <div className="chip tm-head-chip tm-head-quiet" data-tip="The validators' index price, sampled from major venues. Funding is anchored to it.">
                <span className="chip-label">Oracle</span>
                <span className="chip-value num">{market ? fmtPrice(market.oraclePx) : <Skel w={70} />}</span>
              </div>
              <div className="chip tm-head-chip" data-tip={market ? `${exactUsd(market.volume24h)} traded in the last 24 hours.` : "Notional traded in the last 24 hours."}>
                <span className="chip-label">24h volume</span>
                <span className="chip-value num">{market ? usdCompact(market.volume24h) : <Skel w={52} />}</span>
              </div>
              <div className="chip tm-head-chip" data-tip={market ? `${exactUsd(market.openInterestUsd)} in open positions on this market.` : "Value of all open positions on this market."}>
                <span className="chip-label">Open interest</span>
                <span className="chip-value num">{market ? usdCompact(market.openInterestUsd) : <Skel w={60} />}</span>
              </div>
              <FundingChip funding={market?.funding} />
              <LongShortChip ls={longShort} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function exactUsd(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/* ---------- chips ---------- */

/** a shimmering placeholder the width of the number it stands in for */
function Skel({ w }: { w: number }) {
  return <span className="skeleton tm-head-skel" style={{ width: w }} aria-hidden />;
}

/** the hero: the live mark, coloured by the day, with a soft flash in the direction of every tick */
function MarkChip({ px, dir, oracle }: { px?: number; dir?: "up" | "down"; oracle?: number }) {
  const prev = useRef<number | undefined>(undefined);
  const [tick, setTick] = useState<{ dir: "up" | "down"; n: number } | null>(null);
  useEffect(() => {
    if (px === undefined || !Number.isFinite(px)) return;
    const p = prev.current;
    prev.current = px;
    if (p === undefined || p === px) return;
    setTick((t) => ({ dir: px > p ? "up" : "down", n: (t?.n ?? 0) + 1 }));
  }, [px]);
  const basis = px !== undefined && oracle ? ((px - oracle) / oracle) * 100 : null;
  return (
    <div
      className="chip tm-head-chip tm-head-mark"
      data-dir={dir}
      data-tip={`The live price your PnL and liquidations are measured against.${basis === null ? "" : Math.abs(basis) < 0.0005 ? " Right on the oracle." : ` ${basis > 0 ? "+" : "-"}${Math.abs(basis).toFixed(3)}% vs the oracle.`}`}
    >
      {/* every tick: the chip brightens in its own colour (one hue, so it never muddies), and the arrow
          pops in the tick's colour, which is where up or down is read */}
      {tick && <span key={tick.n} className="tm-head-flash" aria-hidden />}
      <span className="chip-label tm-head-mark-label">
        <span className="tm-head-live live-dot" aria-hidden />
        Mark
      </span>
      <span className="chip-value num tm-head-mark-px">
        {px === undefined ? <Skel w={96} /> : fmtPrice(px)}
        <span key={tick?.n ?? 0} className="tm-head-tick" data-dir={tick?.dir} aria-hidden>
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M4 1.2 7.4 6.6H.6z" fill="currentColor" />
          </svg>
        </span>
      </span>
    </div>
  );
}

function FundingChip({ funding }: { funding?: number }) {
  const left = useFundingClock();
  const has = funding !== undefined && Number.isFinite(funding);
  const neg = has && (funding as number) < 0;
  // until the clock is known (ssr, first paint) the dial is just its quiet track, not a full fresh hour
  const progress = left === null ? 1 : 1 - left / HOUR;
  const apr = has ? (funding as number) * 24 * 365 * 100 : null;
  const soon = left !== null && left < 60_000;
  return (
    <div
      className="chip tm-head-chip tm-head-fund"
      data-neg={neg || undefined}
      data-soon={soon || undefined}
      data-tip={has ? `${neg ? "Shorts pay longs" : "Longs pay shorts"} ${Math.abs((funding as number) * 100).toFixed(4)}% at the top of every hour, about ${Math.abs(apr ?? 0).toFixed(2)}% a year.` : "Funding is paid at the top of every hour."}
      style={{ "--tm-head-p": progress.toFixed(4) } as CSSProperties}
    >
      <span className="chip-label">Funding / Countdown</span>
      <span className="chip-value num tm-head-fund-row">
        <span className="tm-head-fund-rate">{has ? `${((funding as number) * 100).toFixed(4)}%` : <Skel w={50} />}</span>
        <span className="tm-head-cd" aria-label={`next funding in ${clock(left)}`}>
          {/* what is left of the hour, as a lit ring that drains into the payment */}
          <span className="tm-head-cd-ring" aria-hidden />
          <span className="mono">{clock(left)}</span>
        </span>
      </span>
    </div>
  );
}

function LongShortChip({ ls }: { ls?: LongShort }) {
  const sized = ls !== undefined && ls.longUsd !== undefined && ls.shortUsd !== undefined;
  // the api reports an even split when nobody holds anything: show that as no data, not as 50 / 50
  const ok = ls !== undefined && Number.isFinite(ls.ratio) && !(sized && (ls.longUsd as number) + (ls.shortUsd as number) <= 0);
  const r = ok ? Math.min(1, Math.max(0, ls.ratio)) : 0.5;
  const longPct = Math.round(r * 100);
  const tip = ok && sized ? `Tracked traders here hold ${usdCompact(ls.longUsd)} long and ${usdCompact(ls.shortUsd)} short.` : sized ? "No tracked trader holds a position here yet." : "How tracked traders' open positions split between longs and shorts.";
  return (
    <div className="chip tm-head-chip tm-head-ls" data-empty={!ok || undefined} data-tip={tip}>
      <span className="chip-label">Long / Short</span>
      <span className="chip-value num tm-head-ls-row">
        <span className="tm-head-ls-l" data-zero={(ok && longPct === 0) || undefined}>
          {ok ? `${longPct}%` : "–"}
        </span>
        <span className="tm-head-ls-bar" aria-hidden>
          {/* no positions is one quiet track: two equal halves would read as a 50 / 50 split */}
          {!ok && <i className="tm-head-ls-seg-none" />}
          {ok && r > 0 && <i className="tm-head-ls-seg-l" style={{ flexGrow: r }} />}
          {ok && r < 1 && <i className="tm-head-ls-seg-s" style={{ flexGrow: 1 - r }} />}
        </span>
        <span className="tm-head-ls-s" data-zero={(ok && longPct === 100) || undefined}>
          {ok ? `${100 - longPct}%` : "–"}
        </span>
      </span>
    </div>
  );
}

/* ---------- identity + symbol search ---------- */

function StarGlyph({ on, size = 15 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={on ? 1.2 : 1.75} strokeLinejoin="round">
      <path d="m12 2.6 2.95 5.98 6.6.96-4.78 4.65 1.13 6.57L12 17.66 6.1 20.76l1.13-6.57L2.45 9.54l6.6-.96z" />
    </svg>
  );
}

function coinRgb(coin: string): string {
  return COIN_RGB[coin] ?? "77 227 193";
}

function CoinRing({ coin, size }: { coin: string; size: number }) {
  return (
    <span className="tm-head-coin" style={{ "--tm-head-coin": coinRgb(coin), width: size, height: size } as CSSProperties}>
      <CoinIcon coin={coin} size={size} />
    </span>
  );
}

function CoinSelect({ coin, market, favs, toggleFav }: { coin: string; market?: MarketSummary; favs: string[]; toggleFav: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  // what the search opens with: the key that opened it, when it was typed over the chart
  const [seed, setSeed] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // opened by typing over the chart: esc hands focus back to the chart, so its keys keep working
  const returnTo = useRef<HTMLElement | null>(null);
  const popId = useId();
  const isFav = favs.includes(coin);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    const back = returnTo.current?.isConnected ? returnTo.current : btnRef.current;
    returnTo.current = null;
    if (refocus) requestAnimationFrame(() => back?.focus({ preventScroll: true }));
  }, []);

  // a new market closes the search
  useEffect(() => setOpen(false), [coin]);

  // "/" from anywhere opens the search. and, as on tradingview, a letter or digit typed over the chart (or with
  // nothing focused) opens it already searching for that key. never while typing, over a modal or a fullscreen
  // chart, and never with a modifier held (the chart owns shift and alt shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const slash = e.key === "/";
      const char = !slash && !e.shiftKey && /^[a-z0-9]$/i.test(e.key) ? e.key : null;
      if (!slash && !char) return;
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      if (document.querySelector('[aria-modal="true"]') || document.fullscreenElement) return;
      const root = rootRef.current;
      if (!root || root.offsetParent === null) return;
      const a = document.activeElement;
      if (char && a && a !== document.body && a !== document.documentElement && !root.contains(a) && !a.closest('[aria-roledescription="chart"]')) return;
      // already open with focus on its tabs: the key goes to the field (a letter lands there by itself)
      const field = root.querySelector<HTMLInputElement>(".tm-head-pop input");
      if (field) {
        if (slash) e.preventDefault();
        field.focus();
        return;
      }
      e.preventDefault();
      returnTo.current = a instanceof HTMLElement && a.closest('[aria-roledescription="chart"]') ? a : null;
      setSeed(char ?? "");
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // pointer down anywhere outside closes it
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);

  return (
    <div ref={rootRef} className="tm-head-id" data-open={open || undefined}>
      <button
        ref={btnRef}
        type="button"
        className="tm-head-sel"
        onClick={() => {
          returnTo.current = null;
          setSeed("");
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${coin}-USD perpetual${market ? `, ${market.maxLeverage}x max leverage` : ""}. Change market`}
        aria-keyshortcuts="/"
        data-tip-label="Search markets"
        data-tip-kbd="/"
        data-tip="Every perp, by 24h volume. Or just start typing over the chart."
      >
        <CoinRing coin={coin} size={30} />
        <span className="tm-head-sym">{coin}-USD</span>
        <span className="tm-head-chev" aria-hidden>
          <Icon.chevron />
        </span>
        {market && <span className="pill pill-brand num tm-head-lev">{market.maxLeverage}x</span>}
      </button>
      <button
        type="button"
        className="tm-head-star"
        data-on={isFav || undefined}
        aria-pressed={isFav}
        aria-label={isFav ? `Remove ${coin} from watchlist` : `Add ${coin} to watchlist`}
        data-tip-label="Watchlist"
        data-tip={isFav ? `${coin} is pinned to the top of your markets. Click to unpin.` : `Pin ${coin} to the top of your markets.`}
        onClick={() => toggleFav(coin)}
      >
        <StarGlyph on={isFav} size={16} />
      </button>
      {open && <SymbolSearch id={popId} coin={coin} seed={seed} favs={favs} toggleFav={toggleFav} onClose={close} rootRef={rootRef} />}
    </div>
  );
}

type Tab = "all" | "fav";
const PAGE = 60;

function normalize(q: string): string {
  const s = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const stripped = s.replace(/(USDC|USD|PERP)$/, "");
  return stripped || s;
}

/** exact, then prefix, then contains; with no query the watchlist floats to the top of "all" */
function rank(all: MarketSummary[], q: string, tab: Tab, favs: string[]): MarketSummary[] {
  const base = tab === "fav" ? all.filter((m) => favs.includes(m.coin)) : all;
  const needle = normalize(q);
  if (!needle) return tab === "all" ? [...base.filter((m) => favs.includes(m.coin)), ...base.filter((m) => !favs.includes(m.coin))] : base;
  const scored: { m: MarketSummary; s: number; i: number }[] = [];
  base.forEach((m, i) => {
    const c = m.coin.toUpperCase();
    const s = c === needle ? 0 : c.startsWith(needle) ? 1 : c.includes(needle) ? 2 : -1;
    if (s >= 0) scored.push({ m, s, i });
  });
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.m);
}

function SymbolSearch({ id, coin, seed, favs, toggleFav, onClose, rootRef }: { id: string; coin: string; seed: string; favs: string[]; toggleFav: (c: string) => void; onClose: (refocus: boolean) => void; rootRef: RefObject<HTMLDivElement | null> }) {
  const router = useRouter();
  const markets = useMarkets();
  const [q, setQ] = useState(seed);
  const [tab, setTab] = useState<Tab>("all");
  const [activeCoin, setActiveCoin] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  // the watchlist as it was when this list was framed: starring a row does not yank it to the top under the cursor
  const [favSnap, setFavSnap] = useState(favs);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const centerNext = useRef(true);
  const order = useRef<Map<string, number> | null>(null);
  const listId = `${id}-list`;

  // prices stay live, but the order is frozen while the search is open so rows never reshuffle under the pointer
  const all = useMemo(() => {
    const data = markets.data;
    if (!data) return undefined;
    if (!order.current) order.current = new Map(data.map((m, i) => [m.coin, i]));
    const o = order.current;
    return [...data].sort((a, b) => (o.get(a.coin) ?? 1e9) - (o.get(b.coin) ?? 1e9));
  }, [markets.data]);
  const loaded = all !== undefined;
  const list = useMemo(() => rank(all ?? [], q, tab, favSnap), [all, q, tab, favSnap]);
  const found = activeCoin ? list.findIndex((m) => m.coin === activeCoin) : -1;
  const active = found >= 0 ? found : 0;
  const shown = list.slice(0, Math.max(limit, active + 12));

  // focus lands in the field with the caret after whatever opened it, so typing just carries on
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // a new query or tab reframes the list: start on the current market when it is listed, else the top result
  useEffect(() => {
    setFavSnap(favs);
    const fresh = rank(all ?? [], q, tab, favs);
    setActiveCoin(!q && fresh.some((m) => m.coin === coin) ? coin : (fresh[0]?.coin ?? null));
    setLimit(PAGE);
    centerNext.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, loaded, coin]);

  // keep the active row in view: centred after a reframe, nearest edge while stepping
  useEffect(() => {
    const ul = listRef.current;
    const row = ul?.querySelector<HTMLElement>("[data-active]");
    if (!ul || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (centerNext.current) {
      centerNext.current = false;
      ul.scrollTop = Math.max(0, top - ul.clientHeight / 2 + row.offsetHeight / 2);
    } else if (top < ul.scrollTop) ul.scrollTop = top;
    else if (bottom > ul.scrollTop + ul.clientHeight) ul.scrollTop = bottom - ul.clientHeight;
  }, [active, shown.length]);

  const pick = (c: string) => {
    onClose(false);
    if (c !== coin) router.push(`/m/${c}`);
  };

  const step = (d: number) => {
    if (!list.length) return;
    const n = Math.min(list.length - 1, Math.max(0, active + d));
    setActiveCoin(list[n].coin);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      step(8);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      step(-8);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = list[active];
      if (m) pick(m.coin);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (!q && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      setTab(e.key === "ArrowRight" ? "fav" : "all");
    }
  };

  const activeId = list[active] ? `${listId}-${list[active].coin}` : undefined;

  return (
    <div
      id={id}
      className="pop tm-head-pop"
      role="dialog"
      aria-label="Search markets"
      // keep focus in the search field while the mouse works the list, so the keys keep working
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault();
      }}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) onClose(false);
      }}
    >
      <div className="tm-head-pop-top">
        <label className="input tm-head-pop-field">
          <Icon.search className="tm-head-pop-glass" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Search markets"
            placeholder="Search markets"
            spellCheck={false}
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {q ? (
            <button type="button" className="tm-head-pop-clear" aria-label="Clear search" onClick={() => setQ("")}>
              <Icon.plus className="rotate-45" />
            </button>
          ) : null}
          <span className="kbd">esc</span>
        </label>
        <div className="tm-head-pop-bar">
          <div className="seg" role="group" aria-label="Show">
            <button type="button" className={`seg-item ${tab === "all" ? "seg-active" : ""}`} aria-pressed={tab === "all"} onClick={() => setTab("all")}>
              All markets
              {loaded && <span className="tm-head-pop-n num">{all.length}</span>}
            </button>
            <button type="button" className={`seg-item tm-head-pop-favtab ${tab === "fav" ? "seg-active" : ""}`} aria-pressed={tab === "fav"} onClick={() => setTab("fav")}>
              <StarGlyph on={favs.length > 0} size={12} />
              Watchlist
              {favs.length > 0 && <em className="count">{favs.length}</em>}
            </button>
          </div>
          <span className="tm-head-pop-sort label-caps">{q ? "Best match" : "By 24h volume"}</span>
        </div>
      </div>

      <div className="tm-head-pop-cols label-caps" aria-hidden>
        <span>Market</span>
        <span>Price</span>
        <span>24h</span>
        <span className="tm-head-pop-vol">Volume</span>
      </div>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Markets"
        className="tm-head-pop-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (shown.length < list.length && el.scrollTop + el.clientHeight > el.scrollHeight - 240) setLimit(shown.length + PAGE);
        }}
      >
        {!loaded &&
          Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="tm-head-pop-skel" aria-hidden>
              <span className="skeleton" style={{ opacity: 1 - i * 0.13 }} />
            </li>
          ))}
        {shown.map((m, i) => {
          const fav = favs.includes(m.coin);
          const on = i === active;
          const here = m.coin === coin;
          return (
            <li
              key={m.coin}
              id={`${listId}-${m.coin}`}
              role="option"
              aria-selected={on}
              data-active={on || undefined}
              data-current={here || undefined}
              className="tm-head-row"
              onMouseMove={() => !on && setActiveCoin(m.coin)}
            >
              <button
                type="button"
                tabIndex={-1}
                className="tm-head-row-star"
                data-on={fav || undefined}
                aria-label={fav ? `Remove ${m.coin} from watchlist` : `Add ${m.coin} to watchlist`}
                onClick={() => toggleFav(m.coin)}
              >
                <StarGlyph on={fav} size={13} />
              </button>
              <Link
                href={`/m/${m.coin}`}
                prefetch={false}
                tabIndex={-1}
                className="tm-head-row-link"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  if (here) e.preventDefault();
                  onClose(false);
                }}
              >
                <span className="tm-head-row-mkt">
                  <span className="tm-head-row-ico" style={{ "--tm-head-coin": coinRgb(m.coin) } as CSSProperties}>
                    <CoinIcon coin={m.coin} size={22} />
                  </span>
                  <span className="tm-head-row-name">
                    <b>{m.coin}</b>
                    <small className="mono">{m.maxLeverage}x · perp</small>
                  </span>
                  {here && <span className="tm-head-row-here mono">Viewing</span>}
                </span>
                <span className="num tm-head-row-px">{fmtPrice(m.markPx)}</span>
                <span className="tm-head-row-chg">
                  <span className={`pill num ${m.change24h >= 0 ? "pill-up" : "pill-down"}`}>{pctStr(m.change24h)}</span>
                </span>
                <span className="num tm-head-row-vol tm-head-pop-vol">{usdCompact(m.volume24h)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {loaded && list.length === 0 && (
        <EmptyList>
          {tab === "fav" && !q ? (
            <>
              <span className="tm-head-pop-empty-ico">
                <StarGlyph on={false} size={16} />
              </span>
              <b>Your watchlist is empty</b>
              <span>Star a market to pin it here and at the top of All markets.</span>
            </>
          ) : (
            <>
              <span className="tm-head-pop-empty-ico">
                <Icon.search />
              </span>
              <b>No markets match &ldquo;{q.trim()}&rdquo;</b>
              <span>{tab === "fav" ? "Nothing in your watchlist matches. Try All markets." : "Try a ticker like BTC, ETH or HYPE."}</span>
            </>
          )}
        </EmptyList>
      )}

      <div className="tm-head-pop-foot" aria-hidden>
        <span>
          <span className="kbd">↑</span>
          <span className="kbd">↓</span> navigate
        </span>
        <span>
          <span className="kbd">↵</span> open
        </span>
        <span className="tm-head-pop-foot-tabs">
          <span className="kbd">←</span>
          <span className="kbd">→</span> list
        </span>
        <span>
          <span className="kbd">esc</span> close
        </span>
        <span className="tm-head-pop-foot-n num">{loaded ? `${list.length} ${list.length === 1 ? "market" : "markets"}` : ""}</span>
      </div>
    </div>
  );
}

function EmptyList({ children }: { children: ReactNode }) {
  return <div className="tm-head-pop-empty">{children}</div>;
}
