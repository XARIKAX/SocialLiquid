"use client";
import "./order-book.css";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { pushTicketPrice, useOpenOrders } from "@/hooks/use-account";
import type { MarketSummary } from "@/lib/hl-types";

/* =====================================================================
   the order book + trades: a dense, live instrument in the mock's glass.
   rows are fitted to the card's height so the spread always sits at the
   centre and nothing is ever clipped; depth bars are soft gradients
   (scaleX only) that are strongest at the spread; the mid row is the
   hero: the price, coloured and lit the way it last moved, with a brief
   tint on every tick. hovering a level shades its cumulative range down
   to the spread and shows the average fill; clicking it fills the ticket.
   ===================================================================== */

type Level = { px: number; sz: number; n: number };
type Book = { bids: Level[]; asks: Level[]; time: number };
type Trade = { px: number; sz: number; side: "B" | "A"; time: number; tid: number };
type Tab = "book" | "trades";
type Unit = "coin" | "usd";
type Side = "ask" | "bid";
/** a grouped level with its running size (total) and running notional (ntl) from the spread out */
type Row = Level & { total: number; ntl: number };

const TABS: readonly Tab[] = ["book", "trades"];
const UNITS: readonly Unit[] = ["coin", "usd"];
/** the base row height; rows stretch by a pixel or two so a side fills its half exactly */
const ROW_H = 21;
/** the hover readout's footprint, for placing it beside the card (or inside it on narrow screens) */
const TIP_W = 184;
const TIP_H = 64;
/** /api/book sends at most this many levels a side (hyperliquid's l2Book at full precision): a side this long was cut short */
const BOOK_LEVELS = 20;
/** a grouping step is offered once the loaded levels fill at least this many whole groups on every cut-short side */
const MIN_GROUPS = 3;

/* ---------- numbers ---------- */
const NF = new Map<number, Intl.NumberFormat>();
function nf(d: number) {
  let f = NF.get(d);
  if (!f) NF.set(d, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })));
  return f;
}
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** decimals a price step needs: 1 -> 0, 0.5 -> 1, 0.00001 -> 5 */
const stepDecimals = (step: number) => (step > 0 && Number.isFinite(step) ? Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9))) : 2);
const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
/** a notional: cents while it is small (a thin book must not read as a column of zeros), whole dollars after */
const usdDec = (v: number) => (Math.abs(v) < 1000 ? 2 : 0);
const usd = (v: number) => `$${nf(usdDec(v)).format(v)}`;
/** a formatted number's width in ems of the row font (tabular digits ~0.6em, separators ~0.2em) */
function ems(s: string) {
  let w = 0;
  for (const ch of s) w += ch >= "0" && ch <= "9" ? 0.6 : ch === "," || ch === "." ? 0.2 : 0.9;
  return w;
}
/**
 * a column's formatter: the most decimals (up to `dec`) at which its widest value still fits the
 * column, compact past that. a cell clips silently, and a clipped number reads as a different number.
 */
function colFmt(max: number, dec: number, room: number): (v: number) => string {
  for (let d = dec; d >= 0; d--) {
    const f = nf(d);
    if (ems(f.format(max)) <= room) return (v) => f.format(v);
  }
  return (v) => COMPACT.format(v);
}

/* ---------- grouping ---------- */
/**
 * a side's levels bucketed by step, from the spread out (floor for bids, ceil for asks; the epsilon
 * keeps 3810.1 / 0.1 = 38100.999… in its own bucket). when the side was cut short at BOOK_LEVELS, its
 * outermost bucket can be missing levels that were never loaded: unless the farthest loaded level sits
 * on that bucket's far edge, the bucket is left out rather than shown with a size that is too small.
 */
function groupSide(levels: Level[], side: Side, step: number): Level[] {
  const m = new Map<number, Level>();
  let far = side === "bid" ? Infinity : -Infinity;
  for (const l of levels) {
    far = side === "bid" ? Math.min(far, l.px) : Math.max(far, l.px);
    const k = side === "bid" ? Math.floor(l.px / step + 1e-9) * step : Math.ceil(l.px / step - 1e-9) * step;
    const key = Number(k.toPrecision(10));
    const cur = m.get(key);
    if (cur) {
      cur.sz += l.sz;
      cur.n += l.n;
    } else m.set(key, { px: key, sz: l.sz, n: l.n });
  }
  const out = [...m.values()].sort((a, b) => (side === "bid" ? b.px - a.px : a.px - b.px));
  if (levels.length >= BOOK_LEVELS && out.length > 1 && Math.abs(far - out[out.length - 1].px) > step * 1e-6) out.pop();
  return out;
}
/** the coarsest step the loaded book can fill: MIN_GROUPS whole groups on every side that was cut short */
function reachOf(b: Book, ticks: number[]) {
  let r = 0;
  ticks.forEach((t, i) => {
    const ok = (["bid", "ask"] as const).every((s) => {
      const lv = s === "bid" ? b.bids : b.asks;
      return lv.length < BOOK_LEVELS || groupSide(lv, s, t).length >= MIN_GROUPS;
    });
    if (ok) r = i;
  });
  return r;
}

/* ---------- a remembered ui preference (never part of what is sent to hyperliquid) ---------- */
/** read before the first paint on the client (no flash of the default), harmless on the server */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [v, setV] = useState<T>(fallback);
  useBeforePaint(() => {
    try {
      const s = localStorage.getItem(key);
      if (s && (allowed as readonly string[]).includes(s)) setV(s as T);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (n: T) => {
      setV(n);
      try {
        localStorage.setItem(key, n);
      } catch {}
    },
    [key],
  );
  return [v, set] as const;
}

/**
 * the room, in ems of the row font, of the size column and the last column, measured off the column
 * heads (they share the rows' grid), so the formatters know how many characters a cell can carry
 */
function useRoom(panel: RefObject<HTMLDivElement | null>, layoutKey: unknown) {
  const [room, setRoom] = useState({ sz: 9, end: 9 });
  const measure = useCallback(() => {
    const el = panel.current;
    const cols = el?.querySelector(".tm-book-cols")?.children;
    if (!el || !cols || cols.length < 3) return;
    const fs = parseFloat(getComputedStyle(el).getPropertyValue("--tm-book-fs")) || 12;
    /* a little air off each column so a value never kisses its neighbour */
    const sz = Math.round(((cols[1] as HTMLElement).clientWidth / fs - 0.3) * 10) / 10;
    const end = Math.round(((cols[2] as HTMLElement).clientWidth / fs - 0.3) * 10) / 10;
    setRoom((r) => (r.sz === sz && r.end === end ? r : { sz, end }));
  }, [panel]);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panel, measure]);
  /* the long-price grid re-proportions the columns without resizing the panel */
  useLayoutEffect(measure, [measure, layoutKey]);
  return room;
}

/* ---------- icons (inline, rounded) ---------- */
const Chev = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const Check = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
const Swap = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </svg>
);
/** a price step as a label: a long run of zeros goes into a subscript count (0.0₉1), the way dex traders read tiny prices */
function StepLabel({ text }: { text: string }) {
  const m = /^0\.(0{5,})(\d+)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      0.0<sub className="tm-book-zeros">{m[1].length}</sub>
      {m[2]}
    </>
  );
}
const Arrow = () => (
  <span className="tm-book-dir" aria-hidden>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  </span>
);

/* =====================================================================
   the card
   ===================================================================== */
export function OrderBook({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const [tab, setTab] = usePref<Tab>("sl:book-tab", "book", TABS);
  const [unit, setUnit] = usePref<Unit>("sl:book-unit", "coin", UNITS);
  const [group, setGroup] = useState(0); // index into tick options
  const book = useQuery({ queryKey: ["book", coin], queryFn: () => api<Book>(`/api/book?coin=${coin}`), refetchInterval: 1500, enabled: tab === "book" });
  const trades = useQuery({ queryKey: ["recent-trades", coin], queryFn: () => api<{ trades: Trade[] }>(`/api/trades?coin=${coin}`).then((r) => r.trades), refetchInterval: 2000, enabled: tab === "trades" });
  const szDec = market?.szDecimals ?? 3;
  /* the grouping steps scale with the price; the book's own best bid stands in until a mid arrives */
  const base = mid ?? market?.markPx ?? book.data?.bids[0]?.px ?? 0;
  const ticks = useMemo(() => {
    const raw = Math.pow(10, Math.floor(Math.log10(Math.max(base, 1e-9))) - 4);
    const t0 = base > 1 ? Math.min(raw, 1) : raw;
    return [t0, t0 * 2, t0 * 5, t0 * 10, t0 * 20, t0 * 50, t0 * 100].map((x) => Number(x.toPrecision(2)));
  }, [base]);
  const tick = ticks[Math.min(group, ticks.length - 1)];

  /* grouping happens here, over the levels the book loads, so a step coarser than that depth would
     collapse the book to a row or two. only the steps it can fill are offered: the reach only ever
     grows for a coin (a menu never loses an option while it is open), and the chosen step stays */
  const seen = useMemo(() => (book.data ? reachOf(book.data, ticks) : -1), [book.data, ticks]);
  const [reach, setReach] = useState({ coin, i: seen });
  if (reach.coin !== coin || seen > reach.i) setReach({ coin, i: reach.coin !== coin ? seen : Math.max(reach.i, seen) });
  const tickOpts = useMemo(
    () => ticks.map((t, i) => ({ value: i, label: nf(stepDecimals(t)).format(t) })).filter((o) => reach.i < 0 || o.value <= reach.i || o.value === group),
    [ticks, reach.i, group],
  );
  const unitToggle = <UnitToggle coin={coin} unit={unit} onChange={setUnit} />;
  /* the open tab's led says live only while it is: a refresh that keeps failing over loaded data turns it amber */
  const live = tab === "book" ? book : trades;
  const stale = live.isError && live.data !== undefined;

  const uid = useId();
  const tabEls = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const k = e.key;
    const next = k === "ArrowRight" ? (i + 1) % TABS.length : k === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : k === "Home" ? 0 : k === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]);
    tabEls.current[next]?.focus();
  };

  return (
    <div className="tm-book" data-tab={tab}>
      <div className="tm-book-head">
        <div className="tm-book-tabs" role="tablist" aria-label="Order book and trades" onKeyDown={onTabKey}>
          {TABS.map((t, i) => (
            <button
              key={t}
              ref={(el) => {
                tabEls.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={tab === t ? `${uid}-panel-${t}` : undefined}
              aria-label={t === "book" ? "Order book" : undefined}
              aria-describedby={tab === t && stale ? `${uid}-stale` : undefined}
              tabIndex={tab === t ? 0 : -1}
              className="tm-book-tab"
              data-stale={tab === t && stale ? "" : undefined}
              title={tab === t && stale ? "Reconnecting…" : undefined}
              onClick={() => setTab(t)}
            >
              <span className="tm-book-led" aria-hidden />
              {t === "book" ? (
                <>
                  {/* a narrow card keeps the header on one line by dropping "Order" */}
                  <span className="tm-book-tab-ex">Order </span>Book
                </>
              ) : (
                "Trades"
              )}
            </button>
          ))}
        </div>
        {stale && (
          <span id={`${uid}-stale`} className="sr-only">
            Reconnecting, showing the last update
          </span>
        )}
        {tab === "book" && (
          <div className="tm-book-ctrls">
            <Pick label="Price grouping" caption="Group by" value={group} options={tickOpts} onChange={setGroup} align="end" render={(l) => <StepLabel text={l} />} />
          </div>
        )}
      </div>
      {tab === "book" ? (
        <BookPanel
          id={`${uid}-panel-book`}
          labelledBy={`${uid}-tab-book`}
          coin={coin}
          data={book.data}
          failed={book.isError}
          tick={tick}
          fine={ticks[0]}
          unit={unit}
          unitToggle={unitToggle}
          szDec={szDec}
          fallback={mid ?? market?.markPx}
          change={market?.change24h}
        />
      ) : (
        <TradesPanel id={`${uid}-panel-trades`} labelledBy={`${uid}-tab-trades`} coin={coin} data={trades.data} failed={trades.isError} unit={unit} unitToggle={unitToggle} szDec={szDec} fine={ticks[0]} />
      )}
    </div>
  );
}

/* =====================================================================
   the book
   ===================================================================== */
/** the hovered (or keyboard-focused) level, or the mid row: where its readout goes, beside the card when there is room */
type Hot = { side: Side | "mid"; i: number; out: boolean; x: number; y: number; top: number; bottom: number };

function BookPanel({
  id,
  labelledBy,
  coin,
  data,
  failed,
  tick,
  fine,
  unit,
  unitToggle,
  szDec,
  fallback,
  change,
}: {
  id: string;
  labelledBy: string;
  coin: string;
  data?: Book;
  failed: boolean;
  tick: number;
  fine: number;
  unit: Unit;
  unitToggle: ReactNode;
  szDec: number;
  fallback?: number;
  change?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef<HTMLDivElement>(null);
  const asksRef = useRef<HTMLDivElement>(null);
  /* how many levels fit on each side, and the row height that fills the half exactly. a side is
     flex: 1 1 0, so its height is the card's to give, never its rows': measuring it cannot feed back */
  const [fit, setFit] = useState({ n: 9, rh: ROW_H, h: 0 });
  useEffect(() => {
    const side = asksRef.current;
    if (!side) return;
    const measure = () => {
      const h = side.clientHeight;
      const n = Math.max(1, Math.floor(h / ROW_H));
      const rh = Math.max(16, Math.min(ROW_H + 4, Math.floor(h / n)));
      const ph = panelRef.current?.clientHeight ?? 0;
      setFit((f) => (f.n === n && f.rh === rh && f.h === ph ? f : { n, rh, h: ph }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(side);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    if (!data) return null;
    const agg = (levels: Level[], side: Side): Row[] => {
      let total = 0;
      let ntl = 0;
      return groupSide(levels, side, tick)
        .slice(0, fit.n)
        .map((l) => ({ ...l, total: (total += l.sz), ntl: (ntl += l.sz * l.px) }));
    };
    const bids = agg(data.bids, "bid");
    const asks = agg(data.asks, "ask");
    const bidDepth = bids.at(-1)?.total ?? 0;
    const askDepth = asks.at(-1)?.total ?? 0;
    const max = Math.max(bidDepth, askDepth, 1e-9);
    const bestBid = data.bids[0]?.px;
    const bestAsk = data.asks[0]?.px;
    const both = bestBid !== undefined && bestAsk !== undefined;
    const spread = both ? bestAsk - bestBid : null;
    return {
      bids,
      asks,
      max,
      bidDepth,
      askDepth,
      spread,
      spreadPct: spread !== null && bestBid ? spread / bestBid : null,
      midPx: both ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk ?? null),
      share: bidDepth + askDepth > 0 ? bidDepth / (bidDepth + askDepth) : 0.5,
      /* a side that ran out of loaded levels before filling its half says so, quietly, where it ends */
      askEnd: data.asks.length >= BOOK_LEVELS && asks.length > 0 && asks.length < fit.n,
      bidEnd: data.bids.length >= BOOK_LEVELS && bids.length > 0 && bids.length < fit.n,
    };
  }, [data, tick, fit.n]);

  /* the hero price: the book's own mid (always between the levels shown), coloured by its last move.
     only a move of the book's mid counts as a tick; the hand-off from the fallback mid does not */
  const fromBook = g?.midPx != null;
  const heroPx = g?.midPx ?? fallback ?? null;
  const [mv, setMv] = useState(() => ({ coin, px: heroPx, fromBook, dir: ((change ?? 0) < 0 ? "down" : "up") as "up" | "down", n: 0 }));
  if (coin !== mv.coin || heroPx !== mv.px || fromBook !== mv.fromBook) {
    const moved = coin === mv.coin && fromBook && mv.fromBook && heroPx !== null && mv.px !== null && heroPx !== mv.px;
    setMv({
      coin,
      px: heroPx,
      fromBook,
      dir: moved ? (heroPx > (mv.px as number) ? "up" : "down") : coin !== mv.coin ? ((change ?? 0) < 0 ? "down" : "up") : mv.dir,
      n: moved ? mv.n + 1 : mv.n,
    });
  }

  /* your resting limit orders, grouped like the book, marked on their level */
  const orders = useOpenOrders();
  const mine = useMemo(() => {
    const s = new Set<string>();
    for (const o of orders.data ?? []) {
      if (o.coin !== coin || o.isTrigger || !o.limitPx) continue;
      const k = o.side === "B" ? Math.floor(o.limitPx / tick + 1e-9) * tick : Math.ceil(o.limitPx / tick - 1e-9) * tick;
      s.add(`${o.side === "B" ? "bid" : "ask"}:${Number(k.toPrecision(10))}`);
    }
    return s;
  }, [orders.data, coin, tick]);

  /* keyboard: one tab stop for the whole book, arrows walk the levels top to bottom */
  const order = useMemo(() => (g ? [...g.asks.map((_, i) => `a${g.asks.length - 1 - i}`), ...g.bids.map((_, i) => `b${i}`)] : []), [g]);
  const [focusSlot, setFocusSlot] = useState("a0");
  const tabSlot = order.includes(focusSlot) ? focusSlot : order.includes("a0") ? "a0" : order[0];
  const onDepthKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = (e.target as HTMLElement).dataset.slot;
    if (!cur) return;
    const i = order.indexOf(cur);
    const k = e.key;
    const j = k === "ArrowUp" ? i - 1 : k === "ArrowDown" ? i + 1 : k === "Home" ? 0 : k === "End" ? order.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    const next = order[Math.max(0, Math.min(order.length - 1, j))];
    setFocusSlot(next);
    depthRef.current?.querySelector<HTMLElement>(`[data-slot="${next}"]`)?.focus();
  };

  /* hover / keyboard focus: the average fill readout (or, on the mid row, how the depth leans) */
  const [hot, setHot] = useState<Hot | null>(null);
  const lightUp = (el: HTMLElement, side: Side | "mid", i: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    const p = panel.getBoundingClientRect();
    const card = (panel.closest(".card") ?? panel).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setHot({ side, i, out: card.left > TIP_W + 24, x: card.left - 10, y: r.top + r.height / 2, top: r.top - p.top, bottom: r.bottom - p.top });
  };
  /* a readout pinned beside the card must not drift when the page scrolls under it */
  useEffect(() => {
    if (!hot?.out) return;
    const off = () => setHot(null);
    window.addEventListener("scroll", off, { capture: true, passive: true });
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, { capture: true });
      window.removeEventListener("resize", off);
    };
  }, [hot?.out]);

  /* click: fill the ticket, confirm on the row (and, on touch, where the ticket is out of sight) */
  const [picked, setPicked] = useState<{ slot: string; n: number; px: string } | null>(null);
  const [said, setSaid] = useState("");

  const longpx = !!g && fmtLen(g, tick) > 9;
  const room = useRoom(panelRef, longpx);
  const pxDec = stepDecimals(tick);
  const fmtPx = (v: number) => nf(pxDec).format(v);
  /* each column formats to the room it has: coin sizes at the coin's precision, notionals in dollars */
  const cols = useMemo(() => {
    const rows = g ? [...g.asks, ...g.bids] : [];
    const maxSz = rows.reduce((m, r) => Math.max(m, unit === "coin" ? r.sz : r.sz * r.px), 0);
    const maxTot = rows.reduce((m, r) => Math.max(m, unit === "coin" ? r.total : r.ntl), 0);
    return { sz: colFmt(maxSz, unit === "coin" ? szDec : usdDec(maxSz), room.sz), tot: colFmt(maxTot, unit === "coin" ? szDec : usdDec(maxTot), room.end) };
  }, [g, unit, szDec, room.sz, room.end]);
  const cellSz = (r: Row) => cols.sz(unit === "coin" ? r.sz : r.sz * r.px);
  const cellTot = (r: Row) => cols.tot(unit === "coin" ? r.total : r.ntl);
  const unitLabel = unit === "coin" ? coin : "USD";

  const renderRow = (r: Row, side: Side, i: number, n: number, max: number) => {
    const slot = `${side === "ask" ? "a" : "b"}${i}`;
    const px = fmtPx(r.px);
    const isMine = mine.has(`${side}:${r.px}`);
    return (
      <button
        key={i}
        type="button"
        className="tm-book-row"
        data-side={side}
        data-slot={slot}
        data-best={i === 0 ? "" : undefined}
        data-mine={isMine ? "" : undefined}
        tabIndex={slot === tabSlot ? 0 : -1}
        style={{ "--d": Math.min(1, r.total / max).toFixed(4), "--o": (1 - 0.55 * (i / Math.max(1, n - 1))).toFixed(3) } as CSSProperties}
        aria-label={`${side === "ask" ? "Ask" : "Bid"} ${px}, ${cellSz(r)} ${unitLabel}, total ${cellTot(r)} ${unitLabel}${isMine ? ", your order" : ""}. Use as limit price`}
        onClick={() => {
          pushTicketPrice(r.px);
          setFocusSlot(slot);
          setPicked((p) => ({ slot, n: (p?.n ?? 0) + 1, px }));
          setSaid(`Limit price ${px} sent to the order ticket`);
        }}
        onPointerEnter={(e) => e.pointerType !== "touch" && lightUp(e.currentTarget, side, i)}
        onFocus={(e) => {
          setFocusSlot(slot);
          if (e.currentTarget.matches(":focus-visible")) lightUp(e.currentTarget, side, i);
        }}
      >
        <span className="tm-book-bar" aria-hidden />
        {picked?.slot === slot && <span key={picked.n} className="tm-book-fx" aria-hidden />}
        <span className="tm-book-px">{px}</span>
        <span className="tm-book-sz">{cellSz(r)}</span>
        <span className="tm-book-tot">{cellTot(r)}</span>
      </button>
    );
  };

  const hotRow = hot && g && hot.side !== "mid" ? (hot.side === "ask" ? g.asks : g.bids)[hot.i] : undefined;
  const heroStr = heroPx !== null ? nf(stepDecimals(fine) + 1).format(heroPx) : null;
  /* inside the card (narrow screens): on the far side of the level, away from its shaded range */
  const tipAbove = hot ? hot.side === "ask" || fit.h - hot.bottom < TIP_H + 6 : false;
  const tipStyle: CSSProperties | undefined = hot ? (hot.out ? { left: hot.x, top: hot.y } : tipAbove ? { top: hot.top - 4, transform: "translateY(-100%)" } : { top: hot.bottom + 4 }) : undefined;
  const dir = mv.dir;
  const sum = (v: number) => `${nf(szDec).format(v)} ${coin}`;
  const sharePct = g ? Math.round(g.share * 100) : null;

  return (
    <div ref={panelRef} id={id} role="tabpanel" aria-labelledby={labelledBy} className="tm-book-panel" data-longpx={longpx ? "" : undefined}>
      <div className="tm-book-cols">
        <span className="label-caps">Price</span>
        <span className="label-caps tm-book-col-sz">
          <span className="tm-book-col-word">Size</span>
          {unitToggle}
        </span>
        <span className="label-caps">Total</span>
      </div>
      <div
        ref={depthRef}
        className="tm-book-depth"
        data-failed={failed && !g ? "" : undefined}
        style={{ "--tm-book-rh": `${fit.rh}px` } as CSSProperties}
        onKeyDown={onDepthKey}
        onPointerLeave={() => setHot(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(null);
        }}
      >
        <div ref={asksRef} className="tm-book-side tm-book-asks" role="group" aria-label={`Asks, ${coin}`}>
          {g?.askEnd && <EndOfDepth />}
          {g ? [...g.asks].reverse().map((r, j) => renderRow(r, "ask", g.asks.length - 1 - j, g.asks.length, g.max)) : <Ghosts n={fit.n} side="ask" />}
          {failed && !g && (
            <div className="tm-book-note" role="status">
              <span>
                <i aria-hidden />
                Book unavailable · Retrying…
              </span>
            </div>
          )}
        </div>
        <div className="tm-book-mid" data-dir={dir} data-long={heroStr && heroStr.length > 10 ? "" : undefined} onPointerEnter={(e) => (g && e.pointerType !== "touch" ? lightUp(e.currentTarget, "mid", -1) : setHot(null))}>
          {mv.n > 0 && <span key={mv.n} className="tm-book-tint" aria-hidden />}
          <span className="tm-book-hero num">
            {heroStr !== null ? (
              <>
                <span className="sr-only">Mid price </span>
                <Arrow />
                {heroStr}
                <span className="sr-only">
                  , last move {dir}
                  {sharePct !== null ? `. Bids are ${sharePct}% of the depth shown` : ""}
                </span>
              </>
            ) : (
              <span className="tm-book-hero-wait skeleton" />
            )}
          </span>
          <span className="tm-book-spread">
            <span className="tm-book-spread-l">Spread</span>
            <span className="tm-book-spread-v num">
              <b>{g?.spread != null ? nf(stepDecimals(fine)).format(g.spread) : "–"}</b>
              <em>{g?.spreadPct != null ? `${(g.spreadPct * 100).toFixed(3)}%` : ""}</em>
            </span>
          </span>
          {g && <span className="tm-book-press" style={{ "--b": g.share.toFixed(4) } as CSSProperties} aria-hidden />}
        </div>
        <div className="tm-book-side tm-book-bids" role="group" aria-label={`Bids, ${coin}`}>
          {g ? g.bids.map((r, i) => renderRow(r, "bid", i, g.bids.length, g.max)) : <Ghosts n={fit.n} side="bid" />}
          {g?.bidEnd && <EndOfDepth />}
        </div>
      </div>
      {hot && g && tipStyle && (hotRow || hot.side === "mid") && (
        <Readout
          side={hot.side}
          out={hot.out}
          style={tipStyle}
          rows={
            hotRow
              ? [
                  ["Avg price", nf(pxDec + 1).format(hotRow.ntl / Math.max(hotRow.total, 1e-12))],
                  [`Sum ${coin}`, nf(szDec).format(hotRow.total)],
                  ["Sum USD", usd(hotRow.ntl)],
                ]
              : [
                  ["Bids shown", sum(g.bidDepth)],
                  ["Asks shown", sum(g.askDepth)],
                  ["Bid share", `${sharePct}%`],
                ]
          }
        />
      )}
      {picked && (
        <span key={picked.n} className="tm-book-sent" aria-hidden>
          <Check />
          <b>{picked.px}</b> set as limit price
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

/** the widest formatted price in the book, in characters: past 9 the price column takes more room */
function fmtLen(g: { asks: Row[]; bids: Row[] }, tick: number) {
  const px = g.asks.at(-1)?.px ?? g.bids.at(-1)?.px ?? g.asks[0]?.px ?? g.bids[0]?.px ?? 0;
  return nf(stepDecimals(tick)).format(px).length;
}

/** the average-fill readout for a level: beside the card (a portal, so the card's clip cannot cut it) or inside it */
function Readout({ side, out, style, rows }: { side: Side | "mid"; out: boolean; style: CSSProperties; rows: [string, string][] }) {
  const node = (
    <div className="tm-book-tip pop" data-side={side} data-out={out ? "" : undefined} style={style} aria-hidden>
      {rows.map(([k, v]) => (
        <span key={k}>
          <b>{k}</b>
          <i>{v}</i>
        </span>
      ))}
    </div>
  );
  return out ? createPortal(node, document.body) : node;
}

/** where a side's loaded levels run out before its half is full (a coarse step over a shallow load) */
function EndOfDepth() {
  return (
    <div className="tm-book-end" aria-hidden>
      <span>End of loaded depth</span>
    </div>
  );
}

/** a shimmering book silhouette while the first snapshot loads */
function Ghosts({ n, side }: { n: number; side: Side }) {
  return (
    <>
      {Array.from({ length: n }).map((_, k) => {
        const i = side === "ask" ? n - 1 - k : k;
        return (
          <div key={k} className="tm-book-ghost" aria-hidden style={{ opacity: 1 - (i / Math.max(1, n)) * 0.6 }}>
            <i className="skeleton" style={{ width: `${34 + ((i * 37) % 22)}%` }} />
            <i className="skeleton" style={{ width: `${18 + ((i * 53) % 16)}%` }} />
          </div>
        );
      })}
    </>
  );
}

/* =====================================================================
   the trade tape
   ===================================================================== */
function TradesPanel({ id, labelledBy, coin, data, failed, unit, unitToggle, szDec, fine }: { id: string; labelledBy: string; coin: string; data?: Trade[]; failed: boolean; unit: Unit; unitToggle: ReactNode; szDec: number; fine: number }) {
  /* "new" = printed after the newest trade of the previous snapshot. a big jump (first load,
     back from another tab) lands quietly instead of tinting the whole tape at once */
  const [snap, setSnap] = useState<{ data?: Trade[]; cut: number }>({ cut: Infinity });
  if (data !== snap.data) {
    let cut = Infinity;
    if (snap.data && data) {
      const prev = snap.data.reduce((m, t) => Math.max(m, t.time), 0);
      const fresh = data.reduce((c, t) => c + (t.time > prev ? 1 : 0), 0);
      if (fresh > 0 && fresh <= 8) cut = prev;
    }
    setSnap({ data, cut });
  }
  const cut = data === snap.data ? snap.cut : Infinity;
  const pxDec = stepDecimals(fine);
  const panelRef = useRef<HTMLDivElement>(null);
  const longpx = !!data?.length && nf(pxDec).format(data[0].px).length > 9;
  const room = useRoom(panelRef, longpx);
  const { maxSz, fmtSz } = useMemo(() => {
    const list = data ?? [];
    const maxSz = Math.max(1e-12, ...list.map((t) => t.sz));
    const maxCol = list.reduce((m, t) => Math.max(m, unit === "coin" ? t.sz : t.sz * t.px), 0);
    return { maxSz, fmtSz: colFmt(maxCol, unit === "coin" ? szDec : usdDec(maxCol), room.sz) };
  }, [data, unit, szDec, room.sz]);

  return (
    <div ref={panelRef} id={id} role="tabpanel" aria-labelledby={labelledBy} className="tm-book-panel" data-longpx={longpx ? "" : undefined}>
      <div className="tm-book-cols">
        <span className="label-caps">Price</span>
        <span className="label-caps tm-book-col-sz">
          <span className="tm-book-col-word">Size</span>
          {unitToggle}
        </span>
        <span className="label-caps">Time</span>
      </div>
      <div className="tm-book-list" role="list" aria-label={`Recent ${coin} trades`} data-wait={!data ? "" : undefined}>
        {data?.map((t) => {
          const up = t.side === "B";
          return (
            <div
              key={`${t.tid}:${t.time}`}
              role="listitem"
              className="tm-book-trade"
              data-side={up ? "bid" : "ask"}
              data-new={t.time > cut ? "" : undefined}
              style={{ "--d": Math.min(1, t.sz / maxSz).toFixed(4) } as CSSProperties}
            >
              <span className="tm-book-bar" aria-hidden />
              <span className="tm-book-px">{nf(pxDec).format(t.px)}</span>
              <span className="tm-book-sz">{fmtSz(unit === "coin" ? t.sz : t.sz * t.px)}</span>
              <span className="tm-book-time">
                <span className="sr-only">{up ? "Buy" : "Sell"} at </span>
                {CLOCK.format(t.time)}
              </span>
            </div>
          );
        })}
        {!data && !failed && <Ghosts n={40} side="bid" />}
        {!data && failed && (
          <div className="tm-book-note" role="status">
            <span>
              <i aria-hidden />
              Trades unavailable · Retrying…
            </span>
          </div>
        )}
        {data && data.length === 0 && (
          <div className="tm-book-note">
            <span>No trades yet</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   the size unit: two states, so a one-click glass toggle on the column it changes
   ===================================================================== */
function UnitToggle({ coin, unit, onChange }: { coin: string; unit: Unit; onChange: (u: Unit) => void }) {
  const next: Unit = unit === "coin" ? "usd" : "coin";
  return (
    <button type="button" className="tm-book-unitbtn" onClick={() => onChange(next)} aria-label={`Sizes in ${unit === "coin" ? coin : "USD"}. Show in ${next === "coin" ? coin : "USD"}`} title={`Show sizes in ${next === "coin" ? coin : "USD"}`}>
      <span>{unit === "coin" ? coin : "USD"}</span>
      <Swap />
    </button>
  );
}

/* =====================================================================
   a compact glass picker (listbox): the price grouping
   ===================================================================== */
type Opt<T> = { value: T; label: string };

function Pick<T extends string | number>({
  label,
  caption,
  value,
  options,
  onChange,
  align = "start",
  render = (l) => l,
}: {
  label: string;
  caption: ReactNode;
  value: T;
  options: Opt<T>[];
  onChange: (v: T) => void;
  align?: "start" | "end";
  render?: (label: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const sel = Math.max(0, options.findIndex((o) => o.value === value));
  const cur = options[sel];

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const off = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);

  const openAt = (i: number) => {
    setActive(i);
    setOpen(true);
  };
  const choose = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    btn.current?.focus();
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp" || k === "Home" || k === "End") {
      e.preventDefault();
      setActive((a) => (k === "ArrowDown" ? Math.min(options.length - 1, a + 1) : k === "ArrowUp" ? Math.max(0, a - 1) : k === "Home" ? 0 : options.length - 1));
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      choose(active);
    } else if (k === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (k === "Tab") setOpen(false);
  };

  return (
    <div ref={wrap} className="tm-book-pickwrap">
      <button
        ref={btn}
        type="button"
        className="tm-book-pick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${cur?.label ?? ""}`}
        title={label}
        onClick={() => (open ? setOpen(false) : openAt(sel))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openAt(sel);
          }
        }}
      >
        <span className="tm-book-pick-v">{cur ? render(cur.label) : null}</span>
        <Chev />
      </button>
      {open && (
        <div ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${id}-o${active}`} className="pop tm-book-menu" data-align={align} onKeyDown={onListKey}>
          <div className="tm-book-menu-cap" aria-hidden>
            {caption}
          </div>
          {options.map((o, i) => (
            <div key={String(o.value)} id={`${id}-o${i}`} role="option" aria-label={o.label} aria-selected={i === sel} data-active={i === active ? "" : undefined} className="tm-book-opt" onPointerMove={() => setActive(i)} onClick={() => choose(i)}>
              <span>{render(o.label)}</span>
              {i === sel && <Check />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
