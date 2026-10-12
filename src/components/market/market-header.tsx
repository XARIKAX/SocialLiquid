"use client";
import "./market-header.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useMarkets } from "@/hooks/use-market";
import type { MarketKind, MarketSummary } from "@/lib/hl-types";
import { CoinIcon, Icon } from "../ui";

/* =====================================================================
   the market header: who you are trading (a lit coin, the market's name,
   max leverage or "Spot", the builder dex, the watchlist star) and the
   numbers that matter for that kind of market, as boxed glass chips.
   the price is the hero: biggest, coloured, it flashes on every tick.
   the selector opens a symbol search over every hyperliquid market:
   perps, spot pairs and builder-dex (hip-3) tradfi ("/", ⌘K, or just
   start typing over the chart).
   layout follows the header's own width (container queries):
   wide = one row, mid = identity + hero over a full-width chip row,
   narrow = identity over one scrolling chip row.
   ===================================================================== */

type LongShort = { ratio: number; longUsd?: number; shortUsd?: number };

const FAVS_KEY = "sl:favs";
const HOUR = 3_600_000;
const CHART = '[aria-roledescription="chart"]';

/* brand light for the coin ring, by base symbol; anything unlisted glows mint */
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
  GOLD: "236 184 64",
  SILVER: "184 192 206",
  NVDA: "118 185 0",
  TSLA: "232 33 39",
};

/* ---------- market identity ---------- */

/** the title hyperliquid shows: BTC-USD for perps, SOL/USDC for spot, BRENTOIL-USD for builder-dex perps */
export function marketTitle(m?: MarketSummary, coin?: string) {
  if (!m) return `${coin ?? ""}-USD`;
  return m.kind === "spot" ? m.name : `${m.name}-USD`;
}

/** an id's kind before its summary has loaded: "@107" is a spot pair, "xyz:GOLD" a builder dex's perp */
function kindOf(coin: string): MarketKind {
  return coin.startsWith("@") ? "spot" : coin.includes(":") ? "hip3" : "perp";
}

/** "xyz:GOLD" → "GOLD" */
function bareName(coin: string): string {
  const i = coin.indexOf(":");
  return i >= 0 ? coin.slice(i + 1) : coin;
}

/** what a person reads for a market: its title, and never a raw spot id ("@107") while the summary loads */
function displayTitle(m: MarketSummary | undefined, coin: string): string | null {
  if (m) return marketTitle(m);
  return coin.startsWith("@") ? null : marketTitle(undefined, bareName(coin));
}

/** a picker row names a market the way hyperliquid's list does (BTC-USDC, SOL/USDC, GOLD-USDC): the base, then the quote */
function rowName(m: MarketSummary): { base: string; quote: string; spot: boolean } {
  if (m.kind === "spot") {
    const i = m.name.indexOf("/");
    return i > 0 ? { base: m.name.slice(0, i), quote: m.name.slice(i), spot: true } : { base: m.name, quote: "", spot: true };
  }
  return { base: m.name, quote: "-USDC", spot: false };
}

/** the line under a market's name: leverage and what it is (the tokens rail says it the same way) */
function kindLine(m: MarketSummary): string {
  if (m.kind === "spot") return "spot";
  if (m.kind === "hip3") return `${m.maxLeverage}x · ${m.category ?? m.dexName ?? m.dex}`;
  return `${m.maxLeverage}x · perp`;
}

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

/** funding as production shows it: the rate in percent, four places */
function fundingStr(f: number): string {
  return `${(f * 100).toFixed(4)}%`;
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

function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** the platform's own name for the picker's shortcut */
const modK = () => (isMacLike() ? "⌘K" : "Ctrl K");

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

/** the watchlist (hyperliquid ids), persisted under sl:favs and kept in sync across tabs */
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
 *  never clipped by the scrolling row. the title is the chip's own label unless data-tip-label names one;
 *  data-tip-kbd lists keys ("|" between them; ⌘ reads as Ctrl off a mac). */
type Tip = { label: string; body: string; kbd?: string[]; x: number; y: number };
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
    const mac = isMacLike();
    shown.current = true;
    setTip({
      label: el.dataset.tipLabel ?? el.querySelector(".chip-label")?.textContent ?? "",
      body: el.dataset.tip ?? "",
      kbd: el.dataset.tipKbd?.split("|").map((k) => (mac ? k : k.replace("⌘", "Ctrl "))),
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
        {tip.kbd && (
          <span className="tm-head-tip-keys">
            {tip.kbd.map((k) => (
              <span key={k} className="kbd">
                {k}
              </span>
            ))}
          </span>
        )}
      </b>
      {tip.body}
    </div>
  ) : null;
  return { rootRef, handlers, node };
}

/**
 * the container queries offer the richest layout the header's width allows; the live numbers decide whether it
 * really fits (a sub-cent price or a long symbol needs more room than BTC). each step down is tried in order
 * until nothing overflows: "nocat" (builder-dex markets) moves the tradfi group from beside the name into the
 * deployed-by chip, "tight" keeps one row but drops the 24h change's absolute move, "rows" is the two-row
 * layout, "stack" the phone layout. the symbol never truncates and the one-row strip never scrolls.
 */
const FIT_STEPS = ["tight", "rows", "stack"] as const;
const FIT_STEPS_HIP3 = ["nocat", ...FIT_STEPS] as const;
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
    for (const step of root.dataset.kind === "hip3" ? FIT_STEPS_HIP3 : FIT_STEPS) {
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

  // the content changing length (a price gaining a digit, another market, another kind's chips): decided before paint
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
  const kind = market?.kind ?? kindOf(coin);
  const spot = kind === "spot";
  const title = displayTitle(market, coin);
  const px = mid ?? market?.markPx;
  const change = market?.change24h;
  const dir: "up" | "down" | undefined = change === undefined ? undefined : change >= 0 ? "up" : "down";
  const abs = market ? market.markPx - market.prevDayPx : null;
  const statsRef = useChipRail<HTMLDivElement>();
  const restRef = useChipRail<HTMLDivElement>();
  const tips = useChipTips();
  useFit(tips.rootRef);

  return (
    <div className="tm-head" data-tm-head data-kind={kind} ref={tips.rootRef} {...tips.handlers}>
      {tips.node}
      <div className="tm-head-cq">
        <div className="tm-head-grid">
          <CoinSelect coin={coin} market={market} kind={kind} title={title} favs={favs} toggleFav={toggleFav} />

          <div className="tm-head-stats" ref={statsRef}>
            <div className="tm-head-hero">
              <MarkChip key={coin} px={px} dir={dir} oracle={spot ? undefined : market?.oraclePx} spot={spot} title={title} />
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

            {/* spot pairs have no oracle, open interest, funding or long / short: those are perp numbers */}
            <div className="tm-head-rest" ref={restRef}>
              {!spot && (
                <div className="chip tm-head-chip tm-head-quiet" data-tip="The validators' index price, sampled from major venues. Funding is anchored to it.">
                  <span className="chip-label">Oracle</span>
                  <span className="chip-value num">{market ? fmtPrice(market.oraclePx) : <Skel w={70} />}</span>
                </div>
              )}
              <div className="chip tm-head-chip" data-tip={market ? `${exactUsd(market.volume24h)} traded in the last 24 hours.` : "Notional traded in the last 24 hours."}>
                <span className="chip-label">24h volume</span>
                <span className="chip-value num">{market ? usdCompact(market.volume24h) : <Skel w={52} />}</span>
              </div>
              {!spot && (
                <div className="chip tm-head-chip" data-tip={market ? `${exactUsd(market.openInterestUsd)} in open positions on this market.` : "Value of all open positions on this market."}>
                  <span className="chip-label">Open interest</span>
                  <span className="chip-value num">{market ? usdCompact(market.openInterestUsd) : <Skel w={60} />}</span>
                </div>
              )}
              {!spot && <FundingChip funding={market?.funding} />}
              {!spot && <LongShortChip ls={longShort} />}
              {kind === "hip3" && <DexChip coin={coin} market={market} />}
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

/** the hero: the live price (mark on perps), coloured by the day, with a soft flash in the direction of every tick */
function MarkChip({ px, dir, oracle, spot, title }: { px?: number; dir?: "up" | "down"; oracle?: number; spot: boolean; title: string | null }) {
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
  const tip = spot
    ? `The live ${title ?? "pair"} price. Spot: you buy the token itself, with no leverage, funding or liquidation.`
    : `The live price your PnL and liquidations are measured against.${basis === null ? "" : Math.abs(basis) < 0.0005 ? " Right on the oracle." : ` ${basis > 0 ? "+" : "-"}${Math.abs(basis).toFixed(3)}% vs the oracle.`}`;
  return (
    <div className="chip tm-head-chip tm-head-mark" data-dir={dir} data-tip={tip}>
      {/* every tick: the chip brightens in its own colour (one hue, so it never muddies), and the arrow
          pops in the tick's colour, which is where up or down is read */}
      {tick && <span key={tick.n} className="tm-head-flash" aria-hidden />}
      <span className="chip-label tm-head-mark-label">
        <span className="tm-head-live live-dot" aria-hidden />
        {spot ? "Price" : "Mark"}
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
        <span className="tm-head-fund-rate">{has ? fundingStr(funding as number) : <Skel w={50} />}</span>
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

/** builder-dex (hip-3) markets: who deployed it, and the tradfi group it trades in */
function DexChip({ coin, market }: { coin: string; market?: MarketSummary }) {
  const dex = market?.dex || coin.slice(0, Math.max(0, coin.indexOf(":")));
  const who = market ? (market.dexName ?? market.dex) : null;
  const cat = market?.category;
  return (
    <div
      className="chip tm-head-chip tm-head-dex"
      data-tip={`${who ?? "A builder"} deployed this perp on its own dex${dex ? ` (${dex})` : ""} under HIP-3${cat ? `, in ${cat}` : ""}. The deployer sets its oracle and leverage limits.`}
    >
      <span className="chip-label">Deployed by</span>
      <span className="chip-value tm-head-dex-row">
        {who ? <span className="tm-head-dex-name">{who}</span> : <Skel w={74} />}
        {cat && <span className="tm-head-dex-cat">{cat}</span>}
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

function coinRgb(base: string): string {
  return COIN_RGB[base] ?? "77 227 193";
}

function CoinRing({ coin, size }: { coin: string; size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  // a server-rendered icon that failed before hydration never told CoinIcon (its onError was not attached yet), so
  // the browser's broken-image glyph would stay: remount it, and its own fallback (the initial) takes over
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const img = ref.current?.querySelector("img");
    if (img && img.complete && img.naturalWidth === 0) setRetry((n) => n + 1);
  }, [coin]);
  return (
    <span ref={ref} className="tm-head-coin" style={{ "--tm-head-coin": coinRgb(coin), width: size, height: size } as CSSProperties}>
      <CoinIcon key={`${coin}:${retry}`} coin={coin} size={size} />
    </span>
  );
}

type Tab = "all" | "perps" | "spot" | "tradfi" | "trending" | "favs";
const TABS: [Tab, string][] = [
  ["all", "All"],
  ["perps", "Perps"],
  ["spot", "Spot"],
  ["tradfi", "Tradfi"],
  ["trending", "Trending"],
  ["favs", "Watchlist"],
];
const TRADFI_SUB = ["All", "Stocks", "Indices", "Commodities", "FX", "Pre-IPO"];
type SortKey = "volume24h" | "change24h" | "funding" | "openInterestUsd" | "markPx";
type Sort = { key: SortKey; dir: 1 | -1 };
/** the picker's view. sort null = the context's own order: 24h volume, best match while searching, biggest move on trending */
type View = { tab: Tab; sub: string; sort: Sort | null };

/** the view, remembered while you hop between markets (the page remounts on every market) */
let lastView: View = { tab: "all", sub: "All", sort: null };
/** a keyboard pick navigates away: where focus lands on the market it opens (the chart if the search came from it) */
let refocusAfterPick: "trigger" | "chart" | null = null;

function CoinSelect({ coin, market, kind, title, favs, toggleFav }: { coin: string; market?: MarketSummary; kind: MarketKind; title: string | null; favs: string[]; toggleFav: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  // what the search opens with: the key that opened it, when it was typed over the chart
  const [seed, setSeed] = useState("");
  const [view, setViewState] = useState<View>(() => lastView);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // where focus goes back to on esc: whatever had it when a key opened the search (the chart, so its keys keep working)
  const returnTo = useRef<HTMLElement | null>(null);
  const popId = useId();
  const isFav = favs.includes(coin);
  const dex = kind === "hip3" ? market?.dex || coin.slice(0, Math.max(0, coin.indexOf(":"))) : "";
  const icon = market?.base ?? (kind === "spot" ? null : bareName(coin));
  const name = title ?? "this market";

  const setView = useCallback((patch: Partial<View>) => setViewState((v) => ({ ...v, ...patch })), []);
  useEffect(() => {
    lastView = view;
  }, [view]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    const back = returnTo.current?.isConnected ? returnTo.current : btnRef.current;
    returnTo.current = null;
    if (refocus) requestAnimationFrame(() => back?.focus({ preventScroll: true }));
  }, []);

  const onPicked = useCallback(() => {
    refocusAfterPick = returnTo.current?.closest(CHART) ? "chart" : "trigger";
  }, []);

  // a new market closes the search, and a keyboard pick that brought us here gets its focus back
  useEffect(() => {
    setOpen(false);
    const to = refocusAfterPick;
    if (!to) return;
    refocusAfterPick = null;
    requestAnimationFrame(() => {
      const chart = to === "chart" ? document.querySelector<HTMLElement>(CHART) : null;
      (chart ?? btnRef.current)?.focus({ preventScroll: true });
    });
  }, [coin]);

  // ⌘K (Ctrl K) toggles the search from anywhere, as on hyperliquid. "/" from anywhere opens it. and, as on
  // tradingview, a letter or digit typed over the chart (or with nothing focused) opens it already searching for
  // that key. never over a modal or a fullscreen chart, and "/" and letters never while typing or with a modifier
  // held (the chart owns shift and alt shortcuts). capture phase: on a market page these keys are the picker's.
  useEffect(() => {
    const mac = isMacLike();
    const remember = (a: Element | null) => {
      returnTo.current = a instanceof HTMLElement && a !== document.body && a !== document.documentElement && !rootRef.current?.contains(a) ? a : null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const root = rootRef.current;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        // ctrl k inside a mac text field is "delete to end of line": that stays the field's
        if (mac && !e.metaKey && isEditable(e.target)) return;
        if (!root || root.offsetParent === null) return;
        if (document.querySelector('[aria-modal="true"]') || document.fullscreenElement) return;
        e.preventDefault();
        if (root.querySelector(".tm-head-pop")) close(true);
        else {
          remember(document.activeElement);
          setSeed("");
          setOpen(true);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const slash = e.key === "/";
      const char = !slash && !e.shiftKey && /^[a-z0-9]$/i.test(e.key) ? e.key : null;
      if (!slash && !char) return;
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      if (document.querySelector('[aria-modal="true"]') || document.fullscreenElement) return;
      if (!root || root.offsetParent === null) return;
      const a = document.activeElement;
      if (char && a && a !== document.body && a !== document.documentElement && !root.contains(a) && !a.closest(CHART)) return;
      // already open with focus on its tabs: the key goes to the field (a letter lands there by itself)
      const field = root.querySelector<HTMLInputElement>(".tm-head-pop input");
      if (field) {
        if (slash) e.preventDefault();
        field.focus();
        return;
      }
      e.preventDefault();
      remember(a);
      setSeed(char ?? "");
      // a symbol typed over the chart is a search of everything, in the best-match order
      if (char) setView({ tab: "all", sub: "All", sort: null });
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, setView]);

  // pointer down anywhere outside closes it
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);

  const lev = market && kind !== "spot" ? `, ${market.maxLeverage}x max leverage` : "";
  const what = kind === "spot" ? "spot pair" : kind === "hip3" ? `perpetual on the ${dex} builder dex${market?.category ? ` (${market.category})` : ""}` : "perpetual";

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
        aria-label={`${title ?? "Market"} ${what}${lev}. Change market`}
        aria-keyshortcuts="/ Meta+K Control+K"
        data-testid="market-select"
        data-tip-label="Search markets"
        data-tip-kbd="/|⌘K"
        data-tip="Every perp, spot pair and tradfi market. Or just start typing over the chart."
      >
        {icon ? <CoinRing coin={icon} size={30} /> : <span className="skeleton tm-head-coin-skel" aria-hidden />}
        <span className="tm-head-sym">{title ?? <Skel w={84} />}</span>
        <span className="tm-head-chev" aria-hidden>
          <Icon.chevron />
        </span>
        <span className="tm-head-tags">
          {kind === "spot" ? <span className="pill pill-neutral tm-head-lev tm-head-spot">Spot</span> : market && <span className="pill pill-brand num tm-head-lev">{market.maxLeverage}x</span>}
          {dex && <span className="pill pill-neutral mono tm-head-dexpill">{dex}</span>}
          {kind === "hip3" && market?.category && <span className="label-caps tm-head-catpill">{market.category}</span>}
        </span>
      </button>
      <button
        type="button"
        className="tm-head-star"
        data-on={isFav || undefined}
        aria-pressed={isFav}
        aria-label={isFav ? `Remove ${name} from watchlist` : `Add ${name} to watchlist`}
        data-tip-label="Watchlist"
        data-tip={isFav ? `${name} is pinned to the top of your markets. Click to unpin.` : `Pin ${name} to the top of your markets.`}
        onClick={() => toggleFav(coin)}
      >
        <StarGlyph on={isFav} size={16} />
      </button>
      {open && <SymbolSearch id={popId} coin={coin} seed={seed} favs={favs} toggleFav={toggleFav} view={view} setView={setView} onClose={close} onPicked={onPicked} rootRef={rootRef} />}
    </div>
  );
}

/* ---------- the market list: production's tabs, search, sorts and trending ---------- */

/** the list's top padding (css) and the rows rendered beyond the visible ones on each side */
const LIST_PAD = 5;
const OVERSCAN = 8;
const TRENDING_MIN_VOL = 100_000;
const TRENDING_MAX = 30;

/** ids compared without case or separators ("BTC-PERP", "xyz:GOLD", "s&p" all work); "/" and "&" still count */
const normId = (s: string) => s.toUpperCase().replace(/[\s\-_:.]+/g, "");

type Indexed = { m: MarketSummary; name: string; base: string; coin: string; keys: string[]; raw: string };

function indexMarkets(data: MarketSummary[]): Indexed[] {
  return data.map((m) => ({
    m,
    name: normId(m.name),
    base: normId(m.base),
    coin: normId(m.coin),
    keys: [m.slug, m.token, m.dex, m.dexName, m.category].filter((s): s is string => !!s).map(normId),
    // production's own match: name, hyperliquid id or category, as typed
    raw: `${m.name}\n${m.coin}\n${m.category ?? ""}`.toLowerCase(),
  }));
}

type Needle = { raw: string; full: string; bare: string };
function needleOf(q: string): Needle {
  const raw = q.trim().toLowerCase();
  const full = normId(raw);
  // "BTCUSD", "btc-perp", "SOL/USDC": also try without the quote
  const bare = full.replace(/\/?(USDC|USD|PERP)$/, "") || full;
  return { raw, full, bare };
}

/** how well a market answers the query, lower is better: its exact name, its base or id, a prefix of those, anywhere
 *  in its name, its dex, token or category; then production's plain substring match. -1 = no match */
function score(x: Indexed, n: Needle): number {
  const { full, bare } = n;
  if (full) {
    if (x.name === full) return 0;
    if (x.name === bare || x.base === full || x.coin === full) return 1;
    if (x.base === bare) return 2;
    if (x.name.startsWith(full) || x.base.startsWith(full) || x.name.startsWith(bare) || x.base.startsWith(bare)) return 3;
    if (x.coin.startsWith(full) || x.keys.some((k) => k.startsWith(full))) return 4;
    if (x.name.includes(bare) || x.base.includes(bare)) return 5;
    if (x.coin.includes(bare) || x.keys.some((k) => k.includes(bare))) return 6;
  }
  return x.raw.includes(n.raw) ? 7 : -1;
}

function inTab(m: MarketSummary, tab: Tab, sub: string, favs: string[]): boolean {
  if (tab === "perps") return m.kind === "perp";
  if (tab === "spot") return m.kind === "spot";
  if (tab === "tradfi") return m.kind === "hip3" && (sub === "All" || m.category === sub);
  if (tab === "favs") return favs.includes(m.coin);
  return true;
}

const byVolume = (a: MarketSummary, b: MarketSummary) => b.volume24h - a.volume24h;
const bySort = (s: Sort) => (a: MarketSummary, b: MarketSummary) => (a[s.key] - b[s.key]) * s.dir;

/**
 * the list, the way production frames it: the tab's markets (tradfi by group, the watchlist), the query, trending as
 * the 30 biggest 24h moves with real volume, then the sort (a column, or the context's own order). the watchlist
 * leads "all" when nothing is typed.
 */
function frameList(idx: Indexed[], q: string, view: View, favs: string[]): MarketSummary[] {
  const { tab, sub, sort } = view;
  const n = needleOf(q);
  const hits: { m: MarketSummary; s: number }[] = [];
  for (const x of idx) {
    if (!inTab(x.m, tab, sub, favs)) continue;
    const s = n.raw ? score(x, n) : 0;
    if (s >= 0) hits.push({ m: x.m, s });
  }
  let out: MarketSummary[];
  if (tab === "trending") {
    out = hits
      .map((h) => h.m)
      .filter((m) => m.volume24h > TRENDING_MIN_VOL)
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, TRENDING_MAX);
    if (sort) out.sort(bySort(sort));
  } else if (sort) out = hits.map((h) => h.m).sort(bySort(sort));
  else if (n.raw) out = hits.sort((a, b) => a.s - b.s || byVolume(a.m, b.m)).map((h) => h.m);
  else out = hits.map((h) => h.m).sort(byVolume);
  if (!n.raw && tab === "all") out = [...out.filter((m) => favs.includes(m.coin)), ...out.filter((m) => !favs.includes(m.coin))];
  return out;
}

const COLS: { key: SortKey; label: string; short?: string; name: string; cls: string }[] = [
  { key: "markPx", label: "Last price", short: "Price", name: "last price", cls: "tm-head-c-px" },
  { key: "change24h", label: "24h change", short: "24h", name: "24h change", cls: "tm-head-c-chg" },
  { key: "funding", label: "8h funding", name: "funding", cls: "tm-head-c-fund" },
  { key: "volume24h", label: "Volume", name: "24h volume", cls: "tm-head-c-vol" },
  { key: "openInterestUsd", label: "Open int.", name: "open interest", cls: "tm-head-c-oi" },
];

function SymbolSearch({
  id,
  coin,
  seed,
  favs,
  toggleFav,
  view,
  setView,
  onClose,
  onPicked,
  rootRef,
}: {
  id: string;
  coin: string;
  seed: string;
  favs: string[];
  toggleFav: (c: string) => void;
  view: View;
  setView: (patch: Partial<View>) => void;
  onClose: (refocus: boolean) => void;
  onPicked: () => void;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const router = useRouter();
  const markets = useMarkets();
  const [q, setQ] = useState(seed);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const tabsRef = useChipRail<HTMLDivElement>();
  const subRef = useChipRail<HTMLDivElement>();
  // the list's geometry (row height from the css, the visible height measured) for the window of rendered rows
  const [box, setBox] = useState({ rowH: 46, viewH: 440 });
  const mac = useMemo(isMacLike, []);
  const listId = `${id}-list`;
  const { tab, sub, sort } = view;
  const searching = q.trim() !== "";

  const data = markets.data;
  const loaded = data !== undefined;
  const idx = useMemo(() => indexMarkets(data ?? []), [data]);
  const byCoin = useMemo(() => new Map((data ?? []).map((m) => [m.coin, m] as const)), [data]);
  const counts = useMemo(() => {
    const c = { all: 0, perps: 0, spot: 0, tradfi: 0, favs: 0 };
    for (const m of data ?? []) {
      c.all++;
      if (m.kind === "perp") c.perps++;
      else if (m.kind === "spot") c.spot++;
      else c.tradfi++;
      if (favs.includes(m.coin)) c.favs++;
    }
    return c;
  }, [data, favs]);

  // a frame: the list ordered for this query, tab, group and sort, then frozen. prices stay live, rows never reshuffle
  // under the pointer on a refresh, and the watchlist is the one the frame was made with (starring a row does not yank
  // it to the top). typing only filters a precomputed index
  const sig = `${q}\n${tab}\n${sub}\n${sort ? `${sort.key}${sort.dir}` : ""}\n${loaded}`;
  const [nav, setNav] = useState<{ sig: string; q: string; favs: string[]; active: string | null; top: number }>({ sig: "", q: seed, favs, active: null, top: 0 });
  const stale = nav.sig !== sig;
  const favSnap = stale ? favs : nav.favs;
  const frame = useMemo(
    () => frameList(idx, q, view, favSnap).map((m) => m.coin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, favSnap],
  );
  const list = useMemo(() => frame.map((c) => byCoin.get(c)).filter((m): m is MarketSummary => m !== undefined), [frame, byCoin]);
  const { rowH, viewH } = box;
  const centerTop = (i: number) => Math.max(0, LIST_PAD + i * rowH - viewH / 2 + rowH / 2);

  // a reframe is decided here, in the render that makes it (never a pass with a stale row or window): a new query starts
  // on the top result (the current market when nothing is typed), a new tab, group or sort keeps the row you were on
  if (stale) {
    const qChanged = nav.q !== q;
    const keep = !qChanged && nav.active !== null && list.some((m) => m.coin === nav.active) ? nav.active : null;
    const next = keep ?? (!searching && list.some((m) => m.coin === coin) ? coin : (list[0]?.coin ?? null));
    setNav({ sig, q, favs, active: next, top: centerTop(next === null ? 0 : Math.max(0, list.findIndex((m) => m.coin === next))) });
  }

  const found = nav.active ? list.findIndex((m) => m.coin === nav.active) : -1;
  const active = found >= 0 ? found : 0;
  // only the rows in view (and a few either side) are in the dom: spacers stand in for the rest, so a long list costs
  // what a short one does and the scrollbar stays true to the whole list
  const top = Math.min(nav.top, Math.max(0, LIST_PAD * 2 + list.length * rowH - viewH));
  const first = Math.max(0, Math.floor((top - LIST_PAD) / rowH) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((top + viewH) / rowH) + OVERSCAN);
  const rows = list.slice(first, last);

  // focus lands in the field with the caret after whatever opened it, so typing just carries on; the panel gets the
  // room below it in the viewport, and the list's geometry is measured
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const fit = () => {
      const pop = popRef.current;
      if (pop) pop.style.setProperty("--tm-head-pop-room", `${Math.max(320, Math.floor(window.innerHeight - pop.getBoundingClientRect().top - 12))}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    const pop = popRef.current;
    const ul = listRef.current;
    let ro: ResizeObserver | undefined;
    if (pop && ul) {
      const measure = () => {
        const rh = parseFloat(getComputedStyle(pop).getPropertyValue("--tm-head-row-h")) || 46;
        const vh = ul.clientHeight || 440;
        setBox((b) => (b.rowH === rh && b.viewH === vh ? b : { rowH: rh, viewH: vh }));
      };
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(ul);
    }
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, []);

  // the first measure that differs from the default geometry re-centres the list framed with it (once: after that the
  // list is where you put it)
  const centred = useRef("46x440");
  useLayoutEffect(() => {
    const key = `${box.rowH}x${box.viewH}`;
    if (centred.current === "done" || centred.current === key) return;
    centred.current = "done";
    setNav((n) => ({ ...n, top: centerTop(active) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  // the window follows the list's own scroll; when the keys or a reframe move it, the list is scrolled to match before paint
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (ul && Math.abs(ul.scrollTop - top) > 1) ul.scrollTop = top;
  }, [top]);

  // the active tab stays in view in the scrolling tab strip
  useEffect(() => {
    const rail = tabsRef.current;
    const b = rail?.querySelector<HTMLElement>(".seg-active");
    if (!rail || !b) return;
    const l = b.offsetLeft - 10;
    const r = b.offsetLeft + b.offsetWidth + 10;
    if (l < rail.scrollLeft) rail.scrollLeft = l;
    else if (r > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = r - rail.clientWidth;
  }, [tab, tabsRef]);

  const hover = useCallback((c: string) => setNav((n) => (n.active === c ? n : { ...n, active: c })), []);

  const go = (m: MarketSummary) => {
    if (m.coin === coin) return onClose(true);
    onPicked();
    onClose(false);
    router.push(`/m/${encodeURIComponent(m.slug)}`);
  };

  const onRowClick = useCallback(
    (e: ReactMouseEvent<HTMLAnchorElement>, m: MarketSummary) => {
      // a new tab or window: the search stays where it is
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (m.coin === coin) e.preventDefault();
      onClose(false);
    },
    [coin, onClose],
  );

  const step = (d: number) => {
    if (!list.length) return;
    const i = Math.min(list.length - 1, Math.max(0, active + d));
    const rowTop = LIST_PAD + i * rowH;
    let t = top;
    if (rowTop < t + LIST_PAD) t = rowTop - LIST_PAD;
    else if (rowTop + rowH > t + viewH - LIST_PAD) t = rowTop + rowH - viewH + LIST_PAD;
    setNav((n) => ({ ...n, active: list[i].coin, top: Math.max(0, t) }));
  };

  const moveTab = (d: number) => {
    const i = TABS.findIndex(([t]) => t === tab);
    const n = Math.min(TABS.length - 1, Math.max(0, i + d));
    if (n !== i) setView({ tab: TABS[n][0] });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
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
      if (m) go(m);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (!q && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      moveTab(e.key === "ArrowRight" ? 1 : -1);
    }
  };

  // the column the list is ordered by: the chosen one, else volume (searching orders by best match, trending by move)
  const sortKey: SortKey | null = sort?.key ?? (!searching && tab !== "trending" ? "volume24h" : null);
  const sortDir = sort?.dir ?? -1;
  const sortBy = (k: SortKey) => setView({ sort: { key: k, dir: sortKey === k ? ((sortDir * -1) as 1 | -1) : -1 } });
  const orderLabel = sort ? `By ${COLS.find((c) => c.key === sort.key)?.name}` : searching ? "Best match" : tab === "trending" ? "Biggest 24h moves" : "By 24h volume";

  const activeId = list[active] && active >= first && active < last ? `${listId}-${list[active].coin}` : undefined;
  const noun = tab === "perps" ? "perps" : tab === "spot" ? "spot pairs" : tab === "tradfi" ? (sub === "All" ? "tradfi markets" : `${sub} markets`) : tab === "trending" ? "trending markets" : "markets";
  const countLabel = loaded ? `${list.length} ${list.length === 1 ? "market" : "markets"}` : "";

  return (
    <div
      ref={popRef}
      id={id}
      className="pop tm-head-pop"
      role="dialog"
      aria-label="Search markets"
      data-testid="market-list"
      // keep focus in the search field while the mouse works the list, so the keys keep working
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault();
      }}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) onClose(false);
      }}
      // esc from anywhere inside (a tab, a column) closes it too
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
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
            placeholder="Search perps, spot and tradfi"
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
          <div className="tm-head-pop-tabs" ref={tabsRef}>
            <div className="seg" role="group" aria-label="Markets to show">
              {TABS.map(([t, l]) => {
                const n = t === "all" ? counts.all : t === "perps" ? counts.perps : t === "spot" ? counts.spot : t === "tradfi" ? counts.tradfi : null;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`seg-item ${t === "favs" ? "tm-head-pop-favtab" : ""} ${tab === t ? "seg-active" : ""}`}
                    aria-pressed={tab === t}
                    aria-label={t === "favs" ? `Watchlist, ${counts.favs}` : undefined}
                    onClick={() => setView({ tab: t })}
                    data-testid={`mtab-${t}`}
                  >
                    {t === "favs" && <StarGlyph on={counts.favs > 0} size={12} />}
                    <span className={t === "favs" ? "tm-head-pop-favword" : undefined}>{l}</span>
                    {loaded && n !== null && <span className="tm-head-pop-n num">{n}</span>}
                    {t === "favs" && counts.favs > 0 && <em className="count">{counts.favs}</em>}
                  </button>
                );
              })}
            </div>
          </div>
          <span className="tm-head-pop-order">
            <span className="label-caps">{orderLabel}</span>
            {sort && (
              <button type="button" className="tm-head-pop-order-reset" aria-label="Back to the default order" title="Default order" onClick={() => setView({ sort: null })}>
                <Icon.plus className="rotate-45" />
              </button>
            )}
          </span>
        </div>
        {tab === "tradfi" && (
          <div className="tm-head-pop-sub" role="group" aria-label="Tradfi group" ref={subRef}>
            {TRADFI_SUB.map((c) => (
              <button key={c} type="button" className="tm-head-pop-subtab" aria-pressed={sub === c} onClick={() => setView({ sub: c })}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tm-head-pop-cols" role="group" aria-label="Sort by">
        <span className="label-caps tm-head-pop-col-mkt">Market</span>
        {COLS.map((c) => {
          const on = sortKey === c.key;
          return (
            <button
              key={c.key}
              type="button"
              className={`label-caps tm-head-pop-th ${c.cls}`}
              aria-pressed={on}
              aria-label={`Sort by ${c.name}${on ? (sortDir < 0 ? ", highest first" : ", lowest first") : ""}`}
              data-dir={on ? (sortDir < 0 ? "down" : "up") : undefined}
              onClick={() => sortBy(c.key)}
            >
              {on && (
                <svg className="tm-head-pop-th-dir" width="7" height="7" viewBox="0 0 8 8" aria-hidden>
                  <path d="M4 7 .6 1.4h6.8z" fill="currentColor" />
                </svg>
              )}
              <span className={c.short ? "tm-head-pop-th-full" : undefined}>{c.label}</span>
              {c.short && <span className="tm-head-pop-th-short">{c.short}</span>}
            </button>
          );
        })}
      </div>

      <div className="tm-head-pop-body">
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Markets"
          className="tm-head-pop-list"
          onScroll={(e) => {
            const t = e.currentTarget.scrollTop;
            setNav((n) => (Math.abs(n.top - t) < 1 ? n : { ...n, top: t }));
          }}
        >
          {!loaded &&
            !markets.isError &&
            Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="tm-head-pop-skel" aria-hidden>
                <span className="skeleton" style={{ opacity: 1 - i * 0.12 }} />
              </li>
            ))}
          {first > 0 && <li className="tm-head-pop-spacer" aria-hidden style={{ height: first * rowH }} />}
          {rows.map((m, k) => (
            <Row key={m.coin} m={m} optionId={`${listId}-${m.coin}`} on={first + k === active} here={m.coin === coin} fav={favs.includes(m.coin)} onHover={hover} onStar={toggleFav} onPick={onRowClick} />
          ))}
          {last < list.length && <li className="tm-head-pop-spacer" aria-hidden style={{ height: (list.length - last) * rowH }} />}
        </ul>

        {!loaded && markets.isError && (
          <EmptyList>
            <span className="tm-head-pop-empty-ico">
              <Icon.search />
            </span>
            <b>Markets did not load</b>
            <span>Retrying in a moment.</span>
          </EmptyList>
        )}
        {loaded && list.length === 0 && (
          <EmptyList>
            {tab === "favs" && !searching ? (
              <>
                <span className="tm-head-pop-empty-ico">
                  <StarGlyph on={false} size={16} />
                </span>
                <b>Your watchlist is empty</b>
                <span>Star a market to pin it here and at the top of All.</span>
              </>
            ) : (
              <>
                <span className="tm-head-pop-empty-ico">
                  <Icon.search />
                </span>
                <b>{searching ? <>No {noun} match &ldquo;{q.trim()}&rdquo;</> : `No ${noun} right now`}</b>
                <span>{searching && tab === "all" ? "Try a ticker like BTC, SOL/USDC or GOLD." : searching ? "Nothing in this list matches." : "Try another list."}</span>
                {tab !== "all" && (
                  <button type="button" className="tm-head-pop-empty-btn" onClick={() => setView({ tab: "all", sub: "All" })}>
                    Search all markets
                  </button>
                )}
              </>
            )}
          </EmptyList>
        )}
        <span className="sr-only" role="status">
          {loaded ? countLabel : "Loading markets"}
        </span>
      </div>

      <div className="tm-head-pop-foot" aria-hidden>
        <span>
          <span className="kbd">↑</span>
          <span className="kbd">↓</span> navigate
        </span>
        <span>
          <span className="kbd">↵</span> select
        </span>
        <span className="tm-head-pop-foot-tabs">
          <span className="kbd">←</span>
          <span className="kbd">→</span> tabs
        </span>
        <span>
          <span className="kbd">esc</span> close
        </span>
        <span className="tm-head-pop-foot-k">
          <span className="kbd">{mac ? "⌘K" : "Ctrl K"}</span> toggle
        </span>
        <span className="tm-head-pop-foot-n num">{countLabel}</span>
      </div>
    </div>
  );
}

/** one market in the list. memoised: typing, hovering or a price refresh re-renders only the rows that changed */
const Row = memo(function Row({
  m,
  optionId,
  on,
  here,
  fav,
  onHover,
  onStar,
  onPick,
}: {
  m: MarketSummary;
  optionId: string;
  on: boolean;
  here: boolean;
  fav: boolean;
  onHover: (coin: string) => void;
  onStar: (coin: string) => void;
  onPick: (e: ReactMouseEvent<HTMLAnchorElement>, m: MarketSummary) => void;
}) {
  const nm = rowName(m);
  const spot = m.kind === "spot";
  const label = `${nm.base}${nm.quote}`;
  return (
    <li
      id={optionId}
      role="option"
      aria-selected={on}
      aria-label={`${label}${m.kind === "hip3" && m.dex ? ` on ${m.dex}` : ""}, ${kindLine(m)}, ${fmtPrice(m.markPx)}, ${pctStr(m.change24h)}${here ? ", viewing" : ""}`}
      data-active={on || undefined}
      data-current={here || undefined}
      className="tm-head-row"
      onMouseMove={on ? undefined : () => onHover(m.coin)}
    >
      <button
        type="button"
        tabIndex={-1}
        className="tm-head-row-star"
        data-on={fav || undefined}
        aria-label={fav ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
        onClick={() => onStar(m.coin)}
      >
        <StarGlyph on={fav} size={13} />
      </button>
      <Link href={`/m/${encodeURIComponent(m.slug)}`} prefetch={false} tabIndex={-1} className="tm-head-row-link" onClick={(e) => onPick(e, m)}>
        <span className="tm-head-row-mkt">
          <span className="tm-head-row-ico" style={{ "--tm-head-coin": coinRgb(m.base) } as CSSProperties}>
            <CoinIcon coin={m.base} size={22} />
          </span>
          <span className="tm-head-row-name">
            <span className="tm-head-row-title">
              <b>
                {nm.base}
                {nm.quote && <span className={nm.spot ? "tm-head-row-qs" : "tm-head-row-q"}>{nm.quote}</span>}
              </b>
              {m.kind === "hip3" && m.dex && <span className="tm-head-row-dex mono">{m.dex}</span>}
            </span>
            <small className="mono">
              {/* kindLine, in parts: a narrow panel moves the dex here and leaves the group to the tradfi tabs */}
              <span className="tm-head-row-meta">
                {m.kind === "hip3" && m.dex && <span className="tm-head-row-mdex">{m.dex} · </span>}
                {spot ? (
                  "spot"
                ) : (
                  <>
                    {m.maxLeverage}x<span className={m.kind === "hip3" ? "tm-head-row-mcat" : undefined}> · {m.kind === "hip3" ? (m.category ?? m.dexName ?? m.dex) : "perp"}</span>
                  </>
                )}
              </span>
              {here && <span className="tm-head-row-here">Viewing</span>}
            </small>
          </span>
        </span>
        <span className="num tm-head-row-px tm-head-c-px">{fmtPrice(m.markPx)}</span>
        <span className="tm-head-row-chg tm-head-c-chg">
          <span className={`pill num ${m.change24h >= 0 ? "pill-up" : "pill-down"}`}>{pctStr(m.change24h)}</span>
        </span>
        <span className="num tm-head-row-fund tm-head-c-fund" data-dir={spot ? undefined : m.funding < 0 ? "down" : "up"}>
          {spot ? "–" : fundingStr(m.funding)}
        </span>
        <span className="num tm-head-row-vol tm-head-c-vol">{usdCompact(m.volume24h)}</span>
        <span className="num tm-head-row-vol tm-head-c-oi">{spot ? "–" : usdCompact(m.openInterestUsd)}</span>
      </Link>
    </li>
  );
});

function EmptyList({ children }: { children: ReactNode }) {
  return <div className="tm-head-pop-empty">{children}</div>;
}
