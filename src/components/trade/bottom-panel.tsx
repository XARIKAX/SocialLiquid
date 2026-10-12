"use client";
import "./bottom-panel.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { livePnl, useMids } from "@/hooks/use-market";
import { useAccountFills, useFundingPayments, useOpenOrders, useOrderHistory, useTwaps, type OpenOrder } from "@/hooks/use-account";
import { api } from "@/lib/client";
import { fmtDuration, fmtUsd, timeAgo } from "@/lib/format";
import type { FeedItem } from "@/lib/queries";
import { CoinIcon, Empty, Toggle } from "../ui";
import {
  BpConnect,
  BpEmpty,
  BpIcon,
  BpMoney,
  BpPnl,
  BpSkelRows,
  BpStamp,
  PositionsTable,
  bpPx,
  fillPill,
  fmtPnl,
  fmtSignedPct,
  roveTabs,
  type BpIconName,
  type MarketPosition,
  type MarketTrade,
  type TradersView,
} from "../market/positions-table";
import { openFunds } from "./funds";

type Tab = "traders" | "thesis" | "balances" | "positions" | "orders" | "twap" | "trades" | "funding" | "history";
type AccountTab = Exclude<Tab, "traders" | "thesis">;
const TABS: [Tab, string][] = [
  ["traders", "Traders"],
  ["thesis", "Thesis"],
  ["balances", "Balances"],
  ["positions", "Positions"],
  ["orders", "Open Orders"],
  ["twap", "TWAP"],
  ["trades", "Trade History"],
  ["funding", "Funding History"],
  ["history", "Order History"],
];
const IDS = TABS.map(([t]) => t);
const isMarket = (t: Tab) => t === "traders" || t === "thesis";

/* ui preferences (never anything that reaches hyperliquid) */
const TAB_KEY = "sl:bp-tab";
const VIEW_KEY = "sl:bp-view";
const H_KEY = "sl:bp-h";
const H_MIN = 220;
const H_DEFAULT = 392;
const hMax = () => Math.max(H_MIN + 80, Math.round(window.innerHeight * 0.85));
const store = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

/* what each account tab says when you are signed out, and when it is empty */
const ACCOUNT: Record<AccountTab, { icon: BpIconName; out: [string, string]; none: [string, string] }> = {
  balances: { icon: "wallet", out: ["Connect to see your balances", "USDC, available margin and unrealised PnL on Hyperliquid, updated live."], none: ["", ""] },
  positions: { icon: "layers", out: ["Connect to see your positions", "Live PnL, liquidation price, TP/SL and a one-click close for everything you hold."], none: ["No open positions", "Open one from the order ticket. It shows up here with live PnL and a one-click close."] },
  orders: { icon: "list", out: ["Connect to see your open orders", "Resting limit, stop and take-profit orders, each cancellable from here."], none: ["No open orders", "Limit, stop and take-profit orders rest here until they fill or you cancel them."] },
  twap: { icon: "bars", out: ["Connect to see your TWAP orders", "Progress, average fill and time left for every running TWAP."], none: ["No TWAP orders", "Split a large order over time with TWAP, under Pro in the order ticket."] },
  trades: { icon: "receipt", out: ["Connect to see your trade history", "Every fill with its fees and closed PnL, exportable to CSV."], none: ["No fills yet", "Your executions land here with their fees and closed PnL."] },
  funding: { icon: "percent", out: ["Connect to see your funding", "Funding paid and received on your positions, settled every hour."], none: ["No funding payments yet", "Funding settles every hour on open positions."] },
  history: { icon: "history", out: ["Connect to see your order history", "Every order you placed and how it ended: filled, canceled or rejected."], none: ["No orders yet", "Orders you place show up here with their final status."] },
};

export function BottomPanel(props: {
  coin: string;
  positions?: MarketPosition[];
  trades?: MarketTrade[];
  theses?: FeedItem[];
  mid?: number;
  loading: boolean;
  thesisOnly: boolean;
  following: boolean;
  setThesisOnly: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
}) {
  const [tab, setTabState] = useState<Tab>("traders");
  const [view, setView] = useState<"positions" | "trades">("positions");
  const [onlyCoin, setOnlyCoin] = useState(false);
  const [h, setH] = useState<number | null>(null);
  const { signedIn, address } = useAuth();
  const openOrders = useOpenOrders();
  // same query keys the market view already polls: no new requests
  const bal = useBalance(signedIn ? address : null);
  const mids = useMids();
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const { wrap, strip, nudge } = useStrip();

  /* the grip reports the deck's real height (its default follows the viewport). written straight onto the
     separator: a drag resizes the deck every frame, and none of that should re-render the tables */
  useEffect(() => {
    const el = bodyRef.current;
    const grip = gripRef.current;
    if (!el || !grip) return;
    const sync = () => {
      grip.setAttribute("aria-valuenow", String(Math.round(el.getBoundingClientRect().height)));
      grip.setAttribute("aria-valuemax", String(hMax()));
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  /* restore the last tab, traders view and deck height */
  useEffect(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      if (t && IDS.includes(t)) setTabState(t);
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "positions" || v === "trades") setView(v);
      const hh = Number(localStorage.getItem(H_KEY));
      if (hh >= H_MIN && hh <= 4000) setH(hh);
    } catch {}
  }, []);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    store(TAB_KEY, t);
  }, []);
  /* the top Traders / Thesis tabs and the view switch inside them stay in step */
  const traderTab: TradersView = tab === "thesis" ? "thesis" : view;
  const onTraderTab = (t: TradersView) => {
    if (t === "thesis") return setTab("thesis");
    setView(t);
    store(VIEW_KEY, t);
    setTab("traders");
  };

  /* keep the open tab inside the strip, clear of the fades (the strip itself re-reveals it when it narrows) */
  useEffect(() => {
    if (strip.current) revealTab(strip.current, "smooth");
  }, [tab, strip]);

  const own = useMemo(() => (bal.data?.positions ?? []).filter((p) => p.szi !== 0), [bal.data]);
  /* "following" needs a wallet: until then the traders view asks to connect, so the head shows no traders figures */
  const marketShown = !(props.following && !signedIn);
  const counts: Partial<Record<Tab, number>> = {
    traders: marketShown ? props.positions?.length ?? 0 : 0,
    thesis: props.theses?.length ?? 0,
    positions: signedIn ? own.length : 0,
    orders: signedIn ? openOrders.data?.length ?? 0 : 0,
  };

  /* the number that matters for the open view: the market's traders, or your own book */
  const tradersUpnl = useMemo(() => (props.positions?.length ? props.positions.reduce((a, p) => a + (livePnl(p, props.mid) ?? p.unrealisedPnl), 0) : null), [props.positions, props.mid]);
  const ownUpnl = useMemo(() => {
    if (!own.length) return null;
    return own.reduce((a, p) => {
      const m = mids.data?.[p.coin] ? Number(mids.data[p.coin]) : undefined;
      return a + (livePnl({ side: p.szi > 0 ? "LONG" : "SHORT", size: Math.abs(p.szi), entryPx: p.entryPx }, m) ?? p.unrealizedPnl);
    }, 0);
  }, [own, mids.data]);
  const sum = isMarket(tab)
    ? tradersUpnl !== null && marketShown
      ? { label: "uPnL", v: tradersUpnl, title: `Unrealised PnL across the ${props.positions?.length} open ${props.coin} positions of tracked traders` }
      : null
    : signedIn && ownUpnl !== null
      ? { label: "uPnL", own: true, v: ownUpnl, title: "Unrealised PnL across your open positions" }
      : null;

  /* ---------- deck height: drag the foot, arrows when focused, double-click to reset ---------- */
  const commitH = useCallback((v: number | null) => {
    setH(v);
    if (v === null) rootRef.current?.style.removeProperty("--tm-bp-h");
    store(H_KEY, v === null ? null : String(v));
  }, []);
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    const root = rootRef.current;
    if (e.button !== 0 || !body || !root) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const y0 = e.clientY;
    const h0 = body.getBoundingClientRect().height;
    const max = hMax();
    let last = Math.round(h0);
    grip.setPointerCapture(e.pointerId);
    grip.setAttribute("data-drag", "");
    root.setAttribute("data-resizing", "");
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(max, Math.max(H_MIN, h0 + ev.clientY - y0)));
      root.style.setProperty("--tm-bp-h", `${last}px`);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      grip.removeAttribute("data-drag");
      root.removeAttribute("data-resizing");
      commitH(last);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };
  const onGripKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cur = h ?? Math.round(bodyRef.current?.getBoundingClientRect().height ?? H_DEFAULT);
    const max = hMax();
    const step = e.key === "ArrowUp" ? -24 : e.key === "ArrowDown" ? 24 : e.key === "PageUp" ? -96 : e.key === "PageDown" ? 96 : 0;
    if (step) commitH(Math.min(max, Math.max(H_MIN, cur + step)));
    else if (e.key === "Home") commitH(H_MIN);
    else if (e.key === "End") commitH(max);
    else if (e.key === "Enter") commitH(null);
    else return;
    e.preventDefault();
  };

  const only = props.coin ? <Toggle on={onlyCoin} onChange={setOnlyCoin} label={`Only ${props.coin}`} /> : null;
  const acct = isMarket(tab) ? null : ACCOUNT[tab as AccountTab];

  return (
    <div className="tm-bp" ref={rootRef} style={h ? ({ "--tm-bp-h": `${h}px` } as CSSProperties) : undefined}>
      <div className="tm-bp-head">
        <div className="tm-bp-strip" ref={wrap}>
          <button type="button" className="tm-bp-nudge tm-bp-nudge-l" tabIndex={-1} aria-hidden onClick={() => nudge(-1)}>
            <BpIcon n="chevL" size={12} sw={2.4} />
          </button>
          <div className="tm-bp-tabs" ref={strip} role="tablist" aria-label="Terminal panels" onKeyDown={(e) => roveTabs(e, IDS, tab, setTab)}>
            {TABS.map(([t, label]) => (
              <Fragment key={t}>
                {t === "balances" && <span className="tm-bp-vsep" aria-hidden />}
                <button
                  type="button"
                  role="tab"
                  data-id={t}
                  id={`tm-bp-tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls="tm-bp-panel"
                  tabIndex={tab === t ? 0 : -1}
                  className="tm-bp-tab"
                  onClick={() => setTab(t)}
                >
                  {label}
                  {!!counts[t] && <i className={`num ${tab === t ? "count" : t === "positions" || t === "orders" ? "tm-bp-q tm-bp-q-live" : "tm-bp-q"}`}>{counts[t]}</i>}
                </button>
              </Fragment>
            ))}
          </div>
          <button type="button" className="tm-bp-nudge tm-bp-nudge-r" tabIndex={-1} aria-hidden onClick={() => nudge(1)}>
            <BpIcon n="chevR" size={12} sw={2.4} />
          </button>
        </div>
        {sum && (
          <span className="tm-bp-sum" title={sum.title}>
            <span className="tm-bp-live live-dot" aria-hidden />
            <span className="tm-bp-sum-l">
              {"own" in sum && <span className="tm-bp-fold">Your </span>}
              {sum.label}
            </span>
            <b className={`num tm-bp-glow ${sum.v > 0 ? "tm-bp-up" : sum.v < 0 ? "tm-bp-down" : "tm-bp-flat"}`}>{fmtPnl(sum.v, true)}</b>
          </span>
        )}
      </div>

      <div className="tm-bp-body" ref={bodyRef} role="tabpanel" id="tm-bp-panel" aria-labelledby={`tm-bp-tab-${tab}`}>
        {isMarket(tab) ? (
          <PositionsTable
            coin={props.coin}
            positions={props.positions}
            trades={props.trades}
            theses={props.theses}
            mid={props.mid}
            loading={props.loading}
            thesisOnly={props.thesisOnly}
            following={props.following}
            setThesisOnly={props.setThesisOnly}
            setFollowing={props.setFollowing}
            tab={traderTab}
            onTabChange={onTraderTab}
          />
        ) : !signedIn && acct ? (
          <div className="tm-bp-view">
            <BpEmpty icon={<BpIcon n={acct.icon} />} title={acct.out[0]} hint={acct.out[1]} action={<BpConnect />} />
          </div>
        ) : tab === "balances" ? (
          <Balances upnl={ownUpnl} />
        ) : tab === "positions" ? (
          <OwnPositions coin={props.coin} onlyCoin={onlyCoin} only={only} />
        ) : tab === "orders" ? (
          <OpenOrders coin={props.coin} onlyCoin={onlyCoin} only={only} />
        ) : tab === "twap" ? (
          <Twaps coin={props.coin} onlyCoin={onlyCoin} only={only} />
        ) : tab === "trades" ? (
          <TradeHistory coin={props.coin} onlyCoin={onlyCoin} only={only} />
        ) : tab === "funding" ? (
          <FundingHistory coin={props.coin} onlyCoin={onlyCoin} only={only} />
        ) : (
          <OrderHistory coin={props.coin} onlyCoin={onlyCoin} only={only} />
        )}
      </div>

      <div
        ref={gripRef}
        className="tm-bp-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the panel"
        aria-valuemin={H_MIN}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onGripDown}
        onDoubleClick={() => commitH(null)}
        onKeyDown={onGripKey}
      />
    </div>
  );
}

/* ---------- the tab strip: fades on the edges that still scroll, wheel and drag to scroll ---------- */

/** scroll the open tab inside the strip, just past the fade's clear zone and ramp so it sits at full ink */
function revealTab(s: HTMLElement, behavior: ScrollBehavior) {
  const el = s.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!el) return;
  // on a strip too narrow for the full margin both sides, centre what fits
  const pad = Math.max(0, Math.min(80, (s.clientWidth - el.offsetWidth) / 2));
  const left = el.offsetLeft;
  const right = left + el.offsetWidth;
  if (left < s.scrollLeft + pad) s.scrollTo({ left: Math.max(0, left - pad), behavior });
  else if (right > s.scrollLeft + s.clientWidth - pad) s.scrollTo({ left: right - s.clientWidth + pad, behavior });
}

function useStrip() {
  const wrap = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const w = wrap.current;
    if (!el || !w) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      w.toggleAttribute("data-scrollable", max > 1);
      w.toggleAttribute("data-fade-l", max > 1 && el.scrollLeft > 1);
      w.toggleAttribute("data-fade-r", max > 1 && el.scrollLeft < max - 1);
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
        w.setAttribute("data-dragging", "");
      }
      el.scrollLeft = drag.left - dx;
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) {
        w.removeAttribute("data-dragging");
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
    // when the strip itself narrows (the summary appears once figures load, the window shrinks) the open tab can
    // slide under the fade: bring it back at once. a tab merely changing width (a count) never moves the strip
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      update();
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        revealTab(el, "auto");
      }
    });
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
  const nudge = (d: 1 | -1) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: d * Math.max(140, el.clientWidth * 0.6), behavior: "smooth" });
  };
  return { wrap, strip, nudge };
}

/* ---------- helpers ---------- */
function csv(rows: Record<string, unknown>[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const body = [keys.join(","), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  // the download has its own copy by then; release the blob
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** exact sizes for your own account (no rounding away a contract's last digit) */
const sz = (v: number) => Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 8 });

/** the control bar over a table: mini stats on the left (left out until there are rows: a line of zeros, loading or empty, is noise), controls on the right */
function Bar({ children, end, empty }: { children?: ReactNode; end?: ReactNode; empty?: boolean }) {
  return (
    <div className="tm-bp-bar">
      <div className="tm-bp-stats">{!empty && children}</div>
      {end && <div className="tm-bp-bar-end">{end}</div>}
    </div>
  );
}

function Stat({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <span className="tm-bp-stat" title={title}>
      <span className="label-caps">{label}</span>
      <b className="num">{children}</b>
    </span>
  );
}

function CsvButton({ rows, name }: { rows: object[]; name: string }) {
  return (
    <button type="button" className="tm-bp-icon-btn" onClick={() => csv(rows as Record<string, unknown>[], name)} disabled={!rows.length} title="Export as CSV" aria-label="Export as CSV">
      <BpIcon n="download" size={14} sw={1.9} />
      CSV
    </button>
  );
}

/**
 * the coin with its side pill on one line and an optional mono sub line (a size) under it.
 * on a narrow deck the columns that drop out fold into the sub line (`nsub`), and `fold` moves the pill there too.
 */
function CoinCell({ coin, pill, sub, nsub, fold }: { coin: string; pill?: ReactNode; sub?: ReactNode; nsub?: ReactNode; fold?: boolean }) {
  const hasSub = sub !== undefined && sub !== null && sub !== false && sub !== "";
  return (
    <span className="tm-bp-coin">
      <span className="tm-bp-coin-ic">
        <CoinIcon coin={coin} size={20} />
      </span>
      <span className="tm-bp-2">
        <span className="tm-bp-coin-row">
          {coin}
          {pill && (fold ? <span className="tm-bp-fold">{pill}</span> : pill)}
        </span>
        {(hasSub || nsub) && (
          <span className={`tm-bp-sub num ${hasSub ? "" : "tm-bp-nsub-line"}`}>
            {nsub && (
              <span className="tm-bp-nsub">
                {nsub}
                {hasSub ? " · " : ""}
              </span>
            )}
            {hasSub && sub}
          </span>
        )}
      </span>
    </span>
  );
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
/** an order type short enough for a folded sub line: "Take Profit Market" -> "TP market" */
const shortType = (t: string) => t.replace(/^Take Profit/i, "TP").replace(/ (Market|Limit)$/i, (m) => m.toLowerCase());

function SidePill({ buy, label }: { buy: boolean; label?: string }) {
  return <span className={`pill num ${buy ? "pill-up" : "pill-down"}`}>{label ?? (buy ? "Long" : "Short")}</span>;
}

/** a value over a mono sub line, right or left aligned by the cell */
function Two({ main, sub, mainClass = "" }: { main: ReactNode; sub?: ReactNode; mainClass?: string }) {
  return (
    <span className="tm-bp-2">
      <span className={`num ${mainClass}`}>{main}</span>
      {sub !== undefined && sub !== null && sub !== false && sub !== "" && <span className="tm-bp-sub num">{sub}</span>}
    </span>
  );
}

function Track({ v, tone }: { v: number; tone?: "warn" | "down" }) {
  return (
    <span className="tm-bp-track" aria-hidden>
      <span className="tm-bp-fill" data-tone={tone} style={{ "--p": `${Math.max(0, Math.min(1, v)) * 100}%` } as CSSProperties} />
    </span>
  );
}

function statusPill(s: string): { label: string; cls: string } {
  const words = s.replace(/([A-Z])/g, " $1").toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  const cls = s === "filled" ? "pill-up" : s === "open" || s === "triggered" ? "pill-brand" : s === "canceled" ? "pill-neutral" : /reject/i.test(s) ? "pill-down" : /cancel/i.test(s) ? "pill-warn" : "pill-neutral";
  return { label, cls };
}

const flags = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" · ");

/** a duration in whole minutes, the same way on both sides of a slash: "12m", "1h", "1h 30m" */
const mins = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
};

/** which destructive action is waiting for its second click (by key); the fuse, blur or Escape disarm it */
function useArmed(ms = 4000) {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return [armed, setArmed] as const;
}

/**
 * a destructive action in two clicks: the first arms it (lit like the down cta, a fuse burning down under the
 * label), the second fires. its labels share one grid cell, so arming never changes its width or shifts a column.
 */
function ConfirmButton({
  armed,
  busy,
  disabled,
  onArm,
  onDisarm,
  onFire,
  label,
  busyLabel,
  ariaLabel,
  armedLabel,
  icon,
}: {
  armed: boolean;
  busy: boolean;
  disabled?: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onFire: () => void;
  label: string;
  busyLabel: string;
  ariaLabel: string;
  armedLabel: string;
  icon?: ReactNode;
}) {
  const state = busy ? "busy" : armed ? "armed" : "idle";
  return (
    <button
      type="button"
      className="tm-bp-act tm-bp-act-down"
      data-armed={(armed && !busy) || undefined}
      disabled={busy || disabled}
      aria-label={armed ? armedLabel : ariaLabel}
      title={armed ? "Click again to confirm" : undefined}
      onClick={() => (armed ? onFire() : onArm())}
      onBlur={() => armed && onDisarm()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && armed) {
          e.stopPropagation();
          onDisarm();
        }
      }}
    >
      {icon}
      <span className="tm-bp-stack" aria-hidden>
        <span data-on={state === "idle" || undefined}>{label}</span>
        <span data-on={state === "armed" || undefined}>Confirm</span>
        <span data-on={state === "busy" || undefined}>{busyLabel}</span>
      </span>
    </button>
  );
}

function AcctEmpty({ tab, onlyCoin, coin }: { tab: AccountTab; onlyCoin: boolean; coin: string }) {
  const a = ACCOUNT[tab];
  return <BpEmpty icon={<BpIcon n={a.icon} />} tone="neutral" title={`${a.none[0]}${onlyCoin ? ` on ${coin}` : ""}`} hint={a.none[1]} />;
}

/* ---------- balances ---------- */
/** `upnl` is the head's live figure (marked to the mids), so the two never disagree by a tick */
function Balances({ upnl: live }: { upnl: number | null }) {
  const { address } = useAuth();
  const bal = useBalance(address);
  const b = bal.data;
  const upnl = live ?? b?.positions.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
  const usage = b && b.accountValue > 0 ? Math.min(1, b.marginUsed / b.accountValue) : 0;
  return (
    <div className="tm-bp-view">
      <Bar
        end={
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openFunds("deposit")}>
              Deposit
            </button>
            <button type="button" className="btn btn-sm" onClick={() => openFunds("withdraw")}>
              Withdraw
            </button>
          </>
        }
      >
        <Stat label="Account">{b ? fmtUsd(b.accountValue) : "…"}</Stat>
        <span className="tm-bp-stat tm-bp-stat-meter" title="Margin in use as a share of account value">
          <span className="label-caps">Margin use</span>
          <Track v={usage} tone={usage >= 0.8 ? "down" : usage >= 0.5 ? "warn" : undefined} />
          <b className="num">{b ? `${(usage * 100).toFixed(1)}%` : "…"}</b>
        </span>
      </Bar>
      <div className="tm-bp-scroll">
        <table className="tm-bp-table tm-bp-w-bal">
          <thead>
            <tr>
              <th>Asset</th>
              <th className="r tm-bp-h540">Total balance</th>
              <th className="r">Available</th>
              <th className="r tm-bp-h540">Margin used</th>
              <th className="r">
                <span className="tm-bp-fold">Unrealised PnL</span>
                <span className="tm-bp-nsub">uPnL</span>
              </th>
              <th className="r tm-bp-h640">Contract</th>
            </tr>
          </thead>
          <tbody>
            {bal.isLoading ? (
              <BpSkelRows cells={["", "r tm-bp-h540", "r", "r tm-bp-h540", "r", "r tm-bp-h640"]} rows={1} />
            ) : (
              <tr className="row-hover">
                <td>
                  <span className="tm-bp-coin">
                    <span className="tm-bp-coin-ic">
                      <span className="tm-bp-usdc">$</span>
                    </span>
                    USDC
                  </span>
                </td>
                <td className="r num tm-bp-strong tm-bp-h540">{b ? fmtUsd(b.accountValue) : "–"}</td>
                <td className="r num">{b ? fmtUsd(b.withdrawable) : "–"}</td>
                <td className="r num tm-bp-fg2 tm-bp-h540">{b ? fmtUsd(b.marginUsed) : "–"}</td>
                <td className="r">
                  <BpMoney v={b ? upnl : null} glow dash={false} />
                </td>
                <td className="r tm-bp-dim tm-bp-h640">Perps</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- own positions ---------- */
type Edit = { coin: string; tp: string; sl: string; long: boolean; entry: number; mark?: number };

/** how close the mark is to liquidation: under 3% the price lights up and a red dot breathes beside it */
const LIQ_NEAR = 0.03;

function OwnPositions({ coin, onlyCoin, only }: { coin: string; onlyCoin: boolean; only: ReactNode }) {
  const { address } = useAuth();
  const bal = useBalance(address);
  const mids = useMids();
  const qc = useQueryClient();
  const orders = useOpenOrders();
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useArmed();
  const [edit, setEdit] = useState<Edit | null>(null);
  /* the tp / sl button that opened the editor gets the focus back when it closes */
  const editFrom = useRef<HTMLElement | null>(null);
  const closeEditor = useCallback(() => {
    setEdit(null);
    const el = editFrom.current;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, []);
  const list = (bal.data?.positions ?? []).filter((p) => p.szi !== 0 && (!onlyCoin || p.coin === coin));
  const close = async (c: string) => {
    setBusy(c);
    try {
      await api("/api/trade/close", { method: "POST", json: { coin: c } });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(null);
    }
  };
  const saveTpsl = async () => {
    if (!edit) return;
    setBusy(edit.coin);
    try {
      await api("/api/trade/tpsl", { method: "POST", json: { coin: edit.coin, tp: Number(edit.tp) || undefined, sl: Number(edit.sl) || undefined } });
      qc.invalidateQueries({ queryKey: ["account"] });
      closeEditor();
    } finally {
      setBusy(null);
    }
  };

  const rows = list.map((p) => {
    const mid = mids.data?.[p.coin] ? Number(mids.data[p.coin]) : undefined;
    const pnl = livePnl({ side: p.szi > 0 ? "LONG" : "SHORT", size: Math.abs(p.szi), entryPx: p.entryPx }, mid) ?? p.unrealizedPnl;
    const roe = p.positionValue ? (pnl * p.leverage) / p.positionValue : 0;
    const tpsl = (orders.data ?? []).filter((o) => o.coin === p.coin && o.isTrigger && o.reduceOnly);
    const tp = tpsl.find((o) => o.type.toLowerCase().includes("take"));
    const sl = tpsl.find((o) => o.type.toLowerCase().includes("stop"));
    return { p, mid, pnl, roe, tp, sl };
  });
  const value = list.reduce((a, p) => a + p.positionValue, 0);
  const margin = list.reduce((a, p) => a + p.positionValue / p.leverage, 0);
  const empty = !bal.isLoading && list.length === 0;
  /* the editor follows the live mark, not the one it opened with */
  const editMark = edit ? (mids.data?.[edit.coin] ? Number(mids.data[edit.coin]) : edit.mark) : undefined;

  return (
    <div className="tm-bp-view">
      <Bar end={only} empty={!list.length}>
        <Stat label="Open">{list.length}</Stat>
        <Stat label="Value">{fmtUsd(value)}</Stat>
        <Stat label="Margin">{fmtUsd(margin)}</Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {empty ? (
          <AcctEmpty tab="positions" onlyCoin={onlyCoin} coin={coin} />
        ) : (
          <table className="tm-bp-table tm-bp-w-pos">
            <thead>
              <tr>
                <th>Position</th>
                <th className="r tm-bp-h900">Value</th>
                <th className="r tm-bp-h540">Entry · Mark</th>
                <th className="r">
                  PnL<span className="tm-bp-fold"> (ROE)</span>
                </th>
                <th className="r tm-bp-h540">Liq. price</th>
                <th className="r tm-bp-h1000">Margin</th>
                <th className="r tm-bp-c-act">
                  <span className="tm-bp-fold">TP / SL · Close</span>
                  <span className="tm-bp-nsub sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bal.isLoading ? (
                <BpSkelRows cells={["", "r tm-bp-h900", "r tm-bp-h540", "r", "r tm-bp-h540", "r tm-bp-h1000", "r tm-bp-c-act"]} rows={3} />
              ) : (
                rows.map(({ p, mid, pnl, roe, tp, sl }) => {
                  const long = p.szi > 0;
                  const dist = mid && p.liquidationPx ? Math.abs(mid - p.liquidationPx) / mid : null;
                  const near = dist !== null && dist < LIQ_NEAR;
                  return (
                    <tr key={p.coin} className="row-hover" data-side={long ? "long" : "short"} data-editing={edit?.coin === p.coin || undefined}>
                      <td>
                        <CoinCell
                          coin={p.coin}
                          pill={<SidePill buy={long} label={`${long ? "Long" : "Short"} ${p.leverage}x`} />}
                          fold
                          nsub={<span className={long ? "tm-bp-up" : "tm-bp-down"}>{`${long ? "Long" : "Short"} ${p.leverage}x`}</span>}
                          sub={
                            <>
                              {sz(p.szi)}
                              <span className="tm-bp-fold"> {p.coin}</span>
                            </>
                          }
                        />
                      </td>
                      <td className="r num tm-bp-val tm-bp-h900">{fmtUsd(p.positionValue)}</td>
                      <td className="r tm-bp-h540">
                        <Two main={bpPx(p.entryPx)} mainClass="tm-bp-fg2" sub={`mark ${bpPx(mid)}`} />
                      </td>
                      <td className="r">
                        <BpPnl v={pnl} roe={roe} />
                      </td>
                      <td className="r tm-bp-h540">
                        {p.liquidationPx ? (
                          <span className="tm-bp-liq" data-near={near || undefined} title={near ? "The mark is close to this position's liquidation price" : "Liquidation price and its distance from the mark"}>
                            {near && <span className="tm-bp-riskdot live-dot" aria-hidden />}
                            <Two main={bpPx(p.liquidationPx)} mainClass="tm-bp-warn" sub={dist !== null ? `${(dist * 100).toFixed(1)}% away` : null} />
                          </span>
                        ) : (
                          <span className="tm-bp-dim">–</span>
                        )}
                      </td>
                      <td className="r num tm-bp-fg2 tm-bp-h1000">{fmtUsd(p.positionValue / p.leverage)}</td>
                      <td className="r tm-bp-c-act">
                        <span className="tm-bp-acts">
                          <button
                            type="button"
                            className="tm-bp-tpsl"
                            data-on={edit?.coin === p.coin || undefined}
                            aria-label={`Edit take profit and stop loss for ${p.coin}`}
                            aria-expanded={edit?.coin === p.coin}
                            title="Edit TP / SL"
                            onClick={(e) => {
                              editFrom.current = e.currentTarget;
                              setEdit({ coin: p.coin, tp: tp ? String(tp.triggerPx) : "", sl: sl ? String(sl.triggerPx) : "", long, entry: p.entryPx, mark: mid });
                            }}
                          >
                            {tp || sl ? (
                              <span className="tm-bp-2 tm-bp-tpsl-v">
                                <span className="num">
                                  <i>TP</i> <span className={tp ? "tm-bp-up" : "tm-bp-dim"}>{tp ? bpPx(tp.triggerPx) : "–"}</span>
                                </span>
                                <span className="num">
                                  <i>SL</i> <span className={sl ? "tm-bp-down" : "tm-bp-dim"}>{sl ? bpPx(sl.triggerPx) : "–"}</span>
                                </span>
                              </span>
                            ) : (
                              <span className="tm-bp-tpsl-l">TP / SL</span>
                            )}
                            <BpIcon n="pencil" size={12} sw={2} />
                          </button>
                          <ConfirmButton
                            armed={armed === p.coin}
                            busy={busy === p.coin}
                            onArm={() => setArmed(p.coin)}
                            onDisarm={() => setArmed(null)}
                            onFire={() => {
                              setArmed(null);
                              void close(p.coin);
                            }}
                            label="Close"
                            busyLabel="Closing…"
                            ariaLabel={`Close the ${p.coin} position at market`}
                            armedLabel={`Confirm: close the ${p.coin} position at market`}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
      {edit && <TpslEditor edit={{ ...edit, mark: editMark }} setEdit={setEdit} onClose={closeEditor} onSave={saveTpsl} busy={busy === edit.coin} />}
    </div>
  );
}

/** a trigger's distance from the mark, signed: "+3.80%" */
function TriggerPct({ v, mark, warn }: { v: number; mark?: number; warn?: boolean }) {
  if (!v || !mark) return null;
  return (
    <span className="tm-bp-field-pct num" data-warn={warn || undefined} aria-hidden>
      {fmtSignedPct((v - mark) / mark)}
    </span>
  );
}

function TpslEditor({ edit, setEdit, onClose, onSave, busy }: { edit: Edit; setEdit: (e: Edit | null) => void; onClose: () => void; onSave: () => void; busy: boolean }) {
  const tpRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    tpRef.current?.focus({ preventScroll: true });
  }, [edit.coin]);
  const tp = Number(edit.tp);
  const sl = Number(edit.sl);
  const m = edit.mark;
  /* a gentle check, never a block: a trigger on the wrong side of the mark fires at once */
  const tpWrong = !!m && !!tp && (edit.long ? tp <= m : tp >= m);
  const slWrong = !!m && !!sl && (edit.long ? sl >= m : sl <= m);
  const warn = tpWrong
    ? `Take profit is at or ${edit.long ? "below" : "above"} the mark, so it would trigger right away.`
    : slWrong
      ? `Stop loss is at or ${edit.long ? "above" : "below"} the mark, so it would trigger right away.`
      : null;
  return (
    <form
      className="tm-bp-editor"
      aria-label={`Take profit and stop loss for ${edit.coin}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && (edit.tp || edit.sl)) onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="tm-bp-editor-head">
        <span className="tm-bp-editor-id">
          <span className="tm-bp-coin-ic">
            <CoinIcon coin={edit.coin} size={18} />
          </span>
          TP / SL · {edit.coin}
          <SidePill buy={edit.long} />
        </span>
        <span className="tm-bp-editor-ref num">
          Entry <b>{bpPx(edit.entry)}</b> · Mark <b>{bpPx(m)}</b>
        </span>
      </div>
      <div className="tm-bp-editor-row">
        <label className="tm-bp-field" data-warn={tpWrong || undefined}>
          <span className="tm-bp-up">TP</span>
          <input ref={tpRef} inputMode="decimal" placeholder="Take profit" aria-label="Take profit price" value={edit.tp} onChange={(e) => setEdit({ ...edit, tp: e.target.value })} />
          <TriggerPct v={tp} mark={m} warn={tpWrong} />
        </label>
        <label className="tm-bp-field" data-warn={slWrong || undefined}>
          <span className="tm-bp-down">SL</span>
          <input inputMode="decimal" placeholder="Stop loss" aria-label="Stop loss price" value={edit.sl} onChange={(e) => setEdit({ ...edit, sl: e.target.value })} />
          <TriggerPct v={sl} mark={m} warn={slWrong} />
        </label>
        <span className="tm-bp-editor-acts">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (!edit.tp && !edit.sl)}>
            {busy ? "Saving…" : "Confirm"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
        </span>
      </div>
      <div className="tm-bp-editor-foot">
        <p className="tm-bp-editor-note" data-warn={warn ? "" : undefined} aria-live="polite">
          {warn ?? "Market triggers on the whole position, reduce only."}
        </p>
        <span className="tm-bp-editor-keys" aria-hidden>
          <kbd className="kbd">Enter</kbd> save
          <kbd className="kbd">Esc</kbd> close
        </span>
      </div>
    </form>
  );
}

/* ---------- open orders ---------- */
function OpenOrders({ coin, onlyCoin, only }: { coin: string; onlyCoin: boolean; only: ReactNode }) {
  const q = useOpenOrders();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useArmed();
  const list = (q.data ?? []).filter((o) => !onlyCoin || o.coin === coin);
  const cancel = async (items: OpenOrder[]) => {
    if (!items.length) return;
    setBusy(true);
    try {
      await api("/api/trade/cancel", { method: "POST", json: { cancels: items.map((o) => ({ coin: o.coin, oid: o.oid })) } });
      qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setBusy(false);
    }
  };
  const value = (o: OpenOrder) => o.sz * (o.isTrigger && o.type.endsWith("Market") ? o.triggerPx : o.limitPx);
  const notional = list.reduce((a, o) => a + value(o), 0);
  const empty = !q.isLoading && list.length === 0;
  const n = `${list.length} open order${list.length === 1 ? "" : "s"}${onlyCoin ? ` on ${coin}` : ""}`;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {only}
            {/* every resting order at once (tp / sl included) takes a second click */}
            {list.length > 0 && (
              <ConfirmButton
                armed={armed === "all"}
                busy={busy}
                onArm={() => setArmed("all")}
                onDisarm={() => setArmed(null)}
                onFire={() => {
                  setArmed(null);
                  void cancel(list);
                }}
                icon={<BpIcon n="close" size={11} sw={2.4} />}
                label="Cancel all"
                busyLabel="Canceling…"
                ariaLabel={`Cancel all ${n}`}
                armedLabel={`Confirm: cancel all ${n}`}
              />
            )}
          </>
        }
      >
        <Stat label="Open">{list.length}</Stat>
        <Stat label="Notional">{fmtUsd(notional)}</Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {empty ? (
          <AcctEmpty tab="orders" onlyCoin={onlyCoin} coin={coin} />
        ) : (
          <table className="tm-bp-table tm-bp-w-orders">
            <thead>
              <tr>
                <th className="tm-bp-h640">Time</th>
                <th>Order</th>
                <th className="tm-bp-h540">Type</th>
                <th className="r tm-bp-h540">Size</th>
                <th className="r tm-bp-h900">Value</th>
                <th className="r">Price</th>
                <th className="r tm-bp-c-act">
                  <span className="sr-only">Cancel</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <BpSkelRows cells={["tm-bp-h640", "", "tm-bp-h540", "r tm-bp-h540", "r tm-bp-h900", "r", "r tm-bp-c-act"]} rows={3} />
              ) : (
                list.map((o) => (
                  <tr key={o.oid} className="row-hover">
                    <td className="tm-bp-h640">
                      <BpStamp ms={o.time} />
                    </td>
                    <td>
                      <CoinCell coin={o.coin} pill={<SidePill buy={o.side === "B"} />} nsub={`${shortType(o.type)} · ${sz(o.sz)}`} />
                    </td>
                    <td className="tm-bp-h540">
                      <span className="tm-bp-2">
                        <span className="tm-bp-fg2">{o.type}</span>
                        <span className="tm-bp-sub">{flags(o.isPositionTpsl ? "TP/SL" : o.tif?.toUpperCase(), o.reduceOnly && "reduce only") || "–"}</span>
                      </span>
                    </td>
                    <td className="r tm-bp-h540">
                      <Two main={`${sz(o.sz)} ${o.coin}`} sub={o.origSz !== o.sz ? `of ${sz(o.origSz)}` : null} />
                    </td>
                    <td className="r num tm-bp-h900">{fmtUsd(value(o))}</td>
                    <td className="r">
                      <Two
                        main={o.isTrigger && o.type.endsWith("Market") ? "Market" : bpPx(o.limitPx)}
                        mainClass="tm-bp-strong"
                        sub={o.isTrigger && o.triggerCondition && o.triggerCondition !== "N/A" ? o.triggerCondition.replace(/^price\s+/i, "") : null}
                      />
                    </td>
                    <td className="r tm-bp-c-act">
                      <button type="button" className="tm-bp-act" onClick={() => cancel([o])} disabled={busy} aria-label={`Cancel the ${o.coin} ${o.type.toLowerCase()} order`}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- twap ---------- */
function Twaps({ coin, onlyCoin, only }: { coin: string; onlyCoin: boolean; only: ReactNode }) {
  const q = useTwaps();
  const qc = useQueryClient();
  const [ending, setEnding] = useState<number | null>(null);
  const list = (q.data ?? []).filter((t) => !onlyCoin || t.coin === coin);
  const terminate = async (c: string, id: number) => {
    setEnding(id);
    try {
      await api("/api/trade/twap-cancel", { method: "POST", json: { coin: c, twapId: id } });
      qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setEnding(null);
    }
  };
  const running = list.filter((t) => t.status === "activated").length;
  const empty = !q.isLoading && list.length === 0;
  return (
    <div className="tm-bp-view">
      <Bar end={only} empty={!list.length}>
        <Stat label="Running">{running}</Stat>
        <Stat label="Total">{list.length}</Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {empty ? (
          <AcctEmpty tab="twap" onlyCoin={onlyCoin} coin={coin} />
        ) : (
          <table className="tm-bp-table tm-bp-w-twap">
            <thead>
              <tr>
                <th>Order</th>
                <th className="r tm-bp-h540">Size</th>
                <th className="tm-bp-h540">Executed</th>
                <th className="r tm-bp-h900">Avg. price</th>
                <th className="tm-bp-h540">Running / Total</th>
                <th className="tm-bp-h540">Status</th>
                <th className="r tm-bp-c-act">
                  <span className="sr-only">Terminate</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <BpSkelRows cells={["", "r tm-bp-h540", "tm-bp-h540", "r tm-bp-h900", "tm-bp-h540", "tm-bp-h540", "r tm-bp-c-act"]} rows={2} />
              ) : (
                list.map((t, i) => {
                  const done = t.sz ? t.executedSz / t.sz : 0;
                  const total = t.minutes * 60_000;
                  const ran = Math.min(Date.now() - t.time, total);
                  const live = t.status === "activated";
                  const st = live ? { label: "Running", cls: "pill-brand" } : t.status === "finished" ? { label: "Finished", cls: "pill-neutral" } : t.status === "terminated" ? { label: "Terminated", cls: "pill-warn" } : statusPill(t.status);
                  const pill = (
                    <span className={`pill ${st.cls}`}>
                      {live && <span className="tm-bp-dot live-dot" />}
                      {st.label}
                    </span>
                  );
                  return (
                    <tr key={`${t.twapId}-${i}`} className="row-hover">
                      <td>
                        {/* on a phone the progress folds into the sub line and the status into the action column */}
                        <CoinCell coin={t.coin} pill={<SidePill buy={t.side === "B"} />} nsub={`${sz(t.executedSz)} / ${sz(t.sz)} ${t.coin} · ${Math.round(done * 100)}%`} />
                      </td>
                      <td className="r tm-bp-h540">
                        <Two main={`${sz(t.sz)} ${t.coin}`} sub={flags(t.reduceOnly && "reduce only", t.randomize && "randomized") || null} />
                      </td>
                      <td className="tm-bp-h540">
                        <span className="tm-bp-prog">
                          <Track v={done} />
                          <Two main={`${sz(t.executedSz)} ${t.coin}`} mainClass="tm-bp-fg2" sub={`${Math.round(done * 100)}%`} />
                        </span>
                      </td>
                      <td className="r num tm-bp-h900">{t.executedSz ? bpPx(t.executedNtl / t.executedSz) : "–"}</td>
                      <td className="tm-bp-h540">
                        {/* elapsed time only means something while it runs; after that, the window it was given */}
                        {live ? (
                          <span className="tm-bp-prog">
                            <Track v={total ? ran / total : 0} />
                            <span className="num tm-bp-fg2" suppressHydrationWarning>
                              {mins(ran)} / {mins(total)}
                            </span>
                          </span>
                        ) : (
                          <span className="num tm-bp-fg2">
                            {mins(total)} <span className="tm-bp-sub">window</span>
                          </span>
                        )}
                      </td>
                      <td className="tm-bp-h540">
                        <span className="tm-bp-2">
                          {pill}
                          {t.error && <span className="tm-bp-sub tm-bp-down">{t.error}</span>}
                        </span>
                      </td>
                      <td className="r tm-bp-c-act">
                        {live && t.twapId !== null ? (
                          <button
                            type="button"
                            className="tm-bp-act tm-bp-act-down"
                            disabled={ending === t.twapId}
                            aria-label={`Terminate the ${t.coin} TWAP`}
                            onClick={() => terminate(t.coin, t.twapId!)}
                          >
                            <span className="tm-bp-stack" aria-hidden>
                              <span data-on={ending !== t.twapId || undefined}>Terminate</span>
                              <span data-on={ending === t.twapId || undefined}>Ending…</span>
                            </span>
                          </button>
                        ) : (
                          <>
                            <span className="tm-bp-dim tm-bp-fold">–</span>
                            <span className="tm-bp-nsub">{pill}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- trade history ---------- */
function TradeHistory({ coin, onlyCoin, only }: { coin: string; onlyCoin: boolean; only: ReactNode }) {
  const q = useAccountFills();
  const list = (q.data ?? []).filter((f) => !onlyCoin || f.coin === coin);
  const fees = list.reduce((a, f) => a + f.fee + f.builderFee, 0);
  const pnl = list.reduce((a, f) => a + f.closedPnl, 0);
  const empty = !q.isLoading && list.length === 0;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {only}
            {list.length > 0 && <CsvButton rows={list} name="trade-history" />}
          </>
        }
      >
        <Stat label="Fills">{list.length}</Stat>
        <Stat label="Fees">{fmtUsd(fees)}</Stat>
        <Stat label="Closed PnL">
          <BpMoney v={pnl} glow dash={false} />
        </Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {empty ? (
          <AcctEmpty tab="trades" onlyCoin={onlyCoin} coin={coin} />
        ) : (
          <table className="tm-bp-table tm-bp-w-fills">
            <thead>
              <tr>
                <th className="tm-bp-h640">Time</th>
                <th>Fill</th>
                <th className="r">Price</th>
                <th className="r tm-bp-h540">Size</th>
                <th className="r tm-bp-h900">Trade value</th>
                <th className="r tm-bp-h540">Fee</th>
                <th className="r">Closed PnL</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <BpSkelRows cells={["tm-bp-h640", "", "r", "r tm-bp-h540", "r tm-bp-h900", "r tm-bp-h540", "r"]} rows={4} />
              ) : (
                list.map((f) => {
                  const pill = fillPill(f.dir, f.liquidation);
                  return (
                    <tr key={f.tid} className="row-hover">
                      <td className="tm-bp-h640">
                        <BpStamp ms={f.time} />
                      </td>
                      <td>
                        <CoinCell coin={f.coin} pill={<span className={`pill ${pill.cls}`}>{pill.label}</span>} nsub={`${hhmm(f.time)} · ${sz(f.sz)}`} />
                      </td>
                      <td className="r num">{bpPx(f.px)}</td>
                      <td className="r num tm-bp-fg2 tm-bp-h540">
                        {sz(f.sz)} {f.coin}
                      </td>
                      <td className="r num tm-bp-strong tm-bp-h900">{fmtUsd(f.px * f.sz)}</td>
                      <td className="r tm-bp-h540">
                        <Two main={fmtUsd(f.fee)} mainClass="tm-bp-fg2" sub={f.builderFee ? `+ ${fmtUsd(f.builderFee)} builder` : null} />
                      </td>
                      <td className="r">
                        <BpMoney v={f.closedPnl} glow />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- funding history ---------- */
function FundingHistory({ coin, onlyCoin, only }: { coin: string; onlyCoin: boolean; only: ReactNode }) {
  const q = useFundingPayments();
  const list = (q.data ?? []).filter((f) => !onlyCoin || f.coin === coin);
  const net = list.reduce((a, f) => a + f.usdc, 0);
  const empty = !q.isLoading && list.length === 0;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {only}
            {list.length > 0 && <CsvButton rows={list} name="funding-history" />}
          </>
        }
      >
        <Stat label="Payments">{list.length}</Stat>
        <Stat label="Net funding">
          <BpMoney v={net} glow dash={false} />
        </Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {empty ? (
          <AcctEmpty tab="funding" onlyCoin={onlyCoin} coin={coin} />
        ) : (
          <table className="tm-bp-table tm-bp-w-fund">
            <thead>
              <tr>
                <th className="tm-bp-h540">Time</th>
                <th>Position</th>
                <th className="r tm-bp-h540">Size</th>
                <th className="r">Payment</th>
                <th className="r">Rate</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <BpSkelRows cells={["tm-bp-h540", "", "r tm-bp-h540", "r", "r"]} rows={4} />
              ) : (
                list.map((f, i) => (
                  <tr key={i} className="row-hover">
                    <td className="tm-bp-h540">
                      <BpStamp ms={f.time} />
                    </td>
                    <td>
                      <CoinCell coin={f.coin} pill={<SidePill buy={f.szi > 0} />} nsub={`${hhmm(f.time)} · ${sz(f.szi)}`} />
                    </td>
                    <td className="r num tm-bp-fg2 tm-bp-h540">
                      {sz(f.szi)} {f.coin}
                    </td>
                    <td className="r">
                      <BpMoney v={f.usdc} glow dash={false} />
                    </td>
                    <td className="r num tm-bp-sub">{(f.rate * 100).toFixed(4)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- order history ---------- */
function OrderHistory({ coin, onlyCoin, only }: { coin: string; onlyCoin: boolean; only: ReactNode }) {
  const q = useOrderHistory();
  const list = (q.data ?? []).filter((o) => !onlyCoin || o.coin === coin);
  const filled = list.filter((o) => o.status === "filled").length;
  const empty = !q.isLoading && list.length === 0;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {only}
            {list.length > 0 && <CsvButton rows={list} name="order-history" />}
          </>
        }
      >
        <Stat label="Orders">{list.length}</Stat>
        <Stat label="Filled">{filled}</Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {empty ? (
          <AcctEmpty tab="history" onlyCoin={onlyCoin} coin={coin} />
        ) : (
          <table className="tm-bp-table tm-bp-w-hist">
            <thead>
              <tr>
                <th className="tm-bp-h640">Time</th>
                <th>Order</th>
                <th className="tm-bp-h540">Type</th>
                <th className="r tm-bp-h540">Size</th>
                <th className="r tm-bp-h900">Value</th>
                <th className="r">Price</th>
                <th>Status</th>
                <th className="r tm-bp-h1000">Order ID</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <BpSkelRows cells={["tm-bp-h640", "", "tm-bp-h540", "r tm-bp-h540", "r tm-bp-h900", "r", "", "r tm-bp-h1000"]} rows={4} />
              ) : (
                list.map((o, i) => {
                  const st = statusPill(o.status);
                  const filledSz = Number((o.origSz - o.sz).toFixed(8));
                  return (
                    <tr key={`${o.oid}-${i}`} className="row-hover">
                      <td className="tm-bp-h640">
                        <BpStamp ms={o.time} />
                      </td>
                      <td>
                        <CoinCell coin={o.coin} pill={<SidePill buy={o.side === "B"} />} nsub={`${shortType(o.type)} · ${sz(o.origSz)}`} />
                      </td>
                      <td className="tm-bp-h540">
                        <span className="tm-bp-2">
                          <span className="tm-bp-fg2">{o.type}</span>
                          <span className="tm-bp-sub">{o.reduceOnly ? "reduce only" : "–"}</span>
                        </span>
                      </td>
                      <td className="r tm-bp-h540">
                        <Two main={`${sz(o.origSz)} ${o.coin}`} sub={`filled ${sz(filledSz)}`} />
                      </td>
                      <td className="r num tm-bp-h900">{fmtUsd(o.origSz * (o.isTrigger ? o.triggerPx : o.limitPx))}</td>
                      <td className="r">
                        <Two main={bpPx(o.limitPx)} mainClass="tm-bp-strong" sub={o.isTrigger ? <span className="tm-bp-fold">trigger {bpPx(o.triggerPx)}</span> : null} />
                      </td>
                      <td>
                        <span className={`pill ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="r tm-bp-sub num tm-bp-h1000">{o.oid}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export { timeAgo, Empty };
