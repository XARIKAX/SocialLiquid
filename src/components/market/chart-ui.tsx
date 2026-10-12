"use client";
import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";
import { timeAgo } from "@/lib/format";
import { CHART_TYPES, INDICATORS, INTERVALS, fmtCompact, fmtFixed, fmtSigned, type Candle, type ChartType, type Ind, type IndData, type IndValue, type Interval } from "./chart-lib";

/* =====================================================================
   chart chrome: local icons, the legend, the clock, thesis pins, the
   tooltip layer and the menus (interval, chart type, indicators, the
   right-click menu). positions of pins and tags are written by the
   chart's frame loop, never by react renders.
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

/* ---------- legend ---------- */

type LegendProps = {
  chart: IChartApi | null;
  coin: string;
  ivLabel: string;
  typeLabel: string | null;
  rows: Candle[];
  candles: Candle[];
  live: Candle | null;
  liveIdx: number;
  prec: number;
  inds: Ind[];
  ind: IndData;
  colors: Record<Ind, string>;
  showVol: boolean;
  onRemove: (id: Ind) => void;
  /** indicator readings on the live bar (they follow the streaming price between fetches) */
  liveInd?: Partial<Record<Ind, IndValue>>;
  /** the legend box, so the chart can keep the candles clear of it */
  boxRef?: (el: HTMLDivElement | null) => void;
};

export const Legend = memo(function Legend(p: LegendProps) {
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    const c = p.chart;
    if (!c) return;
    const h = (e: MouseEventParams<Time>) => setIdx(e.time !== undefined && e.logical !== undefined ? Math.round(e.logical) : null);
    c.subscribeCrosshairMove(h);
    return () => c.unsubscribeCrosshairMove(h);
  }, [p.chart]);

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
  const at = (arr: number[]) => {
    const k = Math.min(i, arr.length - 1);
    for (let j = k; j >= Math.max(0, k - 2); j--) if (Number.isFinite(arr[j])) return arr[j];
    return NaN;
  };

  const pctText = `${pct >= 0 ? "+" : "−"}${Math.abs(pct * 100).toFixed(2)}%`;

  return (
    <div ref={p.boxRef} className="tm-chart-legend" data-dir={dir} aria-live="off">
      <div className="tm-chart-lg-id">
        <i className="tm-chart-lg-dot" data-live={!hovering || undefined} />
        <span className="tm-chart-lg-sym">{p.coin}-USD</span>
        <span className="tm-chart-lg-sep">·</span>
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
          {p.inds.map((id) => {
            const d = p.ind[id];
            const meta = INDICATORS.find((x) => x.id === id);
            if (!d || !meta) return null;
            const c = p.colors[id];
            // off the crosshair, the reading follows the live bar
            const lv = !hovering ? p.liveInd?.[id] : undefined;
            const val =
              lv !== undefined
                ? typeof lv === "number"
                  ? fmtNum(lv, p.prec)
                  : `${fmtNum(lv.upper, p.prec)} ${fmtNum(lv.mid, p.prec)} ${fmtNum(lv.lower, p.prec)}`
                : d.kind === "line"
                  ? `${fmtNum(at(d.values), p.prec)}`
                  : `${fmtNum(at(d.upper), p.prec)} ${fmtNum(at(d.mid), p.prec)} ${fmtNum(at(d.lower), p.prec)}`;
            return (
              <span key={id} className="tm-chart-lg-ind" style={{ "--c": c } as CSSProperties}>
                <i />
                <span>{meta.short}</span>
                <b>{val}</b>
                <button type="button" className="tm-chart-lg-rm" aria-label={`Remove ${meta.label}`} onClick={() => p.onRemove(id)}>
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="m2 2 6 6M8 2 2 8" />
                  </svg>
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
});
const fmtNum = (x: number, prec: number) => (Number.isFinite(x) ? fmtFixed(x, prec) : "–");

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

/** arrow keys move between items, esc closes and hands focus back */
function useMenuKeys(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("[role^=menuitem][aria-checked=true], [role^=menuitem]");
    first?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
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

export type CtxAction = "reset" | "realtime" | "hline" | "copy" | "clear" | "snapshot";
export function CtxMenu({ style, price, canDraw, hasDrawings, onAction, onClose }: { style: CSSProperties; price: string | null; canDraw: boolean; hasDrawings: boolean; onAction: (a: CtxAction) => void; onClose: () => void }) {
  const { ref, onKeyDown } = useMenuKeys(onClose);
  const item = (a: CtxAction, label: ReactNode, kbd?: string, disabled?: boolean) => (
    <button type="button" role="menuitem" className="tm-chart-ci" disabled={disabled} onClick={() => onAction(a)}>
      <span>{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
  return (
    <div ref={ref} className="pop tm-chart-menu tm-chart-ctx" role="menu" aria-label="Chart menu" style={style} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
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

export function IndMenu({
  inds,
  toggle,
  colors,
  showVol,
  setShowVol,
  onClose,
  style,
}: {
  inds: Ind[];
  toggle: (id: Ind) => void;
  colors: Record<Ind, string>;
  showVol: boolean;
  setShowVol: (v: boolean) => void;
  onClose: () => void;
  style: CSSProperties;
}) {
  const { ref, onKeyDown } = useMenuKeys(onClose);
  return (
    <div ref={ref} className="pop tm-chart-menu tm-chart-menu-ind" role="menu" aria-label="Indicators" style={style} onKeyDown={onKeyDown}>
      <div className="tm-chart-menu-head">
        <span className="label-caps">Indicators</span>
        {inds.length > 0 && <span className="tm-chart-menu-n">{inds.length} on</span>}
      </div>
      {INDICATORS.map(({ id, label, desc }) => {
        const on = inds.includes(id);
        return (
          <button key={id} type="button" role="menuitemcheckbox" aria-checked={on} className="tm-chart-mi" onClick={() => toggle(id)} style={{ "--c": colors[id] } as CSSProperties}>
            <span className="tm-chart-mi-sw" data-band={id === "bb" || undefined} aria-hidden />
            <span className="tm-chart-mi-txt">
              <b>{label}</b>
              <small>{desc}</small>
            </span>
            <span className="tm-chart-mi-check" aria-hidden>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.8 5.4 4 7.6l4.3-5" />
              </svg>
            </span>
          </button>
        );
      })}
      <div className="tm-chart-menu-rule" />
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
  );
}
