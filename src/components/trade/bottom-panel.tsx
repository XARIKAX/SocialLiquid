"use client";
import "./bottom-panel.css";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { livePnl, useMarketIdentity, useMids } from "@/hooks/use-market";
import { useAccountFills, useFundingPayments, useMyTheses, useOpenOrders, useOrderHistory, useTwaps, type OpenOrder } from "@/hooks/use-account";
import { clearFinishedChases, stopChase, useChases, type Chase } from "@/lib/chase";
import { api } from "@/lib/client";
import { fmtUsd, timeAgo } from "@/lib/format";
import type { FeedItem } from "@/lib/queries";
import { fmtQty, spotRows } from "@/lib/spot";
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
import { openConvert } from "./convert";
import { openFunds } from "./funds";

type Tab = "traders" | "thesis" | "balances" | "positions" | "orders" | "twap" | "chase" | "trades" | "funding" | "history";
type AccountTab = Exclude<Tab, "traders" | "thesis">;
const TABS: [Tab, string][] = [
  ["traders", "Traders"],
  ["thesis", "Thesis"],
  ["balances", "Balances"],
  ["positions", "Positions"],
  ["orders", "Open Orders"],
  ["twap", "TWAP"],
  ["chase", "Chase"],
  ["trades", "Trade History"],
  ["funding", "Funding History"],
  ["history", "Order History"],
];
const IDS = TABS.map(([t]) => t);
const isMarket = (t: Tab) => t === "traders" || t === "thesis";
/** your own live things: their counts stay tinted while another tab is open */
const LIVE = new Set<Tab>(["positions", "orders", "twap", "chase"]);

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

/* ---------- market identity: every row shows its market's own name and icon, never "@107" or "xyz:GOLD" ---------- */
type MkOf = ReturnType<typeof useMarketIdentity>;
type Mk = ReturnType<MkOf>;
/** a market's own units ("0.5 SOL", "2 GOLD") */
const unit = (m: Mk) => (m.base ? ` ${m.base}` : "");
/** spot books buy and sell; perps go long and short */
const sideWord = (buy: boolean, m: Mk) => (m.market?.kind === "spot" ? (buy ? "Buy" : "Sell") : buy ? "Long" : "Short");
/** another market's rows link to its page (`/m/${encodeURIComponent(slug)}`); the market on screen does not */
const marketLink = (m: Mk, coin: string, current: string) => (m.market && coin !== current ? m.href : null);

/* ---------- hyperliquid's Type / Side / Market filters (open orders, trade history, order history) ---------- */
type RowFilter = { type: "all" | "limit" | "market" | "trigger"; side: "all" | "B" | "A"; market: string };
const NO_FILTER: RowFilter = { type: "all", side: "all", market: "all" };
const typeMatch = (f: RowFilter, o: { type: string; isTrigger?: boolean }) => f.type === "all" || (f.type === "trigger" ? !!o.isTrigger || /stop|take profit/i.test(o.type) : f.type === "market" ? /market/i.test(o.type) && !/stop|take profit/i.test(o.type) : /limit/i.test(o.type) && !/stop|take profit/i.test(o.type));
const rowMatch = (f: RowFilter, r: { coin: string; side: "B" | "A" }) => (f.side === "all" || r.side === f.side) && (f.market === "all" || r.coin === f.market);
/** does the filter narrow this tab (trade history has no type filter) */
const narrows = (f: RowFilter, withType: boolean) => (withType && f.type !== "all") || f.side !== "all" || f.market !== "all";
/** what a filterable view gets from the panel: the shared filter, its controls for the bar, and a reset */
type Filtering = { filter: RowFilter; controls: ReactNode; clear: () => void };

/* what each account tab says when you are signed out, and when it is empty */
type AcctIcon = BpIconName | "chase";
const ACCOUNT: Record<AccountTab, { icon: AcctIcon; noun: string; out: [string, string]; none: [string, string] }> = {
  balances: { icon: "wallet", noun: "balances", out: ["Connect to see your balances", "USDC, spot coins, available margin and unrealised PnL on Hyperliquid, updated live."], none: ["", ""] },
  positions: { icon: "layers", noun: "positions", out: ["Connect to see your positions", "Live PnL, liquidation price, TP/SL and a one-click close for everything you hold."], none: ["No open positions", "Open one from the order ticket. It shows up here with live PnL and a one-click close."] },
  orders: { icon: "list", noun: "open orders", out: ["Connect to see your open orders", "Resting limit, stop and take-profit orders, each cancellable from here."], none: ["No open orders", "Limit, stop and take-profit orders rest here until they fill or you cancel them."] },
  twap: { icon: "bars", noun: "TWAP orders", out: ["Connect to see your TWAP orders", "Progress, average fill and time left for every running TWAP."], none: ["No TWAP orders", "Split a large order over time with TWAP, under Pro in the order ticket."] },
  chase: { icon: "chase", noun: "chase orders", out: ["Connect to see your chase orders", "Post-only limits that follow the best bid or ask until they fill, each stoppable from here."], none: ["No chase orders", "Chase, under Pro in the order ticket, rests a post-only limit at the best price and follows it until it fills."] },
  trades: { icon: "receipt", noun: "fills", out: ["Connect to see your trade history", "Every fill with its fees and closed PnL, exportable to CSV."], none: ["No fills yet", "Your executions land here with their fees and closed PnL."] },
  funding: { icon: "percent", noun: "funding payments", out: ["Connect to see your funding", "Funding paid and received on your positions, settled every hour."], none: ["No funding payments yet", "Funding settles every hour on open positions."] },
  history: { icon: "history", noun: "orders", out: ["Connect to see your order history", "Every order you placed and how it ended: filled, canceled or rejected."], none: ["No orders yet", "Orders you place show up here with their final status."] },
};
const acctIcon = (i: AcctIcon) => (i === "chase" ? <ChaseGlyph /> : <BpIcon n={i} />);

export function BottomPanel(props: {
  coin: string;
  /** the market's base symbol (the market view passes it): how "this market" reads to a human */
  label?: string;
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
  // hyperliquid's Type / Side / Market filters on the open orders and history tabs: one set, shared by the three
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  const [h, setH] = useState<number | null>(null);
  /* the chase list lives in this browser's storage: what reads it joins after hydration */
  const [mounted, setMounted] = useState(false);
  const { signedIn, address } = useAuth();
  const openOrders = useOpenOrders();
  // the live tab counts and the market filter's list read these at the panel level (as production does)
  const fills = useAccountFills();
  const hist = useOrderHistory();
  const twaps = useTwaps();
  // same query key the market view already polls: no new request
  const bal = useBalance(signedIn ? address : null);
  const mids = useMids();
  const mk = useMarketIdentity();
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const { wrap, strip, nudge } = useStrip();
  /* what a human reads for this market: the base symbol the market view passes, else its name (never "@107") */
  const here = props.label ?? mk(props.coin).name;

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
    setMounted(true);
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
  /* live counts, the way hyperliquid's tabs carry them. undefined until the figures land, so arriving data never
     reads as a change (the chase count reads this browser's storage and joins after hydration, below) */
  const counts: Partial<Record<Tab, number | undefined>> = {
    traders: marketShown ? props.positions?.length : 0,
    thesis: props.theses?.length,
    balances: !signedIn ? 0 : bal.data ? 1 + (bal.data.spot?.filter((b) => b.total > 0 && b.coin !== "USDC").length ?? 0) : undefined,
    positions: !signedIn ? 0 : bal.data ? own.length : undefined,
    orders: signedIn ? openOrders.data?.length : 0,
    twap: signedIn ? twaps.data?.filter((t) => t.status === "activated").length : 0,
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
      ? { label: "uPnL", v: tradersUpnl, title: `Unrealised PnL across the ${props.positions?.length} open ${here} positions of tracked traders` }
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

  /* "only this market" and a picked market answer the same question: turning one on clears the other */
  const onOnly = (v: boolean) => {
    setOnlyCoin(v);
    if (v) setFilter((f) => (f.market === "all" ? f : { ...f, market: "all" }));
  };
  const only = props.coin ? <Toggle on={onlyCoin} onChange={onOnly} label={`Only ${here}`} /> : null;
  const acct = isMarket(tab) ? null : ACCOUNT[tab as AccountTab];

  const filterable = tab === "orders" || tab === "trades" || tab === "history";
  const coinsInView = [...new Set((tab === "orders" ? openOrders.data : tab === "trades" ? fills.data : hist.data)?.map((r) => r.coin) ?? [])];
  const filtering: Filtering = {
    filter,
    clear: () => setFilter(NO_FILTER),
    controls: filterable ? (
      <Filters
        filter={filter}
        setFilter={setFilter}
        withType={tab !== "trades"}
        coins={coinsInView}
        mk={mk}
        onMarket={(m) => {
          setFilter((f) => ({ ...f, market: m }));
          if (m !== "all") setOnlyCoin(false);
        }}
      />
    ) : null,
  };
  const vp: ViewProps = { coin: props.coin, here, mk, onlyCoin, only };

  return (
    <div className="tm-bp" ref={rootRef} style={h ? ({ "--tm-bp-h": `${h}px` } as CSSProperties) : undefined}>
      <div className="tm-bp-head">
        <div className="tm-bp-strip" ref={wrap}>
          <button type="button" className="tm-bp-nudge tm-bp-nudge-l" tabIndex={-1} aria-hidden onClick={() => nudge(-1)}>
            <BpIcon n="chevL" size={12} sw={2.4} />
          </button>
          <div className="tm-bp-tabs" ref={strip} role="tablist" aria-label="Terminal panels" onKeyDown={(e) => roveTabs(e, IDS, tab, setTab)}>
            {TABS.map(([t, label]) => {
              const cls = tab === t ? "count" : LIVE.has(t) ? "tm-bp-q tm-bp-q-live" : "tm-bp-q";
              return (
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
                    {t === "chase" ? mounted && <ChaseCount cls={cls} /> : <TabCount n={counts[t]} cls={cls} />}
                  </button>
                </Fragment>
              );
            })}
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
            label={props.label}
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
            <BpEmpty icon={acctIcon(acct.icon)} title={acct.out[0]} hint={acct.out[1]} action={<BpConnect />} />
          </div>
        ) : tab === "balances" ? (
          <Balances upnl={ownUpnl} />
        ) : tab === "positions" ? (
          <OwnPositions {...vp} />
        ) : tab === "orders" ? (
          <OpenOrders {...vp} filtering={filtering} />
        ) : tab === "twap" ? (
          <Twaps {...vp} />
        ) : tab === "chase" ? (
          <Chases {...vp} />
        ) : tab === "trades" ? (
          <TradeHistory {...vp} filtering={filtering} />
        ) : tab === "funding" ? (
          <FundingHistory {...vp} />
        ) : (
          <OrderHistory {...vp} filtering={filtering} />
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

/** what every account view gets: the market on screen (its id and how it reads), the name lookup, the only toggle */
type ViewProps = { coin: string; here: string; mk: MkOf; onlyCoin: boolean; only: ReactNode };

/* ---------- tab counts ---------- */

/**
 * a tab's count: the bright lozenge on the open tab, quiet (tinted for your live things) on the rest. once the
 * figures have landed, a change (an order placed, a fill, a chase finishing) lifts the badge for a moment
 */
function TabCount({ n, cls }: { n: number | undefined; cls: string }) {
  const [seen, setSeen] = useState({ n, k: 0 });
  if (seen.n !== n) setSeen({ n, k: seen.n !== undefined && n !== undefined && n > 0 ? seen.k + 1 : seen.k });
  if (!n) return null;
  return (
    <i key={seen.k} className={`num ${cls}`} data-bump={seen.k > 0 || undefined}>
      {n}
    </i>
  );
}

/** running chases (they live in this browser's storage, so this mounts after hydration) */
function ChaseCount({ cls }: { cls: string }) {
  const n = useChases().filter((c) => c.status === "running").length;
  return <TabCount n={n} cls={cls} />;
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

/* ---------- filters: select pills in the rail's language, lit while they narrow the list ---------- */

function Sel({ label, value, on, icon, onChange, children }: { label: string; value: string; on?: boolean; icon?: ReactNode; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <span className="tm-bp-sel" data-on={on || undefined} data-icon={icon ? "" : undefined}>
      {icon}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m7 10 5 5 5-5" />
      </svg>
    </span>
  );
}

function Filters({
  filter,
  setFilter,
  withType,
  coins,
  mk,
  onMarket,
}: {
  filter: RowFilter;
  setFilter: Dispatch<SetStateAction<RowFilter>>;
  withType: boolean;
  coins: string[];
  mk: MkOf;
  onMarket: (coin: string) => void;
}) {
  // a market picked on another tab stays listed, so the select never holds a value it has no option for
  const opts = (filter.market !== "all" && !coins.includes(filter.market) ? [...coins, filter.market] : coins).map((c) => ({ c, m: mk(c) }));
  // two builder dexes can list the same name: their dex tells them apart
  const label = ({ m }: { m: Mk }) => (m.market?.dex && opts.filter((o) => o.m.name === m.name).length > 1 ? `${m.name} · ${m.market.dex}` : m.name);
  const pick = filter.market !== "all" ? mk(filter.market) : null;
  return (
    <span className="tm-bp-filters" role="group" aria-label="Filter the rows">
      {withType && (
        <Sel label="type filter" value={filter.type} on={filter.type !== "all"} onChange={(v) => setFilter((f) => ({ ...f, type: v as RowFilter["type"] }))}>
          <option value="all">Type</option>
          <option value="limit">Limit</option>
          <option value="market">Market</option>
          <option value="trigger">Stop / TP</option>
        </Sel>
      )}
      <Sel label="side filter" value={filter.side} on={filter.side !== "all"} onChange={(v) => setFilter((f) => ({ ...f, side: v as RowFilter["side"] }))}>
        <option value="all">Side</option>
        <option value="B">Buy / Long</option>
        <option value="A">Sell / Short</option>
      </Sel>
      <Sel label="market filter" value={filter.market} on={!!pick} icon={pick ? <CoinIcon coin={pick.base || pick.name} size={14} /> : null} onChange={onMarket}>
        <option value="all">Market</option>
        {opts.map((o) => (
          <option key={o.c} value={o.c}>
            {label(o)}
          </option>
        ))}
      </Sel>
      {narrows(filter, withType) && (
        <button type="button" className="tm-bp-reset" onClick={() => setFilter(NO_FILTER)} aria-label="Clear the filters">
          Clear
        </button>
      )}
    </span>
  );
}

/**
 * a market with its side pill on one line and an optional mono sub line (a size) under it. the name and icon are
 * the market's own (SOL/USDC, GOLD); another market's name links to its page. on a narrow deck the columns that
 * drop out fold into the sub line (`nsub`), and `fold` moves the pill there too; `subFold` keeps `sub` for wide
 * decks only (the folded line has no room for it). `extra` sits after the name (the phone's thesis pen).
 */
function CoinCell({ m, href, pill, sub, nsub, fold, subFold, extra }: { m: Mk; href?: string | null; pill?: ReactNode; sub?: ReactNode; nsub?: ReactNode; fold?: boolean; subFold?: boolean; extra?: ReactNode }) {
  const hasSub = sub !== undefined && sub !== null && sub !== false && sub !== "";
  const joined = hasSub && !subFold;
  return (
    <span className="tm-bp-coin">
      <span className="tm-bp-coin-ic">
        <CoinIcon coin={m.base || m.name} size={20} />
      </span>
      <span className="tm-bp-2">
        <span className="tm-bp-coin-row">
          {href ? (
            <Link href={href} className="tm-bp-mlink" title={`Open ${m.name}`}>
              {m.name}
            </Link>
          ) : (
            m.name
          )}
          {pill && (fold ? <span className="tm-bp-fold">{pill}</span> : pill)}
          {extra}
        </span>
        {(hasSub || nsub) && (
          <span className={`tm-bp-sub num ${hasSub ? "" : "tm-bp-nsub-line"}`}>
            {nsub && (
              <span className="tm-bp-nsub">
                {nsub}
                {joined ? " · " : ""}
              </span>
            )}
            {hasSub && (subFold ? <span className="tm-bp-fold">{sub}</span> : sub)}
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

function AcctEmpty({ tab, onlyCoin, here }: { tab: AccountTab; onlyCoin: boolean; here: string }) {
  const a = ACCOUNT[tab];
  return <BpEmpty icon={acctIcon(a.icon)} tone="neutral" title={`${a.none[0]}${onlyCoin ? ` on ${here}` : ""}`} hint={a.none[1]} />;
}

/** the filters hid every row: say so, and offer the way back */
function FilteredEmpty({ tab, hidden, onClear }: { tab: AccountTab; hidden: number; onClear: () => void }) {
  return (
    <BpEmpty
      icon={<FunnelGlyph />}
      tone="neutral"
      title={`No ${ACCOUNT[tab].noun} match these filters`}
      hint={`${hidden} ${hidden === 1 ? "is" : "are"} hidden by the ${tab === "trades" ? "Side or Market" : "Type, Side or Market"} filter above.`}
      action={
        <button type="button" className="btn btn-sm" onClick={onClear}>
          Clear filters
        </button>
      }
    />
  );
}

/* local glyphs (24 grid, stroke 1.8, rounded, like BpIcon) */
/** a crosshair: the chase keeps its order trained on the best price */
function ChaseGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </svg>
  );
}
function FunnelGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16l-6.2 7.6v5.9l-3.6 1.8v-7.7z" />
    </svg>
  );
}

/* ---------- balances ---------- */
/** `upnl` is the head's live figure (marked to the mids), so the two never disagree by a tick */
function Balances({ upnl: live }: { upnl: number | null }) {
  const { address } = useAuth();
  const bal = useBalance(address);
  const mids = useMids();
  const b = bal.data;
  const upnl = live ?? b?.positions.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
  const usage = b && b.accountValue > 0 ? Math.min(1, b.marginUsed / b.accountValue) : 0;
  /* spot holdings (native deposits through Unit land here) as the asset people deposited: SOL rather than USOL */
  const spot = spotRows(b?.spot, mids.data);
  const spotUsd = spot.reduce((a, r) => a + (r.usd ?? 0), 0);
  /* an action column only once there is a coin to sell or withdraw */
  const acts = spot.some((r) => r.name !== "USDC");
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
        <Stat label={spot.length ? "Perps" : "Account"}>{b ? fmtUsd(b.accountValue) : "…"}</Stat>
        {spot.length > 0 && (
          <Stat label="Spot" title="Spot holdings at the perps mid of the same asset (USDC at 1:1)">
            ≈ {fmtUsd(spotUsd)}
          </Stat>
        )}
        <span className="tm-bp-stat tm-bp-stat-meter" title={b ? `Margin in use as a share of account value: ${fmtUsd(b.marginUsed)} of ${fmtUsd(b.accountValue)}` : "Margin in use as a share of account value"}>
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
                <span className="tm-bp-h1000">Unrealised PnL</span>
                <span className="tm-bp-s1000">uPnL</span>
              </th>
              {/* the contract folds into the asset's sub line on a narrower deck */}
              <th className="r tm-bp-h1000">Contract</th>
              {acts && (
                <th className="r tm-bp-c-act">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {bal.isLoading ? (
              <BpSkelRows cells={["", "r tm-bp-h540", "r", "r tm-bp-h540", "r", "r tm-bp-h1000"]} rows={1} />
            ) : (
              <>
                <tr className="row-hover">
                  <td>
                    <span className="tm-bp-coin">
                      <span className="tm-bp-coin-ic">
                        <span className="tm-bp-usdc">$</span>
                      </span>
                      <span className="tm-bp-2">
                        <span className="tm-bp-coin-row">USDC</span>
                        <span className="tm-bp-sub tm-bp-s1000">Perps</span>
                      </span>
                    </span>
                  </td>
                  <td className="r num tm-bp-strong tm-bp-h540">{b ? fmtUsd(b.accountValue) : "–"}</td>
                  <td className="r num">{b ? fmtUsd(b.withdrawable) : "–"}</td>
                  <td className="r num tm-bp-fg2 tm-bp-h540">{b ? fmtUsd(b.marginUsed) : "–"}</td>
                  <td className="r">
                    <BpMoney v={b ? upnl : null} glow dash={false} />
                  </td>
                  <td className="r tm-bp-dim tm-bp-h1000">Perps</td>
                  {acts && <td className="r tm-bp-c-act" />}
                </tr>
                {spot.map((r) => (
                  <tr key={r.coin} className="row-hover" data-testid={`spot-row-${r.name}`}>
                    <td>
                      <span className="tm-bp-coin">
                        <span className="tm-bp-coin-ic">
                          <CoinIcon coin={r.name} size={20} />
                        </span>
                        <span className="tm-bp-2">
                          <span className="tm-bp-coin-row">{r.name}</span>
                          {/* hyperliquid's own name for the token (USOL), next to the asset people deposited */}
                          {r.name !== r.coin ? (
                            <span className="tm-bp-sub">
                              {r.coin}
                              <span className="tm-bp-s1000"> · Spot</span>
                            </span>
                          ) : (
                            <span className="tm-bp-sub tm-bp-s1000">Spot</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="r tm-bp-h540">
                      <Two main={`${fmtQty(r.total)} ${r.name}`} mainClass="tm-bp-strong" sub={r.usd !== null ? `≈ ${fmtUsd(r.usd)}` : null} />
                    </td>
                    <td className="r">
                      {/* on a narrow deck the total column folds away: its usd estimate rides here instead */}
                      <Two main={`${fmtQty(r.available)} ${r.name}`} sub={r.usd !== null ? <span className="tm-bp-nsub">≈ {fmtUsd(r.usd)}</span> : null} />
                    </td>
                    <td className="r tm-bp-dim tm-bp-h540">–</td>
                    <td className="r tm-bp-dim">–</td>
                    <td className="r tm-bp-dim tm-bp-h1000">Spot</td>
                    {acts && (
                      <td className="r tm-bp-c-act">
                        {r.name !== "USDC" && (
                          <span className="tm-bp-acts">
                            <button
                              type="button"
                              className="tm-bp-act tm-bp-act-mint"
                              onClick={() => openConvert(r.coin)}
                              aria-label={`Sell ${r.name} for USDC`}
                              title={`Sell ${r.name} on Hyperliquid spot and move the USDC to perps`}
                            >
                              Sell<span className="tm-bp-h1000"> for USDC</span>
                            </button>
                            {/* on a phone the bar's withdraw (the same panel) stands in for the row's */}
                            <span className="tm-bp-fold">
                              <button type="button" className="tm-bp-act" onClick={() => openFunds("withdraw")}>
                                Withdraw<span className="sr-only">, {r.name}</span>
                              </button>
                            </span>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {b && b.spot && spot.length === 0 && (
                  <tr className="tm-bp-note">
                    <td colSpan={7}>No spot balances. Native deposits (SOL, BTC, ETH) land here; USDC deposits land in perps above.</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- own positions ---------- */
type Edit = { coin: string; tp: string; sl: string; long: boolean; entry: number; mark?: number };
type Compose = { coin: string; text: string; err: string | null; long: boolean };

/** how close the mark is to liquidation: under 3% the price lights up and a red dot breathes beside it */
const LIQ_NEAR = 0.03;

function OwnPositions({ coin, here, mk, onlyCoin, only }: ViewProps) {
  const { address } = useAuth();
  const bal = useBalance(address);
  const mids = useMids();
  const qc = useQueryClient();
  const orders = useOpenOrders();
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useArmed();
  const [edit, setEdit] = useState<Edit | null>(null);
  // a thesis can be posted on a position that is already open, not only with the order that opened it
  const theses = useMyTheses(!!address);
  const [compose, setCompose] = useState<Compose | null>(null);
  const latestThesis = (c: string) => (theses.data ?? []).find((t) => t.coin === c) ?? null;
  /* one footer at a time (tp / sl or thesis); the button that opened it gets the focus back when it closes */
  const opener = useRef<HTMLElement | null>(null);
  const refocus = useCallback(() => {
    const el = opener.current;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, []);
  const closeEditor = useCallback(() => {
    setEdit(null);
    refocus();
  }, [refocus]);
  const closeComposer = useCallback(() => {
    setCompose(null);
    refocus();
  }, [refocus]);
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
  const postThesis = async () => {
    if (!compose || !compose.text.trim()) return;
    setBusy(`thesis:${compose.coin}`);
    try {
      await api("/api/thesis", { method: "POST", json: { coin: compose.coin, text: compose.text.trim() } });
      qc.invalidateQueries({ queryKey: ["my-theses"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market"] });
      closeComposer();
    } catch (e) {
      const err = (e as Error).message;
      setCompose((c) => (c ? { ...c, err } : c));
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
          <AcctEmpty tab="positions" onlyCoin={onlyCoin} here={here} />
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
                <th className="tm-bp-h640 tm-bp-c-pth">Thesis</th>
                <th className="r tm-bp-c-act">
                  <span className="tm-bp-fold">TP / SL · Close</span>
                  <span className="tm-bp-nsub sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bal.isLoading ? (
                <BpSkelRows cells={["", "r tm-bp-h900", "r tm-bp-h540", "r", "r tm-bp-h540", "r tm-bp-h1000", "tm-bp-h640 tm-bp-c-pth", "r tm-bp-c-act"]} rows={3} />
              ) : (
                rows.map(({ p, mid, pnl, roe, tp, sl }) => {
                  const m = mk(p.coin);
                  const long = p.szi > 0;
                  const dist = mid && p.liquidationPx ? Math.abs(mid - p.liquidationPx) / mid : null;
                  const near = dist !== null && dist < LIQ_NEAR;
                  const t = latestThesis(p.coin);
                  const composing = compose?.coin === p.coin;
                  const openThesis = (e: { currentTarget: HTMLElement }) => {
                    if (composing) return closeComposer();
                    opener.current = e.currentTarget;
                    setEdit(null);
                    setCompose({ coin: p.coin, text: "", err: null, long });
                  };
                  const thesisLabel = t ? `Add a thesis on your ${m.name} position` : `Post a thesis on your ${m.name} position`;
                  return (
                    <tr key={p.coin} className="row-hover" data-side={long ? "long" : "short"} data-editing={edit?.coin === p.coin || undefined} data-composing={composing || undefined}>
                      <td>
                        <CoinCell
                          m={m}
                          href={marketLink(m, p.coin, coin)}
                          pill={<SidePill buy={long} label={`${long ? "Long" : "Short"} ${p.leverage}x`} />}
                          fold
                          nsub={<span className={long ? "tm-bp-up" : "tm-bp-down"}>{`${long ? "Long" : "Short"} ${p.leverage}x`}</span>}
                          sub={
                            <>
                              {sz(p.szi)}
                              <span className="tm-bp-fold">{unit(m)}</span>
                            </>
                          }
                          extra={
                            /* on a phone the thesis column folds into this pen beside the name */
                            <button
                              type="button"
                              className="tm-bp-pth-mini tm-bp-s640"
                              data-has={t ? "" : undefined}
                              data-on={composing || undefined}
                              aria-expanded={composing}
                              aria-label={thesisLabel}
                              title={t ? `Latest: ${t.text}` : "Post a thesis"}
                              onClick={openThesis}
                            >
                              <BpIcon n="pen" size={11} sw={2.2} />
                            </button>
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
                      <td className="tm-bp-h640 tm-bp-c-pth">
                        {/* your latest thesis on this position, and a composer for another (or the first) */}
                        <span className="tm-bp-pth" data-testid={`thesis-cell-${p.coin}`}>
                          {t ? (
                            <span className="tm-bp-thesis tm-bp-pth-q" title={t.text}>
                              <span className="tm-bp-thesis-text">{t.text}</span>
                            </span>
                          ) : (
                            <span className="tm-bp-pth-none">No thesis yet</span>
                          )}
                          <button
                            type="button"
                            className="tm-bp-pth-btn"
                            data-has={t ? "" : undefined}
                            data-on={composing || undefined}
                            aria-expanded={composing}
                            aria-label={thesisLabel}
                            title={t ? `Latest: ${t.text}` : "Why are you in this trade?"}
                            onClick={openThesis}
                            data-testid={`thesis-add-${p.coin}`}
                          >
                            <BpIcon n="pen" size={11} sw={2.2} />
                            {t ? (
                              "Add"
                            ) : (
                              <>
                                Post<span className="tm-bp-pth-long"> thesis</span>
                              </>
                            )}
                          </button>
                        </span>
                      </td>
                      <td className="r tm-bp-c-act">
                        <span className="tm-bp-acts">
                          <button
                            type="button"
                            className="tm-bp-tpsl"
                            data-on={edit?.coin === p.coin || undefined}
                            aria-label={`Edit take profit and stop loss for ${m.name}`}
                            aria-expanded={edit?.coin === p.coin}
                            title="Edit TP / SL"
                            onClick={(e) => {
                              opener.current = e.currentTarget;
                              setCompose(null);
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
                            ariaLabel={`Close the ${m.name} position at market`}
                            armedLabel={`Confirm: close the ${m.name} position at market`}
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
      {edit && <TpslEditor edit={{ ...edit, mark: editMark }} m={mk(edit.coin)} setEdit={setEdit} onClose={closeEditor} onSave={saveTpsl} busy={busy === edit.coin} />}
      {compose && <ThesisComposer c={compose} m={mk(compose.coin)} setCompose={setCompose} onClose={closeComposer} onPost={postThesis} busy={busy === `thesis:${compose.coin}`} />}
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

function TpslEditor({ edit, m: mkt, setEdit, onClose, onSave, busy }: { edit: Edit; m: Mk; setEdit: (e: Edit | null) => void; onClose: () => void; onSave: () => void; busy: boolean }) {
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
      aria-label={`Take profit and stop loss for ${mkt.name}`}
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
            <CoinIcon coin={mkt.base || mkt.name} size={18} />
          </span>
          TP / SL · {mkt.name}
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

/** the thesis composer: the tp / sl editor's footer in the thesis colour. it binds to the open position through
    POST /api/thesis, lands in the feed with the position attached, and settles when the position closes */
const THESIS_MAX = 280;
function ThesisComposer({ c, m, setCompose, onClose, onPost, busy }: { c: Compose; m: Mk; setCompose: (c: Compose | null) => void; onClose: () => void; onPost: () => void; busy: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [c.coin]);
  const can = !busy && !!c.text.trim();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <form
      className="tm-bp-editor"
      data-tone="thesis"
      data-testid="thesis-compose"
      aria-label={`Thesis on your open ${m.name} position`}
      onSubmit={(e) => {
        e.preventDefault();
        if (can) onPost();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (can) onPost();
        }
      }}
    >
      <div className="tm-bp-editor-head">
        <span className="tm-bp-editor-id">
          <span className="tm-bp-coin-ic">
            <CoinIcon coin={m.base || m.name} size={18} />
          </span>
          <span>
            <span className="tm-bp-thesis-word">Thesis</span> on your open {m.name} position
          </span>
          <SidePill buy={c.long} />
        </span>
        <span className="tm-bp-editor-ref num" data-warn={THESIS_MAX - c.text.length <= 20 || undefined}>
          {c.text.length}/{THESIS_MAX}
        </span>
      </div>
      <label className="tm-bp-compose">
        <textarea
          ref={ref}
          maxLength={THESIS_MAX}
          rows={2}
          value={c.text}
          onChange={(e) => setCompose({ ...c, text: e.target.value, err: null })}
          placeholder="Why are you in this trade? Posted to the feed, bound to this position, settled when it closes."
          aria-label="thesis text"
        />
      </label>
      <div className="tm-bp-editor-foot">
        <span className="tm-bp-editor-acts">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!can} data-testid="thesis-post">
            {busy ? "Posting…" : "Post thesis"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
        </span>
        <p className="tm-bp-editor-note" data-err={c.err ? "" : undefined} aria-live="polite">
          {c.err ?? ""}
        </p>
        <span className="tm-bp-editor-keys" aria-hidden>
          <kbd className="kbd">{mac ? "⌘" : "Ctrl"} Enter</kbd> post
          <kbd className="kbd">Esc</kbd> close
        </span>
      </div>
    </form>
  );
}

/* ---------- open orders ---------- */
function OpenOrders({ coin, here, mk, onlyCoin, only, filtering }: ViewProps & { filtering: Filtering }) {
  const q = useOpenOrders();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useArmed();
  /* the resting order a running chase keeps re-pricing gets marked (cancelling it by hand ends the chase) */
  const chases = useChases();
  const chasing = useMemo(() => new Set(chases.flatMap((c) => (c.status === "running" && c.oid !== null ? [c.oid] : []))), [chases]);
  const { filter } = filtering;
  const mine = (q.data ?? []).filter((o) => !onlyCoin || o.coin === coin);
  const list = mine.filter((o) => rowMatch(filter, o) && typeMatch(filter, o));
  const narrowed = narrows(filter, true);
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
  /* cancel-all takes exactly the rows on screen: when the filters or the toggle hide some, the button says how many */
  const partial = (q.data?.length ?? 0) > list.length;
  const n = `${list.length} open order${list.length === 1 ? "" : "s"}${narrowed ? " matching the filters" : ""}${onlyCoin ? ` on ${here}` : ""}`;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {((q.data?.length ?? 0) > 0 || narrowed) && filtering.controls}
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
                label={partial ? `Cancel ${list.length}` : "Cancel all"}
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
          narrowed && mine.length > 0 ? (
            <FilteredEmpty tab="orders" hidden={mine.length} onClear={filtering.clear} />
          ) : (
            <AcctEmpty tab="orders" onlyCoin={onlyCoin} here={here} />
          )
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
                list.map((o) => {
                  const m = mk(o.coin);
                  const buy = o.side === "B";
                  return (
                    <tr key={o.oid} className="row-hover">
                      <td className="tm-bp-h640">
                        <BpStamp ms={o.time} />
                      </td>
                      <td>
                        <CoinCell m={m} href={marketLink(m, o.coin, coin)} pill={<SidePill buy={buy} label={sideWord(buy, m)} />} nsub={`${shortType(o.type)} · ${sz(o.sz)}`} />
                      </td>
                      <td className="tm-bp-h540">
                        <span className="tm-bp-2">
                          <span className="tm-bp-fg2">{o.type}</span>
                          <span className="tm-bp-sub">{flags(o.isPositionTpsl ? "TP/SL" : o.tif?.toUpperCase(), chasing.has(o.oid) && "chase", o.reduceOnly && "reduce only") || "–"}</span>
                        </span>
                      </td>
                      <td className="r tm-bp-h540">
                        <Two main={`${sz(o.sz)}${unit(m)}`} sub={o.origSz !== o.sz ? `of ${sz(o.origSz)}` : null} />
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
                        <button type="button" className="tm-bp-act" onClick={() => cancel([o])} disabled={busy} aria-label={`Cancel the ${m.name} ${o.type.toLowerCase()} order`}>
                          Cancel
                        </button>
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

/* ---------- twap ---------- */
function Twaps({ coin, here, mk, onlyCoin, only }: ViewProps) {
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
          <AcctEmpty tab="twap" onlyCoin={onlyCoin} here={here} />
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
                  const m = mk(t.coin);
                  const buy = t.side === "B";
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
                        <CoinCell m={m} href={marketLink(m, t.coin, coin)} pill={<SidePill buy={buy} label={sideWord(buy, m)} />} nsub={`${sz(t.executedSz)} / ${sz(t.sz)}${unit(m)} · ${Math.round(done * 100)}%`} />
                      </td>
                      <td className="r tm-bp-h540">
                        <Two main={`${sz(t.sz)}${unit(m)}`} sub={flags(t.reduceOnly && "reduce only", t.randomize && "randomized") || null} />
                      </td>
                      <td className="tm-bp-h540">
                        <span className="tm-bp-prog">
                          <Track v={done} />
                          <Two main={`${sz(t.executedSz)}${unit(m)}`} mainClass="tm-bp-fg2" sub={`${Math.round(done * 100)}%`} />
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
                            aria-label={`Terminate the ${m.name} TWAP`}
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

/* ---------- chase orders ---------- */
const CHASE_PILL: Record<Chase["status"], { label: string; cls: string }> = {
  running: { label: "Running", cls: "pill-brand" },
  filled: { label: "Filled", cls: "pill-up" },
  stopped: { label: "Stopped", cls: "pill-neutral" },
  expired: { label: "Expired", cls: "pill-warn" },
  error: { label: "Error", cls: "pill-down" },
};
/** a running chase's clock: seconds while it is young (it re-prices every few), then minutes like the limit */
const age = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : mins(ms));

function Chases({ coin, here, mk, onlyCoin, only }: ViewProps) {
  const all = useChases();
  const list = all.filter((c) => !onlyCoin || c.coin === coin);
  const [stopping, setStopping] = useState<string | null>(null);
  const stop = async (id: string) => {
    setStopping(id);
    try {
      await stopChase(id);
    } finally {
      setStopping(null);
    }
  };
  const running = list.filter((c) => c.status === "running").length;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {only}
            {list.some((c) => c.status !== "running") && (
              <button type="button" className="tm-bp-icon-btn" onClick={clearFinishedChases} title="Remove the chases that are no longer running">
                <BpIcon n="close" size={11} sw={2.4} />
                Clear finished
              </button>
            )}
          </>
        }
      >
        <Stat label="Running">{running}</Stat>
        <Stat label="Total">{list.length}</Stat>
      </Bar>
      <div className="tm-bp-scroll">
        {list.length === 0 ? (
          <AcctEmpty tab="chase" onlyCoin={onlyCoin} here={here} />
        ) : (
          <table className="tm-bp-table tm-bp-w-twap">
            <thead>
              <tr>
                <th>Order</th>
                <th className="tm-bp-h540">Remaining</th>
                <th className="r tm-bp-h540">Resting at</th>
                <th className="tm-bp-h900">Running / Limit</th>
                <th className="tm-bp-h540">Status</th>
                <th className="r tm-bp-c-act">
                  <span className="sr-only">Stop</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                // a stored chase from before the market list loaded may carry a raw id as its label: prefer the market's name
                const id = mk(c.coin);
                const m = id.market ? id : { ...id, name: c.label };
                const buy = c.side === "LONG";
                const live = c.status === "running";
                const remaining = c.status === "running" ? c.remaining : c.status === "filled" ? 0 : c.remaining;
                const done = c.sz ? Math.max(0, Math.min(1, (c.sz - remaining) / c.sz)) : 0;
                const ran = Math.min(Date.now() - c.startedAt, c.maxMs);
                const clock = `${age(ran)} / ${mins(c.maxMs)}`;
                const st = CHASE_PILL[c.status] ?? statusPill(c.status);
                const pill = (
                  <span className={`pill ${st.cls}`}>
                    {live && <span className="tm-bp-dot live-dot" />}
                    {st.label}
                  </span>
                );
                return (
                  <tr key={c.id} className="row-hover" data-testid={`chase-${c.id}`}>
                    <td>
                      {/* the size rides under "remaining"; on a phone the progress and the resting price fold into
                          the sub line, and the status into the action column */}
                      <CoinCell
                        m={m}
                        href={marketLink(id, c.coin, coin)}
                        pill={<SidePill buy={buy} label={sideWord(buy, id)} />}
                        sub={c.reduceOnly ? "reduce only" : null}
                        subFold
                        nsub={`${sz(remaining)} / ${sz(c.sz)}${unit(m)}${c.px !== null ? ` @ ${bpPx(c.px)}` : ""}`}
                      />
                    </td>
                    <td className="tm-bp-h540">
                      <span className="tm-bp-prog">
                        <Track v={done} />
                        <Two main={`${sz(remaining)}${unit(m)}`} mainClass="tm-bp-fg2" sub={`of ${sz(c.sz)} · ${Math.round(done * 100)}% filled`} />
                      </span>
                    </td>
                    <td className="r tm-bp-h540">
                      <Two main={c.px !== null ? bpPx(c.px) : "–"} mainClass="tm-bp-strong" sub={`${c.reprices} re-price${c.reprices === 1 ? "" : "s"}`} />
                    </td>
                    <td className="tm-bp-h900">
                      {live ? (
                        <span className="tm-bp-prog">
                          <Track v={c.maxMs ? ran / c.maxMs : 0} />
                          <span className="num tm-bp-fg2" suppressHydrationWarning>
                            {clock}
                          </span>
                        </span>
                      ) : (
                        <span className="num tm-bp-fg2">
                          {mins(c.maxMs)} <span className="tm-bp-sub">limit</span>
                        </span>
                      )}
                    </td>
                    <td className="tm-bp-h540">
                      <span className="tm-bp-2">
                        {pill}
                        {c.error ? (
                          <span className="tm-bp-sub tm-bp-down tm-bp-err" title={c.error}>
                            {c.error}
                          </span>
                        ) : (
                          // the running / limit column folds in here on a narrower deck
                          <span className="tm-bp-sub tm-bp-s900 num">{live ? clock : `${mins(c.maxMs)} limit`}</span>
                        )}
                      </span>
                    </td>
                    <td className="r tm-bp-c-act">
                      {live ? (
                        <button type="button" className="tm-bp-act tm-bp-act-down" disabled={stopping === c.id} aria-label={`Stop the ${m.name} chase`} onClick={() => void stop(c.id)}>
                          <span className="tm-bp-stack" aria-hidden>
                            <span data-on={stopping !== c.id || undefined}>Stop</span>
                            <span data-on={stopping === c.id || undefined}>Stopping…</span>
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
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- trade history ---------- */
function TradeHistory({ coin, here, mk, onlyCoin, only, filtering }: ViewProps & { filtering: Filtering }) {
  const q = useAccountFills();
  const { filter } = filtering;
  const mine = (q.data ?? []).filter((f) => !onlyCoin || f.coin === coin);
  const list = mine.filter((f) => rowMatch(filter, f));
  const narrowed = narrows(filter, false);
  const fees = list.reduce((a, f) => a + f.fee + f.builderFee, 0);
  const pnl = list.reduce((a, f) => a + f.closedPnl, 0);
  const empty = !q.isLoading && list.length === 0;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {((q.data?.length ?? 0) > 0 || narrowed) && filtering.controls}
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
          narrowed && mine.length > 0 ? (
            <FilteredEmpty tab="trades" hidden={mine.length} onClear={filtering.clear} />
          ) : (
            <AcctEmpty tab="trades" onlyCoin={onlyCoin} here={here} />
          )
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
                  const m = mk(f.coin);
                  const pill = fillPill(f.dir, f.liquidation);
                  return (
                    <tr key={f.tid} className="row-hover">
                      <td className="tm-bp-h640">
                        <BpStamp ms={f.time} />
                      </td>
                      <td>
                        <CoinCell m={m} href={marketLink(m, f.coin, coin)} pill={<span className={`pill ${pill.cls}`}>{pill.label}</span>} nsub={`${hhmm(f.time)} · ${sz(f.sz)}`} />
                      </td>
                      <td className="r num">{bpPx(f.px)}</td>
                      <td className="r num tm-bp-fg2 tm-bp-h540">
                        {sz(f.sz)}
                        {unit(m)}
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
function FundingHistory({ coin, here, mk, onlyCoin, only }: ViewProps) {
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
          <AcctEmpty tab="funding" onlyCoin={onlyCoin} here={here} />
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
                list.map((f, i) => {
                  const m = mk(f.coin);
                  return (
                    <tr key={i} className="row-hover">
                      <td className="tm-bp-h540">
                        <BpStamp ms={f.time} />
                      </td>
                      <td>
                        <CoinCell m={m} href={marketLink(m, f.coin, coin)} pill={<SidePill buy={f.szi > 0} />} nsub={`${hhmm(f.time)} · ${sz(f.szi)}`} />
                      </td>
                      <td className="r num tm-bp-fg2 tm-bp-h540">
                        {sz(f.szi)}
                        {unit(m)}
                      </td>
                      <td className="r">
                        <BpMoney v={f.usdc} glow dash={false} />
                      </td>
                      <td className="r num tm-bp-sub">{(f.rate * 100).toFixed(4)}%</td>
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

/* ---------- order history ---------- */
function OrderHistory({ coin, here, mk, onlyCoin, only, filtering }: ViewProps & { filtering: Filtering }) {
  const q = useOrderHistory();
  const { filter } = filtering;
  const mine = (q.data ?? []).filter((o) => !onlyCoin || o.coin === coin);
  const list = mine.filter((o) => rowMatch(filter, o) && typeMatch(filter, o));
  const narrowed = narrows(filter, true);
  const filled = list.filter((o) => o.status === "filled").length;
  const empty = !q.isLoading && list.length === 0;
  return (
    <div className="tm-bp-view">
      <Bar
        empty={!list.length}
        end={
          <>
            {((q.data?.length ?? 0) > 0 || narrowed) && filtering.controls}
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
          narrowed && mine.length > 0 ? (
            <FilteredEmpty tab="history" hidden={mine.length} onClear={filtering.clear} />
          ) : (
            <AcctEmpty tab="history" onlyCoin={onlyCoin} here={here} />
          )
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
                  const m = mk(o.coin);
                  const buy = o.side === "B";
                  const st = statusPill(o.status);
                  const filledSz = Number((o.origSz - o.sz).toFixed(8));
                  return (
                    <tr key={`${o.oid}-${i}`} className="row-hover">
                      <td className="tm-bp-h640">
                        <BpStamp ms={o.time} />
                      </td>
                      <td>
                        <CoinCell m={m} href={marketLink(m, o.coin, coin)} pill={<SidePill buy={buy} label={sideWord(buy, m)} />} nsub={`${shortType(o.type)} · ${sz(o.origSz)}`} />
                      </td>
                      <td className="tm-bp-h540">
                        <span className="tm-bp-2">
                          <span className="tm-bp-fg2">{o.type}</span>
                          <span className="tm-bp-sub">{o.reduceOnly ? "reduce only" : "–"}</span>
                        </span>
                      </td>
                      <td className="r tm-bp-h540">
                        <Two main={`${sz(o.origSz)}${unit(m)}`} sub={`filled ${sz(filledSz)}`} />
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
