"use client";
import { memo, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { fmtFixed, fmtSpan } from "./chart-lib";

/* =====================================================================
   the drawing layer: trend lines, horizontal lines and the measure box,
   drawn in svg over the canvas. it re-renders only when the viewport
   store ticks (pan, zoom, price-scale drag, resize), never per frame.
   colors are attributes (not css) so a snapshot can serialize the svg.
   ===================================================================== */

export type Pt = { t: number; p: number };
export type Drawing = { id: string; type: "trend" | "hline" | "ruler"; a: Pt; b?: Pt };
export type Tool = "cursor" | "trend" | "hline" | "ruler";
export type Part = "body" | "a" | "b";

/** a tiny external store: the frame loop bumps it when the visible viewport changes */
export type Viewport = { subscribe: (f: () => void) => () => void; get: () => number; bump: () => void };
export function createViewport(): Viewport {
  let v = 0;
  const subs = new Set<() => void>();
  return {
    subscribe: (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    get: () => v,
    bump: () => {
      v++;
      subs.forEach((f) => f());
    },
  };
}

type Colors = { line: string; sel: string; up: string; down: string; bg: string; ink: string; muted: string; font: string };

type Props = {
  vp: Viewport;
  svgRef: RefObject<SVGSVGElement | null>;
  items: Drawing[];
  selected: string | null;
  active: boolean;
  locked: boolean;
  width: () => number;
  axis: () => number;
  /** the price pane's height: a measure's readout stays inside it */
  height?: () => number;
  xOf: (t: number) => number | null;
  yOf: (p: number) => number | null;
  colors: Colors;
  prec: number;
  ivSec: number;
  onShapeDown: (e: ReactPointerEvent, id: string, part: Part) => void;
  onDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
};

export const DrawingLayer = memo(function DrawingLayer(p: Props) {
  useSyncExternalStore(p.vp.subscribe, p.vp.get, p.vp.get);
  const w = p.width();
  const aw = p.axis();
  const h = p.height?.() ?? 0;
  return (
    <svg
      ref={p.svgRef}
      xmlns="http://www.w3.org/2000/svg"
      className="tm-chart-draw"
      data-active={p.active || undefined}
      data-locked={p.locked || undefined}
      onPointerDown={p.onDown}
      onPointerMove={p.onMove}
      onPointerUp={p.onUp}
      aria-hidden
    >
      {p.items.map((d) => (
        <Shape key={d.id} d={d} {...p} w={w} aw={aw} h={h} sel={p.selected === d.id} />
      ))}
    </svg>
  );
});

function Shape({ d, w, aw, h, sel, xOf, yOf, colors: c, prec, ivSec, onShapeDown }: Props & { d: Drawing; w: number; aw: number; h: number; sel: boolean }) {
  const color = sel ? c.sel : d.type === "ruler" ? c.sel : c.line;
  const down = (part: Part) => (e: ReactPointerEvent) => onShapeDown(e, d.id, part);
  if (d.type === "hline") {
    const y = yOf(d.a.p);
    if (y === null) return null;
    const label = fmtFixed(d.a.p, prec);
    // the price rides the scale, like tradingview's horizontal line label
    const lw = Math.max(label.length * 6.6 + 12, aw - 6);
    const lx = aw > 20 ? w + 3 : w - lw - 6;
    return (
      <g className="tm-chart-dw" data-sel={sel || undefined}>
        <line x1="0" x2={w} y1={y} y2={y} stroke="transparent" strokeWidth="12" className="tm-chart-dw-hit" onPointerDown={down("body")} />
        <line x1="0" x2={w} y1={y} y2={y} stroke={color} strokeWidth={sel ? 1.6 : 1.2} strokeDasharray="6 4" className="tm-chart-dw-ink" />
        <rect x={lx} y={y - 9} width={lw} height="18" rx="6" fill={color} className="tm-chart-dw-pill" onPointerDown={down("body")} />
        <text x={lx + lw / 2} y={y + 3.6} textAnchor="middle" fill={c.ink} fontSize="10.5" fontWeight="600" fontFamily={c.font} pointerEvents="none">
          {label}
        </text>
      </g>
    );
  }
  if (!d.b) return null;
  const x1 = xOf(d.a.t);
  const y1 = yOf(d.a.p);
  const x2 = xOf(d.b.t);
  const y2 = yOf(d.b.p);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  if (d.type === "trend") {
    return (
      <g className="tm-chart-dw" data-sel={sel || undefined}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="12" strokeLinecap="round" className="tm-chart-dw-hit" onPointerDown={down("body")} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={sel ? 2 : 1.6} strokeLinecap="round" className="tm-chart-dw-ink" />
        {sel && (
          <>
            <circle cx={x1} cy={y1} r="4.5" fill={c.bg} stroke={color} strokeWidth="1.6" className="tm-chart-dw-handle" onPointerDown={down("a")} />
            <circle cx={x2} cy={y2} r="4.5" fill={c.bg} stroke={color} strokeWidth="1.6" className="tm-chart-dw-handle" onPointerDown={down("b")} />
          </>
        )}
      </g>
    );
  }
  // measure: a tinted box, the move as a diagonal, and a readout pill (tradingview's numbers)
  const diff = d.b.p - d.a.p;
  const pct = d.a.p ? (diff / d.a.p) * 100 : 0;
  const up = diff >= 0;
  const tone = up ? c.up : c.down;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const bw = Math.abs(x2 - x1);
  const bh = Math.abs(y2 - y1);
  const nBars = Math.round((d.b.t - d.a.t) / ivSec);
  const l1 = `${up ? "+" : "−"}${fmtFixed(Math.abs(diff), prec)}  (${up ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)`;
  const l2 = `${Math.abs(nBars)} bars · ${fmtSpan(d.b.t - d.a.t)}`;
  const pw = Math.max(l1.length, l2.length) * 6.3 + 20;
  const px = left + bw / 2 - pw / 2;
  // the readout sits past the end of the drag, or on the other side when the pane has no room there
  const under = Math.max(y1, y2) + 8;
  const over = top - 44;
  const fitsUnder = !h || under + 36 <= h - 2;
  const fitsOver = over >= 2;
  const py = y2 > y1 ? (fitsUnder || !fitsOver ? under : over) : fitsOver || !fitsUnder ? over : under;
  const pyIn = h ? Math.min(Math.max(py, 2), h - 38) : py;
  return (
    <g className="tm-chart-dw tm-chart-dw-ruler">
      <rect x={left} y={top} width={bw} height={bh} fill={tone} fillOpacity="0.13" stroke={tone} strokeOpacity="0.55" strokeDasharray="4 3" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={tone} strokeWidth="1.4" strokeOpacity="0.9" />
      <rect x={px} y={pyIn} width={pw} height="36" rx="9" fill={c.bg} fillOpacity="0.94" stroke={tone} strokeOpacity="0.6" />
      <text x={px + pw / 2} y={pyIn + 15} textAnchor="middle" fill={tone} fontSize="11" fontWeight="600" fontFamily={c.font}>
        {l1}
      </text>
      <text x={px + pw / 2} y={pyIn + 29} textAnchor="middle" fill={c.muted} fontSize="10" fontFamily={c.font}>
        {l2}
      </text>
    </g>
  );
}
