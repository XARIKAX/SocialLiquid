"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";
import { timeAgo } from "@/lib/format";
import { CHART_TYPES, IND_DEFS, INTERVALS, fmtCompact, fmtFixed, fmtInd, fmtSigned, indLook, indMatches, splitIndName, type Candle, type ChartType, type Ind, type IndDef, type IndFmt, type Interval } from "./chart-lib";

/* =====================================================================
   chart chrome: local icons, the legends (the price pane's and one per
   oscillator pane), the clock, thesis pins, the tooltip layer and the
   menus (interval, chart type, indicators, the right-click menu).
   positions of pins, tags and pane legends are written by the chart's
   frame loop, never by react renders.
   ===================================================================== */

/** a marker on the chart. optional fields enrich thesis pins when the caller has them */
export type ChartMarker = {
  time: number;
  side: "LONG" | "SHORT" | "CLOSE";
  label: string;
  kind: "mine" | "thesis";
  /** trader address: tints the avatar disc */
  address?: string;
  handle?: string | null;
  avatarUrl?: string | null;
  /** anchor price (entry); defaults to the bar's low (long) or high (short) */
  px?: number;
  /** thesis text, shown on hover */
  text?: string;
};
export type PriceLine = { px: number; color: string; title: string; dashed?: boolean };

/* ---------- icons (24 grid, 1.75 stroke, matching the app set) ---------- */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const GLYPHS: Record<string, ReactNode> = {
  candles: (
    <>
      <path d="M7.5 3.5v3M7.5 17.5v3M16.5 3v4.5M16.5 15.5V20" />
      <rect x="5" y="6.5" width="5" height="11" rx="1.3" />
      <rect x="14" y="7.5" width="5" height="8" rx="1.3" />
    </>
  ),
  bars: <path d="M7.5 3.5v17M4.5 8h3M7.5 15.5h3M16.5 3v15M13.5 6.5h3M16.5 12.5h3" />,
  line: <path d="m3.5 16.5 4.5-5.5 4 3.5 4.5-7.5 4 4.5" />,
  area: (
    <>
      <path d="m3.5 16.5 4.5-5.5 4 3.5 4.5-7.5 4 4.5V20h-17z" fill="currentColor" fillOpacity="0.16" stroke="none" />
      <path d="m3.5 16.5 4.5-5.5 4 3.5 4.5-7.5 4 4.5" />
    </>
  ),
  ha: (
    <>
      <path d="M7.5 4v3M7.5 17v3M16.5 3v3M16.5 14v4" />
      <rect x="5" y="7" width="5" height="10" rx="2.5" />
      <rect x="14" y="6" width="5" height="8" rx="2.5" />
    </>
  ),
  pencil: <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3" />,
  magnet: (
    <>
      <path d="M5.5 4.5h4.2v7a2.3 2.3 0 0 0 4.6 0v-7h4.2v7a6.5 6.5 0 0 1-13 0z" />
      <path d="M5.5 8.5h4.2M14.3 8.5h4.2" />
    </>
  ),
  funding: <path d="M3.5 20.5h17M6 16.5l4.2-5.2 3.4 3.1L20 6.5M15.5 6.5H20V11" />,
  chevrons: <path d="m6 7 5 5-5 5M13 7l5 5-5 5" />,
  mine: <path d="M8 19V6M4.5 9.5 8 6l3.5 3.5M16 5v13M12.5 14.5 16 18l3.5-3.5" />,
  thesis: (
    <>
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />
      <path d="M8 10h8M8 13h5" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: <path d="M3.5 3.5l17 17M10.4 10.5a2.8 2.8 0 0 0 3.9 3.9M9.6 5.8A9.6 9.6 0 0 1 12 5.5c6.1 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.7M6.6 7.1C4 8.9 2.5 12 2.5 12s3.4 6.5 9.5 6.5c1.5 0 2.8-.3 4-.8" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
};
export function CIcon({ n, size = 15, className }: { n: keyof typeof GLYPHS | ChartType; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...P} className={className} aria-hidden>
      {GLYPHS[n]}
    </svg>
  );
}

/* ---------- avatar disc (no initials: at 14px a gradient reads better) ---------- */
function hashHue(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
export function Disc({ m, size = 16 }: { m: ChartMarker; size?: number }) {
  if (m.avatarUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.avatarUrl} alt="" width={size} height={size} className="tm-chart-disc" style={{ width: size, height: size }} />;
  const seed = m.address ?? m.handle ?? m.label;
  const h1 = m.address ? parseInt(m.address.slice(2, 8), 16) % 360 : hashHue(seed) % 360;
  const h2 = (h1 + 40 + (hashHue(seed) % 80)) % 360;
  return <span className="tm-chart-disc" style={{ width: size, height: size, background: `radial-gradient(circle at 34% 30%, hsl(${h1} 80% 78%), hsl(${h1} 72% 58%) 45%, hsl(${h2} 70% 38%))` }} />;
}
export const whoOf = (m: ChartMarker) => {
  if (m.handle) return `@${m.handle}`;
  return /^[a-z0-9_]{2,24}$/i.test(m.label) && !/^0x/i.test(m.label) ? `@${m.label}` : m.label;
};

/* ---------- legends ---------- */

/** one indicator as a legend shows it: its lines (colour, values aligned with the candles, the live reading) */
export type LegendInd = {
  id: Ind;
  /** the short name and its parameters ("RSI", "14"), and the full name for labels */
  short: string;
  params: string;
  title: string;
  fmt: IndFmt;
  /** hidden with the eye: the name stays, the readings go */
  off: boolean;
  lines: { key: string; color: string; values: number[]; live?: number; hist?: boolean }[];
};

/** the bar under the crosshair (any pane: the vertical line spans them all), or null */
function useHoverIdx(chart: IChartApi | null) {
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    const c = chart;
    if (!c) return;
    const h = (e: MouseEventParams<Time>) => setIdx(e.time !== undefined && e.logical !== undefined ? Math.round(e.logical) : null);
    c.subscribeCrosshairMove(h);
    return () => c.unsubscribeCrosshairMove(h);
  }, [chart]);
  return idx;
}

/** the reading at bar i (a step back over a gap), or the live one off the crosshair */
function readAt(l: LegendInd["lines"][number], i: number, hovering: boolean) {
  if (!hovering && l.live !== undefined) return l.live;
  const k = Math.min(i, l.values.length - 1);
  for (let j = k; j >= Math.max(0, k - 2); j--) if (Number.isFinite(l.values[j])) return l.values[j];
  return NaN;
}

/** tradingview's legend controls: hide (the eye) and remove, shown on hover */
function IndControls({ d, onToggle, onRemove, className }: { d: LegendInd; onToggle: (id: Ind) => void; onRemove: (id: Ind) => void; className: string }) {
  const name = d.params ? `${d.short} ${d.params}` : d.short;
  return (
    <span className={className}>
      <button type="button" className="tm-chart-lg-btn" aria-pressed={d.off} aria-label={d.off ? `Show ${name}` : `Hide ${name}`} onClick={() => onToggle(d.id)}>
        <CIcon n={d.off ? "eyeOff" : "eye"} size={12} />
      </button>
      <button type="button" className="tm-chart-lg-btn tm-chart-lg-rm" aria-label={`Remove ${name}`} onClick={() => onRemove(d.id)}>
        <CIcon n="close" size={11} />
      </button>
    </span>
  );
}

/** an indicator's readings, each in its line's colour (a histogram in up / down by its sign) */
function Readings({ d, i, hovering, prec }: { d: LegendInd; i: number; hovering: boolean; prec: number }) {
  if (d.off) return null;
  return (
    <>
      {d.lines.map((l) => {
        const v = readAt(l, i, hovering);
        const tone = l.hist && Number.isFinite(v) ? (v >= 0 ? "var(--tm-up)" : "var(--tm-down)") : l.color;
        return (
          <b key={l.key} style={{ "--c": tone } as CSSProperties}>
            {fmtInd(v, d.fmt, prec)}
          </b>
        );
      })}
    </>
  );
}

type LegendProps = {
  chart: IChartApi | null;
  /** the market as people read it ("BTC-USD", "SOL/USDC", "GOLD-USD") */
  name: string;
  ivLabel: string;
  typeLabel: string | null;
  rows: Candle[];
  candles: Candle[];
  live: Candle | null;
  liveIdx: number;
  prec: number;
  /** the overlays on the price pane, in the order they were added */
  inds: LegendInd[];
  showVol: boolean;
  onRemove: (id: Ind) => void;
  onToggle: (id: Ind) => void;
  /** the legend box, so the chart can keep the candles clear of it */
  boxRef?: (el: HTMLDivElement | null) => void;
};

export const Legend = memo(function Legend(p: LegendProps) {
  const idx = useHoverIdx(p.chart);
  const n = p.rows.length;
  if (!n || !p.live) return null;
  const hovering = idx !== null && idx >= 0 && idx < p.liveIdx && idx < n;
  const i = hovering ? (idx as number) : Math.min(p.liveIdx, n - 1);
  const row = hovering ? p.rows[i] : p.live;
  const prevRow = hovering ? p.rows[i - 1] : p.liveIdx >= n ? p.rows[n - 1] : p.rows[n - 2];
  const vol = hovering ? p.candles[i]?.volume : p.liveIdx >= n ? 0 : p.candles[n - 1]?.volume;
  const base = prevRow?.close ?? row.open;
  const chg = row.close - base;
  const pct = base ? chg / base : 0;
  const dir = row.close >= row.open ? "up" : "down";
  const v = (x: number) => fmtFixed(x, p.prec);
  const pctText = `${pct >= 0 ? "+" : "−"}${Math.abs(pct * 100).toFixed(2)}%`;

  return (
    <div ref={p.boxRef} className="tm-chart-legend" data-dir={dir} aria-live="off">
      <div className="tm-chart-lg-id">
        <i className="tm-chart-lg-dot" data-live={!hovering || undefined} />
        {p.name && (
          <>
            <span className="tm-chart-lg-sym">{p.name}</span>
            <span className="tm-chart-lg-sep">·</span>
          </>
        )}
        <span>{p.ivLabel}</span>
        <span className="tm-chart-lg-sep tm-chart-lg-x">·</span>
        <span className="tm-chart-lg-x">Hyperliquid</span>
        {p.typeLabel && <span className="tm-chart-lg-type">{p.typeLabel}</span>}
      </div>
      {/* the mock's hierarchy: open, high and low stay quiet; the close and the move carry the colour */}
      <div className="tm-chart-lg-ohlc">
        <span>
          O<b>{v(row.open)}</b>
        </span>
        <span>
          H<b>{v(row.high)}</b>
        </span>
        <span>
          L<b>{v(row.low)}</b>
        </span>
        <span>
          C<b className="tm-chart-lg-c">{v(row.close)}</b>
        </span>
        <b className="tm-chart-lg-chg">
          <span className="tm-chart-lg-abs">{fmtSigned(chg, p.prec)} (</span>
          {pctText}
          <span className="tm-chart-lg-abs">)</span>
        </b>
        {p.showVol && vol !== undefined && vol > 0 && (
          <span className="tm-chart-lg-vol">
            Vol<b>{fmtCompact(vol)}</b>
          </span>
        )}
      </div>
      {p.inds.length > 0 && (
        <div className="tm-chart-lg-inds">
          {/* off the crosshair, the readings follow the live bar */}
          {p.inds.map((d) => (
            <span key={d.id} className="tm-chart-lg-ind" data-off={d.off || undefined} style={{ "--c": d.lines[0]?.color } as CSSProperties}>
              <i />
              <span>
                {d.short}
                {d.params && <span className="tm-chart-lg-par"> {d.params}</span>}
              </span>
              <Readings d={d} i={i} hovering={hovering} prec={p.prec} />
              <IndControls d={d} onToggle={p.onToggle} onRemove={p.onRemove} className="tm-chart-lg-ctl" />
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * one small legend per oscillator pane, as tradingview's: the name and its parameters, the readings at
 * the crosshair (or the live bar), and the eye / remove controls. the frame loop moves each to the top
 * of its pane (register), so they follow a dragged separator without a render.
 */
export const PaneLegends = memo(function PaneLegends(p: {
  chart: IChartApi | null;
  /** the oscillators, in pane order (pane 1 first) */
  inds: LegendInd[];
  rows: number;
  liveIdx: number;
  prec: number;
  register: (id: Ind, el: HTMLElement | null) => void;
  onRemove: (id: Ind) => void;
  onToggle: (id: Ind) => void;
}) {
  const idx = useHoverIdx(p.chart);
  const n = p.rows;
  if (!n || !p.inds.length) return null;
  const hovering = idx !== null && idx >= 0 && idx < p.liveIdx && idx < n;
  const i = hovering ? (idx as number) : Math.min(p.liveIdx, n - 1);
  return (
    <>
      {p.inds.map((d) => (
        <OscRow key={d.id} d={d} register={p.register}>
          <span className="tm-chart-osc-n">
            <i aria-hidden />
            {d.short}
            {d.params && <span className="tm-chart-lg-par">{d.params}</span>}
          </span>
          <span className="tm-chart-osc-v">
            <Readings d={d} i={i} hovering={hovering} prec={p.prec} />
          </span>
          <IndControls d={d} onToggle={p.onToggle} onRemove={p.onRemove} className="tm-chart-osc-ctl" />
        </OscRow>
      ))}
    </>
  );
});
/** a pane legend's box; its ref is stable, so a crosshair render does not re-register it with the frame loop */
function OscRow({ d, register, children }: { d: LegendInd; register: (id: Ind, el: HTMLElement | null) => void; children: ReactNode }) {
  const id = d.id;
  const ref = useCallback((el: HTMLDivElement | null) => register(id, el), [register, id]);
  return (
    <div ref={ref} className="tm-chart-osc" data-off={d.off || undefined} data-hidden="" role="group" aria-label={`${d.title} pane`} style={{ "--c": d.lines[0]?.color } as CSSProperties}>
      {children}
    </div>
  );
}

/** a catalogue entry as the legends show it */
export function legendInd(d: IndDef, off: boolean, lines: LegendInd["lines"]): LegendInd {
  const l = indLook(d);
  return { id: d.id, short: l.short, params: l.params, title: d.name, fmt: l.fmt, off, lines };
}

/* ---------- clock (its own component: ticking does not re-render the chart) ---------- */
export function Clock() {
  const [s, setS] = useState<[string, string]>(["", ""]);
  useEffect(() => {
    const f = () => {
      const d = new Date();
      const off = -d.getTimezoneOffset();
      const oh = Math.trunc(off / 60);
      const om = Math.abs(off % 60);
      setS([d.toLocaleTimeString("en-GB", { hour12: false }), `UTC${off >= 0 ? "+" : "−"}${Math.abs(oh)}${om ? `:${String(om).padStart(2, "0")}` : ""}`]);
    };
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="tm-chart-clock" aria-label={`Local time ${s[0]} ${s[1]}`}>
      <b>{s[0]}</b>
      <span>{s[1]}</span>
    </span>
  );
}

/* ---------- thesis pins ---------- */

export type PinGroup = { id: string; time: number; price: number; side: "LONG" | "SHORT"; items: ChartMarker[] };

export const ThesisPins = memo(function ThesisPins({ groups, register }: { groups: PinGroup[]; register: (id: string, el: HTMLElement | null) => void }) {
  return (
    <>
      {groups.map((g) => (
        <Pin key={g.id} g={g} register={register} />
      ))}
    </>
  );
});

function Pin({ g, register }: { g: PinGroup; register: (id: string, el: HTMLElement | null) => void }) {
  const first = g.items[0];
  const more = g.items.length - 1;
  const names = g.items.map(whoOf).join(", ");
  return (
    <div ref={(el) => register(g.id, el)} className="tm-chart-pin" data-side={g.side === "SHORT" ? "above" : "below"} data-hidden="">
      <span className="tm-chart-pin-stem" />
      <span className="tm-chart-pin-dot" />
      <span className="tm-chart-pin-tag" tabIndex={0} role="note" aria-label={`Thesis by ${names}`}>
        <span className="tm-chart-pin-faces">
          {g.items.slice(0, 3).map((m, i) => (
            <Disc key={i} m={m} size={15} />
          ))}
        </span>
        <span className="tm-chart-pin-text">
          Thesis<span className="tm-chart-pin-who"> · {whoOf(first)}</span>
          {more > 0 && <span className="tm-chart-pin-more">+{more}</span>}
        </span>
      </span>
      <div className="tm-chart-pin-card pop" role="tooltip">
        {g.items.slice(0, 4).map((m, i) => (
          <div key={i} className="tm-chart-pin-row">
            <div className="tm-chart-pin-row-top">
              <Disc m={m} size={18} />
              <b>{whoOf(m)}</b>
              <span className={`pill ${m.side === "SHORT" ? "pill-down" : "pill-up"}`}>{m.side === "SHORT" ? "Short" : "Long"}</span>
              <span className="tm-chart-pin-ago">{timeAgo(m.time)}</span>
            </div>
            {m.text && <p>{m.text}</p>}
          </div>
        ))}
        {g.items.length > 4 && <div className="tm-chart-pin-overflow">and {g.items.length - 4} more in the feed</div>}
      </div>
    </div>
  );
}

/* ---------- tooltips: one glass tip for the whole chart, driven by [data-tip] ---------- */
export function TipLayer({ root }: { root: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ text: string; kbd: string[]; x: number; y: number; pos: string } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer = 0;
    let shownAt = 0;
    let cur: HTMLElement | null = null;
    const show = (t: HTMLElement) => {
      const r = t.getBoundingClientRect();
      const R = el.getBoundingClientRect();
      const pos = t.dataset.tipPos ?? "b";
      const cx = r.left - R.left + r.width / 2;
      const x = pos === "r" ? r.right - R.left + 8 : Math.min(Math.max(cx, 70), R.width - 70);
      const y = pos === "r" ? r.top - R.top + r.height / 2 : pos === "t" ? r.top - R.top - 8 : r.bottom - R.top + 8;
      setTip({ text: t.dataset.tip ?? "", kbd: t.dataset.kbd ? t.dataset.kbd.split(" ") : [], x, y, pos });
      shownAt = Date.now();
    };
    const hide = () => {
      clearTimeout(timer);
      setTip((v) => {
        if (v) shownAt = Date.now();
        return null;
      });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (t === cur) return;
      cur = t;
      clearTimeout(timer);
      if (!t || !el.contains(t)) return hide();
      // warm: once one tip has shown, neighbours answer almost at once (tradingview does this)
      const warm = Date.now() - shownAt < 600;
      timer = window.setTimeout(() => show(t), warm ? 40 : 420);
    };
    const leave = () => {
      cur = null;
      hide();
    };
    const focus = (e: FocusEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (t && t.matches(":focus-visible")) show(t);
    };
    el.addEventListener("pointerover", over);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", hide);
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", hide);
    el.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("pointerover", over);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", hide);
      el.removeEventListener("focusin", focus);
      el.removeEventListener("focusout", hide);
      el.removeEventListener("scroll", hide, true);
    };
  }, [root]);
  if (!tip || !tip.text) return null;
  return (
    <div className="tm-chart-tip" data-pos={tip.pos} style={{ left: tip.x, top: tip.y }} role="tooltip">
      <span>{tip.text}</span>
      {tip.kbd.length > 0 && (
        <span className="tm-chart-tip-keys">
          {tip.kbd.map((k, i) => (
            <kbd key={i}>{k}</kbd>
          ))}
        </span>
      )}
    </div>
  );
}

/* ---------- menus ---------- */

/** arrow keys move between items, esc closes and hands focus back. focusSel: what takes focus on open (the first item by default) */
function useMenuKeys(onClose: () => void, focusSel = "[role^=menuitem][aria-checked=true], [role^=menuitem]") {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(focusSel);
    first?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const inField = (e.target as HTMLElement).tagName === "INPUT";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // from the search field, down enters the list at the top and up at the bottom
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if ((e.key === "Home" || e.key === "End") && !inField) {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return { ref, onKeyDown };
}

export type CtxAction = "reset" | "realtime" | "hline" | "copy" | "clear" | "snapshot" | "ind-toggle" | "ind-remove";
export function CtxMenu({
  style,
  price,
  canDraw,
  hasDrawings,
  ind,
  onAction,
  onClose,
}: {
  style: CSSProperties;
  price: string | null;
  canDraw: boolean;
  hasDrawings: boolean;
  /** right-clicked on an oscillator's pane: its name, and whether it is hidden */
  ind?: { name: string; off: boolean } | null;
  onAction: (a: CtxAction) => void;
  onClose: () => void;
}) {
  const { ref, onKeyDown } = useMenuKeys(onClose);
  const item = (a: CtxAction, label: ReactNode, kbd?: string, disabled?: boolean) => (
    <button type="button" role="menuitem" className="tm-chart-ci" disabled={disabled} onClick={() => onAction(a)}>
      <span>{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
  return (
    <div ref={ref} className="pop tm-chart-menu tm-chart-ctx" role="menu" aria-label="Chart menu" style={style} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {ind && (
        <>
          {item(
            "ind-toggle",
            <>
              {ind.off ? "Show" : "Hide"} <b>{ind.name}</b>
            </>,
          )}
          {item(
            "ind-remove",
            <>
              Remove <b>{ind.name}</b>
            </>,
          )}
          <div className="tm-chart-menu-rule" />
        </>
      )}
      {item("reset", "Reset chart view", "Alt R")}
      {item("realtime", "Scroll to the latest bar")}
      <div className="tm-chart-menu-rule" />
      {item(
        "hline",
        <>
          Horizontal line at <b className="num">{price ?? "–"}</b>
        </>,
        "Alt H",
        !canDraw,
      )}
      {item(
        "copy",
        <>
          Copy price <b className="num">{price ?? "–"}</b>
        </>,
        undefined,
        !price,
      )}
      {item("clear", "Remove all drawings", undefined, !hasDrawings)}
      <div className="tm-chart-menu-rule" />
      {item("snapshot", "Download a snapshot")}
    </div>
  );
}

export function TfMenu({ value, onPick, onClose, style }: { value: Interval; onPick: (iv: Interval) => void; onClose: () => void; style: CSSProperties }) {
  const { ref, onKeyDown } = useMenuKeys(onClose);
  return (
    <div ref={ref} className="pop tm-chart-menu tm-chart-menu-tf" role="menu" aria-label="Interval" style={style} onKeyDown={onKeyDown}>
      <div className="tm-chart-menu-head label-caps">Interval</div>
      {INTERVALS.map(([iv, label, spoken]) => (
        <button key={iv} type="button" role="menuitemradio" aria-checked={value === iv} className="tm-chart-mi tm-chart-mi-tf" onClick={() => onPick(iv)}>
          <b className="tm-chart-mi-tfl">{label}</b>
          <span className="tm-chart-mi-txt">
            <small>{spoken}</small>
          </span>
          <span className="tm-chart-mi-radio" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function TypeMenu({ value, onPick, onClose, style }: { value: ChartType; onPick: (t: ChartType) => void; onClose: () => void; style: CSSProperties }) {
  const { ref, onKeyDown } = useMenuKeys(onClose);
  return (
    <div ref={ref} className="pop tm-chart-menu tm-chart-menu-type" role="menu" aria-label="Chart type" style={style} onKeyDown={onKeyDown}>
      <div className="tm-chart-menu-head label-caps">Chart type</div>
      {CHART_TYPES.map(([t, label, desc]) => (
        <button key={t} type="button" role="menuitemradio" aria-checked={value === t} className="tm-chart-mi" onClick={() => onPick(t)}>
          <span className="tm-chart-mi-ico">
            <CIcon n={t} size={16} />
          </span>
          <span className="tm-chart-mi-txt">
            <b>{label}</b>
            <small>{desc}</small>
          </span>
          <span className="tm-chart-mi-radio" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** a tiny glyph per kind of indicator for the menu's swatch: a line, a channel, dots, an oscillator, a histogram */
function IndGlyph({ d }: { d: IndDef }) {
  const look = indLook(d);
  const P2 = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  let g: ReactNode;
  if (d.pane === "own" && d.lines.some((l) => l.histogram))
    g = (
      <>
        <path d="M5 12v-3.5M9 12V6M13 12v3.5M17 12v5.5" strokeWidth={2.4} strokeLinecap="butt" />
        <path d="M3 12h18" strokeOpacity={0.4} strokeWidth={1} />
      </>
    );
  else if (d.pane === "own") g = <path d="m3 14 3.5-5 3.5 6 3.5-9 3.5 7 3.5-3" />;
  else if (look.draw === "band")
    g = (
      <>
        <path d="M3 9c4-4 8 1 18-4v9c-10 5-14 0-18 4z" fill="currentColor" fillOpacity={0.2} stroke="none" />
        <path d="M3 9c4-4 8 1 18-4M3 18c4-4 8 1 18-4" />
      </>
    );
  else if (look.draw === "dots")
    g = (
      <>
        {[4, 8, 12, 16, 20].map((x, i) => (
          <circle key={x} cx={x} cy={[16, 14, 12, 9.5, 7][i]} r={1.5} fill="currentColor" stroke="none" />
        ))}
      </>
    );
  else g = <path d="M3 16c4.5-1 6.5-8 10.5-8.5S18 9 21 6" />;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P2} aria-hidden>
      {g}
    </svg>
  );
}

/**
 * the indicator menu: a searchable catalogue (the shared library's), overlays on the price pane and
 * oscillators each in a pane of their own, with clear and the volume toggle. typing anywhere in it
 * searches; enter in the search adds the first match.
 */
export function IndMenu({
  inds,
  toggle,
  clear,
  colorOf,
  query,
  setQuery,
  showVol,
  setShowVol,
  onClose,
  style,
}: {
  inds: Ind[];
  toggle: (id: Ind) => void;
  clear: () => void;
  colorOf: (d: IndDef) => string;
  query: string;
  setQuery: (q: string) => void;
  showVol: boolean;
  setShowVol: (v: boolean) => void;
  onClose: () => void;
  style: CSSProperties;
}) {
  const { ref, onKeyDown } = useMenuKeys(onClose, "input");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => (["price", "own"] as const).map((pane) => ({ pane, list: IND_DEFS.filter((d) => d.pane === pane && indMatches(d, query)) })), [query]);
  // the list's edges dissolve while there is more to scroll to (the oscillators sit below the fold)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const upd = () => {
      el.toggleAttribute("data-ft", el.scrollTop > 2);
      el.toggleAttribute("data-fb", el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", upd);
      ro.disconnect();
    };
  }, [query]);
  const first = groups[0].list[0] ?? groups[1].list[0];
  const onKey = (e: ReactKeyboardEvent) => {
    const input = inputRef.current;
    if (e.target !== input && input && e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      input.focus();
      return;
    }
    if (e.target === input && e.key === "Enter") {
      e.preventDefault();
      if (first) toggle(first.id);
      return;
    }
    onKeyDown(e);
  };
  return (
    // a dialog: the search field, then the menu proper (a text field cannot be a menu's child)
    <div ref={ref} className="pop tm-chart-menu tm-chart-menu-ind" role="dialog" aria-label="Indicators" data-testid="indicator-menu" style={style} onKeyDown={onKey}>
      <div className="tm-chart-menu-head">
        <span className="label-caps">Indicators</span>
        {inds.length > 0 && <span className="tm-chart-menu-n">{inds.length} on</span>}
      </div>
      <div className="tm-chart-ms">
        <CIcon n="search" size={14} />
        <input ref={inputRef} type="text" className="tm-chart-ms-in" placeholder="Search indicators" aria-label="search indicators" value={query} spellCheck={false} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
        {inds.length > 0 && (
          <button type="button" className="tm-chart-ms-clear" onClick={clear} aria-label={`Clear all ${inds.length} indicators`}>
            Clear
          </button>
        )}
      </div>
      <div className="tm-chart-mbody" role="menu" aria-label="Indicators">
        <div ref={listRef} className="tm-chart-ml" role="none">
          {groups.map(({ pane, list }) =>
            list.length ? (
              <div key={pane} role="group" aria-label={pane === "price" ? "Overlays" : "Oscillators · own pane"}>
                <div className="tm-chart-mg label-caps" aria-hidden>
                  <span>{pane === "price" ? "Overlays" : "Oscillators · own pane"}</span>
                  <span className="tm-chart-mg-n">{list.length}</span>
                </div>
                {list.map((d) => {
                  const on = inds.includes(d.id);
                  const [title, params] = splitIndName(d.name);
                  return (
                    <button key={d.id} type="button" role="menuitemcheckbox" aria-checked={on} className="tm-chart-mi tm-chart-mi-ind" onClick={() => toggle(d.id)} style={{ "--c": colorOf(d) } as CSSProperties}>
                      <span className="tm-chart-mi-glyph" aria-hidden>
                        <IndGlyph d={d} />
                      </span>
                      <span className="tm-chart-mi-name">
                        {title}
                        {params && <small>{params}</small>}
                      </span>
                      <span className="tm-chart-mi-check" aria-hidden>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1.8 5.4 4 7.6l4.3-5" />
                        </svg>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null,
          )}
          {!groups[0].list.length && !groups[1].list.length && (
            <div className="tm-chart-mi-none" role="status">
              No indicator matches <b>{query.trim()}</b>
            </div>
          )}
        </div>
        <div className="tm-chart-menu-rule" role="separator" />
        <button type="button" role="menuitemcheckbox" aria-checked={showVol} className="tm-chart-mi tm-chart-mi-vol" onClick={() => setShowVol(!showVol)}>
          <span className="tm-chart-mi-vbars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="tm-chart-mi-txt">
            <b>Volume</b>
            <small>Bars under the price</small>
          </span>
          <span className="switch tm-chart-mi-switch" aria-hidden data-on={showVol || undefined} />
        </button>
      </div>
    </div>
  );
}
