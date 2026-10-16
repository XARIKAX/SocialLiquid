import {
  customSeriesDefaultOptions,
  type AutoscaleInfo,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
} from "lightweight-charts";

/* =====================================================================
   custom lightweight-charts series for the terminal chart.
   - GlowCandles: the landing mock's candles. each body is a vertical
     gradient (pale crown, saturated body, deep foot) with softly rounded
     corners, wicks are translucent, the live candle glows, and history
     fades gently toward the left edge of the pane (a vignette, not data).
   - GlowLine: indicator lines that fade in from the left and brighten
     toward "now", with an optional soft halo pass (no blur filters), or
     a trail of dots (parabolic sar).
   - Band: channels (bollinger, donchian) as a faint cloud with hairline edges.
   - SoftHist: an oscillator histogram (macd) in the volume's language,
     signed around zero, brighter while the move grows.
   - LevelBand: an oscillator's reference zone (rsi 30-70) as a faint
     tint, kept in view by the pane's autoscale.
   all drawing happens in bitmap space so 1px lines stay crisp on retina.
   ===================================================================== */

type Target = Parameters<ICustomSeriesPaneRenderer["draw"]>[0];
type Scope = Parameters<Parameters<Target["useBitmapCoordinateSpace"]>[0]>[0];

/* ---------- helpers ---------- */

/** "#rrggbb" or "rgba(...)" to an rgba string with the given alpha multiplier */
export function withAlpha(color: string, a: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, al = "1"] = m[1].split(",").map((s) => s.trim());
    return `rgba(${r},${g},${b},${Number(al) * a})`;
  }
  return color;
}

/** the library's own candle width rule, so our bodies line up with its grid and crosshair */
function candleWidth(barSpacing: number, pr: number) {
  if (barSpacing >= 2.5 && barSpacing <= 4) return Math.floor(3 * pr);
  const coeff = 1 - (0.2 * Math.atan(Math.max(4, barSpacing) - 4)) / (Math.PI * 0.5);
  const res = Math.floor(barSpacing * coeff * pr);
  return Math.max(Math.floor(pr), Math.min(res, Math.floor(barSpacing * pr)));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (r <= 0.5 || w < 3 || h < 3) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * x of bar i in media pixels. the library refreshes x only for bars inside the visible range;
 * the neighbours just past each edge (which lines draw to, so they run off the pane) keep the x
 * of an earlier frame, which drew a stray flat segment after a pan. derive theirs from the
 * nearest visible bar instead: bars sit barSpacing apart by logical index.
 */
function barX(d: PaneRendererCustomData<Time, CustomData<Time>>, i: number): number {
  const vr = d.visibleRange;
  if (!vr || (i >= vr.from && i < vr.to)) return d.bars[i].x;
  const e = d.bars[i < vr.from ? vr.from : vr.to - 1];
  return e.x + (d.bars[i].time - e.time) * d.barSpacing;
}

/** left-edge vignette: older bars at the far left sit a little back, as in the mock */
function fadeAt(xBitmap: number, widthBitmap: number, min: number, span: number) {
  if (min >= 1 || span <= 0) return 1;
  const t = xBitmap / Math.max(1, widthBitmap * span);
  return t >= 1 ? 1 : min + (1 - min) * t;
}

/* ---------- glow candles ---------- */

export interface GlowCandle extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface GlowCandleOptions extends CustomSeriesOptions {
  upTop: string;
  upMid: string;
  upBottom: string;
  downTop: string;
  downMid: string;
  downBottom: string;
  wickUp: string;
  wickDown: string;
  glowUp: string;
  glowDown: string;
  /** alpha of the leftmost bars (1 disables the vignette) */
  fadeMin: number;
  /** share of the pane width the vignette spans */
  fadeSpan: number;
  /** glow the live (last) candle */
  liveGlow: boolean;
}

const CANDLE_DEFAULTS: GlowCandleOptions = {
  ...customSeriesDefaultOptions,
  upTop: "#b4ffe2",
  upMid: "#45e3a6",
  upBottom: "#169c57",
  downTop: "#ffb0b1",
  downMid: "#ff5a5c",
  downBottom: "#b3292b",
  wickUp: "rgba(125,245,190,0.72)",
  wickDown: "rgba(255,125,127,0.7)",
  glowUp: "rgba(69,227,166,0.75)",
  glowDown: "rgba(255,90,92,0.65)",
  fadeMin: 0.62,
  fadeSpan: 0.24,
  liveGlow: true,
};

class GlowCandleRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, GlowCandle> | null = null;
  private opts: GlowCandleOptions | null = null;

  update(data: PaneRendererCustomData<Time, GlowCandle>, opts: GlowCandleOptions) {
    this.data = data;
    this.opts = opts;
  }

  draw(target: Target, p2c: PriceToCoordinateConverter) {
    target.useBitmapCoordinateSpace((scope) => this.paint(scope, p2c));
  }

  private paint(scope: Scope, p2c: PriceToCoordinateConverter) {
    const d = this.data;
    const o = this.opts;
    if (!d || !o || !d.visibleRange || d.bars.length === 0) return;
    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize } = scope;
    const spacing = d.barSpacing * (d.conflationFactor || 1);
    let bw = candleWidth(spacing, hr);
    const ww = Math.max(1, Math.floor(hr));
    if (bw >= 2 && ww % 2 !== bw % 2) bw--;
    const lit = bw >= 3 * hr; // wide enough for the gradient and the rounded corners to read
    const radius = lit ? Math.min(1.6 * hr, bw / 4) : 0;
    const lastIndex = d.bars.length - 1;
    const from = Math.max(0, d.visibleRange.from);
    const to = Math.min(d.bars.length, d.visibleRange.to);

    const one = (i: number, glow: boolean) => {
      const bar = d.bars[i];
      const c = bar.originalData;
      if (!c || c.close === undefined) return;
      const yo = p2c(c.open);
      const yc = p2c(c.close);
      const yh = p2c(c.high);
      const yl = p2c(c.low);
      if (yo === null || yc === null || yh === null || yl === null) return;
      const up = c.close >= c.open;
      const x = Math.round(bar.x * hr);
      const alpha = glow ? 1 : fadeAt(x, bitmapSize.width, o.fadeMin, o.fadeSpan);
      ctx.globalAlpha = alpha;
      const top = Math.round(Math.min(yo, yc) * vr);
      const bot = Math.round(Math.max(yo, yc) * vr);
      const hi = Math.round(yh * vr);
      const lo = Math.round(yl * vr);
      // wick (behind the body)
      if (!glow) {
        ctx.fillStyle = up ? o.wickUp : o.wickDown;
        const wx = x - Math.floor(ww / 2);
        ctx.fillRect(wx, hi, ww, Math.max(1, lo - hi));
      }
      // body
      const bx = x - Math.floor(bw / 2);
      const bh = Math.max(Math.max(1, Math.round(vr)), bot - top);
      if (lit && bh >= 3 * vr) {
        const g = ctx.createLinearGradient(0, top, 0, top + bh);
        g.addColorStop(0, up ? o.upTop : o.downTop);
        g.addColorStop(0.42, up ? o.upMid : o.downMid);
        g.addColorStop(1, up ? o.upBottom : o.downBottom);
        ctx.fillStyle = g;
      } else ctx.fillStyle = up ? o.upMid : o.downMid;
      if (glow) {
        ctx.shadowColor = up ? o.glowUp : o.glowDown;
        ctx.shadowBlur = 12 * hr;
      }
      roundRect(ctx, bx, top, Math.max(1, bw), bh, radius);
      if (glow) {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      }
    };

    ctx.save();
    for (let i = from; i < to; i++) one(i, false);
    // the live candle: drawn again with its glow so it reads as "now"
    if (o.liveGlow && lit && lastIndex >= from && lastIndex < to) one(lastIndex, true);
    ctx.restore();
  }
}

export class GlowCandleSeries implements ICustomSeriesPaneView<Time, GlowCandle, GlowCandleOptions> {
  private r = new GlowCandleRenderer();
  renderer() {
    return this.r;
  }
  update(data: PaneRendererCustomData<Time, GlowCandle>, opts: GlowCandleOptions) {
    this.r.update(data, opts);
  }
  priceValueBuilder(c: GlowCandle) {
    return [c.high, c.low, c.close];
  }
  isWhitespace(c: GlowCandle | CustomSeriesWhitespaceData<Time>): c is CustomSeriesWhitespaceData<Time> {
    return (c as Partial<GlowCandle>).close === undefined;
  }
  defaultOptions() {
    return CANDLE_DEFAULTS;
  }
  destroy() {}
}

/* ---------- glow line ---------- */

export interface GlowPoint extends CustomData<Time> {
  value?: number;
}

export interface GlowLineOptions extends CustomSeriesOptions {
  lineColor: string;
  lineWidth: number;
  /** alpha of the soft halo pass under the line (0 = none) */
  halo: number;
  /** alpha at the far left edge; the line brightens to full toward the right (1 = flat) */
  fade: number;
  dashed: boolean;
  /** a trail of dots instead of a line (parabolic sar) */
  dots: boolean;
}

const LINE_DEFAULTS: GlowLineOptions = {
  ...customSeriesDefaultOptions,
  lineColor: "#4de3c1",
  lineWidth: 1.5,
  halo: 0,
  fade: 1,
  dashed: false,
  dots: false,
};

class GlowLineRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, GlowPoint> | null = null;
  private opts: GlowLineOptions | null = null;
  update(data: PaneRendererCustomData<Time, GlowPoint>, opts: GlowLineOptions) {
    this.data = data;
    this.opts = opts;
  }
  draw(target: Target, p2c: PriceToCoordinateConverter) {
    target.useBitmapCoordinateSpace((scope) => this.paint(scope, p2c));
  }
  private paint(scope: Scope, p2c: PriceToCoordinateConverter) {
    const d = this.data;
    const o = this.opts;
    if (!d || !o || !d.visibleRange || d.bars.length === 0) return;
    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize } = scope;
    if (d.visibleRange.from >= d.visibleRange.to) return;
    // one point beyond each edge so the line runs off the pane instead of stopping short
    const from = Math.max(0, d.visibleRange.from - 1);
    const to = Math.min(d.bars.length, d.visibleRange.to + 1);
    ctx.save();
    if (o.dots) {
      // the stop and reverse: a dot per bar, fading in from the left like the lines
      const r = Math.max(1, o.lineWidth * 1.05 * hr);
      ctx.fillStyle = o.lineColor;
      for (let i = from; i < to; i++) {
        const v = d.bars[i].originalData?.value;
        if (v === undefined || !Number.isFinite(v)) continue;
        const y = p2c(v);
        if (y === null) continue;
        const x = barX(d, i) * hr;
        ctx.globalAlpha = fadeAt(x, bitmapSize.width, o.fade, 0.6);
        ctx.beginPath();
        ctx.arc(x, y * vr, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let started = false;
    for (let i = from; i < to; i++) {
      const b = d.bars[i];
      const v = b.originalData?.value;
      if (v === undefined || !Number.isFinite(v)) {
        started = false;
        continue;
      }
      const y = p2c(v);
      if (y === null) continue;
      const x = barX(d, i) * hr;
      if (!started) {
        ctx.moveTo(x, y * vr);
        started = true;
      } else ctx.lineTo(x, y * vr);
    }
    if (o.dashed) ctx.setLineDash([4 * hr, 4 * hr]);
    if (o.halo > 0) {
      ctx.globalAlpha = o.halo;
      ctx.strokeStyle = o.lineColor;
      ctx.lineWidth = (o.lineWidth + 3.5) * hr;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (o.fade < 1) {
      const g = ctx.createLinearGradient(0, 0, bitmapSize.width, 0);
      g.addColorStop(0, withAlpha(o.lineColor, o.fade));
      g.addColorStop(0.6, withAlpha(o.lineColor, o.fade + (1 - o.fade) * 0.7));
      g.addColorStop(1, o.lineColor);
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = o.lineColor;
    ctx.lineWidth = Math.max(1, o.lineWidth * hr);
    ctx.stroke();
    ctx.restore();
  }
}

export class GlowLineSeries implements ICustomSeriesPaneView<Time, GlowPoint, GlowLineOptions> {
  private r = new GlowLineRenderer();
  renderer() {
    return this.r;
  }
  update(data: PaneRendererCustomData<Time, GlowPoint>, opts: GlowLineOptions) {
    this.r.update(data, opts);
  }
  priceValueBuilder(p: GlowPoint) {
    return [p.value ?? NaN];
  }
  isWhitespace(p: GlowPoint | CustomSeriesWhitespaceData<Time>): p is CustomSeriesWhitespaceData<Time> {
    const v = (p as GlowPoint).value;
    return v === undefined || !Number.isFinite(v);
  }
  defaultOptions() {
    return LINE_DEFAULTS;
  }
  destroy() {}
}

/* ---------- band (bollinger) ---------- */

export interface BandPoint extends CustomData<Time> {
  upper?: number;
  mid?: number;
  lower?: number;
}

export interface BandOptions extends CustomSeriesOptions {
  lineColor: string;
  fillAlpha: number;
}

const BAND_DEFAULTS: BandOptions = { ...customSeriesDefaultOptions, lineColor: "#8b98a5", fillAlpha: 0.07 };

class BandRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, BandPoint> | null = null;
  private opts: BandOptions | null = null;
  update(data: PaneRendererCustomData<Time, BandPoint>, opts: BandOptions) {
    this.data = data;
    this.opts = opts;
  }
  draw(target: Target, p2c: PriceToCoordinateConverter) {
    target.useBitmapCoordinateSpace((scope) => this.paint(scope, p2c));
  }
  private paint(scope: Scope, p2c: PriceToCoordinateConverter) {
    const d = this.data;
    const o = this.opts;
    if (!d || !o || !d.visibleRange || d.bars.length === 0) return;
    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope;
    if (d.visibleRange.from >= d.visibleRange.to) return;
    const from = Math.max(0, d.visibleRange.from - 1);
    const to = Math.min(d.bars.length, d.visibleRange.to + 1);
    const up: [number, number][] = [];
    const lo: [number, number][] = [];
    const mid: [number, number][] = [];
    for (let i = from; i < to; i++) {
      const b = d.bars[i];
      const p = b.originalData;
      if (!p || p.upper === undefined || p.lower === undefined || p.mid === undefined) continue;
      const yu = p2c(p.upper);
      const yl = p2c(p.lower);
      const ym = p2c(p.mid);
      if (yu === null || yl === null || ym === null) continue;
      const x = barX(d, i) * hr;
      up.push([x, yu * vr]);
      lo.push([x, yl * vr]);
      mid.push([x, ym * vr]);
    }
    if (up.length < 2) return;
    ctx.save();
    // cloud
    ctx.beginPath();
    up.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = lo.length - 1; i >= 0; i--) ctx.lineTo(lo[i][0], lo[i][1]);
    ctx.closePath();
    ctx.fillStyle = withAlpha(o.lineColor, o.fillAlpha);
    ctx.fill();
    // edges
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, hr);
    ctx.strokeStyle = withAlpha(o.lineColor, 0.75);
    for (const pts of [up, lo]) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    // basis
    ctx.setLineDash([3 * hr, 4 * hr]);
    ctx.strokeStyle = withAlpha(o.lineColor, 0.55);
    ctx.beginPath();
    mid.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }
}

export class BandSeries implements ICustomSeriesPaneView<Time, BandPoint, BandOptions> {
  private r = new BandRenderer();
  renderer() {
    return this.r;
  }
  update(data: PaneRendererCustomData<Time, BandPoint>, opts: BandOptions) {
    this.r.update(data, opts);
  }
  priceValueBuilder(p: BandPoint) {
    return [p.upper ?? NaN, p.lower ?? NaN, p.mid ?? NaN];
  }
  isWhitespace(p: BandPoint | CustomSeriesWhitespaceData<Time>): p is CustomSeriesWhitespaceData<Time> {
    const b = p as BandPoint;
    return b.upper === undefined || b.lower === undefined || b.mid === undefined || !Number.isFinite(b.upper) || !Number.isFinite(b.lower);
  }
  defaultOptions() {
    return BAND_DEFAULTS;
  }
  destroy() {}
}

/* ---------- soft volume ---------- */

export interface VolPoint extends CustomData<Time> {
  value?: number;
  up?: boolean;
}

export interface SoftVolumeOptions extends CustomSeriesOptions {
  upColor: string;
  downColor: string;
  /** alpha at the top of a bar; it fades toward the baseline */
  topAlpha: number;
  bottomAlpha: number;
}

const VOL_DEFAULTS: SoftVolumeOptions = { ...customSeriesDefaultOptions, upColor: "#45e3a6", downColor: "#ff5a5c", topAlpha: 0.34, bottomAlpha: 0.04 };

class SoftVolumeRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, VolPoint> | null = null;
  private opts: SoftVolumeOptions | null = null;
  update(data: PaneRendererCustomData<Time, VolPoint>, opts: SoftVolumeOptions) {
    this.data = data;
    this.opts = opts;
  }
  draw(target: Target, p2c: PriceToCoordinateConverter) {
    target.useBitmapCoordinateSpace((scope) => this.paint(scope, p2c));
  }
  private paint(scope: Scope, p2c: PriceToCoordinateConverter) {
    const d = this.data;
    const o = this.opts;
    if (!d || !o || !d.visibleRange || d.bars.length === 0) return;
    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize } = scope;
    const base = p2c(0);
    if (base === null) return;
    const yb = Math.round(base * vr);
    const spacing = d.barSpacing * (d.conflationFactor || 1) * hr;
    // slimmer than the candles above them, so the volume reads as air, not a second chart
    const w = Math.max(1, Math.floor(spacing * (spacing > 6 * hr ? 0.6 : 0.8)));
    const lit = w >= 3 * hr;
    const cap = Math.min(1, o.topAlpha * 1.8);
    const cols = {
      up: [withAlpha(o.upColor, o.topAlpha), withAlpha(o.upColor, o.bottomAlpha), withAlpha(o.upColor, cap)],
      down: [withAlpha(o.downColor, o.topAlpha), withAlpha(o.downColor, o.bottomAlpha), withAlpha(o.downColor, cap)],
    };
    ctx.save();
    for (let i = Math.max(0, d.visibleRange.from); i < Math.min(d.bars.length, d.visibleRange.to); i++) {
      const b = d.bars[i];
      const v = b.originalData?.value;
      if (v === undefined || !(v > 0)) continue;
      const y = p2c(v);
      if (y === null) continue;
      const top = Math.round(y * vr);
      const h = Math.max(1, yb - top);
      const x = Math.round(b.x * hr) - Math.floor(w / 2);
      const [c0, c1, c2] = b.originalData.up === false ? cols.down : cols.up;
      ctx.globalAlpha = fadeAt(x, bitmapSize.width, 0.6, 0.24);
      if (lit && h > 2) {
        const g = ctx.createLinearGradient(0, top, 0, yb);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ctx.fillStyle = g;
      } else ctx.fillStyle = c0;
      ctx.fillRect(x, top, w, h);
      // a lit cap on wide bars, like the rim of the panels
      if (lit && h > 3) {
        ctx.fillStyle = c2;
        ctx.fillRect(x, top, w, Math.max(1, Math.round(vr)));
      }
    }
    ctx.restore();
  }
}

export class SoftVolumeSeries implements ICustomSeriesPaneView<Time, VolPoint, SoftVolumeOptions> {
  private r = new SoftVolumeRenderer();
  renderer() {
    return this.r;
  }
  update(data: PaneRendererCustomData<Time, VolPoint>, opts: SoftVolumeOptions) {
    this.r.update(data, opts);
  }
  priceValueBuilder(p: VolPoint) {
    return [0, p.value ?? 0];
  }
  isWhitespace(p: VolPoint | CustomSeriesWhitespaceData<Time>): p is CustomSeriesWhitespaceData<Time> {
    return (p as VolPoint).value === undefined;
  }
  defaultOptions() {
    return VOL_DEFAULTS;
  }
  destroy() {}
}

/* ---------- soft histogram (macd): signed around zero, in the volume's language ---------- */

export interface HistPoint extends CustomData<Time> {
  value?: number;
}

export interface SoftHistOptions extends CustomSeriesOptions {
  upColor: string;
  downColor: string;
  /** alpha at a bar's tip; it fades toward zero */
  tipAlpha: number;
  baseAlpha: number;
}

const HIST_DEFAULTS: SoftHistOptions = { ...customSeriesDefaultOptions, upColor: "#45e3a6", downColor: "#ff5a5c", tipAlpha: 0.78, baseAlpha: 0.14 };

class SoftHistRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, HistPoint> | null = null;
  private opts: SoftHistOptions | null = null;
  update(data: PaneRendererCustomData<Time, HistPoint>, opts: SoftHistOptions) {
    this.data = data;
    this.opts = opts;
  }
  draw(target: Target, p2c: PriceToCoordinateConverter) {
    target.useBitmapCoordinateSpace((scope) => this.paint(scope, p2c));
  }
  private paint(scope: Scope, p2c: PriceToCoordinateConverter) {
    const d = this.data;
    const o = this.opts;
    if (!d || !o || !d.visibleRange || d.bars.length === 0) return;
    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize } = scope;
    const zero = p2c(0);
    if (zero === null) return;
    const yz = Math.round(zero * vr);
    const spacing = d.barSpacing * (d.conflationFactor || 1) * hr;
    const w = Math.max(1, Math.floor(spacing * (spacing > 6 * hr ? 0.62 : 0.82)));
    const lit = w >= 3 * hr;
    ctx.save();
    for (let i = Math.max(0, d.visibleRange.from); i < Math.min(d.bars.length, d.visibleRange.to); i++) {
      const b = d.bars[i];
      const v = b.originalData?.value;
      if (v === undefined || !Number.isFinite(v)) continue;
      const y = p2c(v);
      if (y === null) continue;
      const yt = Math.round(y * vr);
      const up = v >= 0;
      // tradingview's reading: a bar that grows on the last one is lit, one that shrinks steps back
      const prev = i > 0 ? d.bars[i - 1].originalData?.value : undefined;
      const k = prev === undefined || !Number.isFinite(prev) || Math.abs(v) >= Math.abs(prev) ? 1 : 0.5;
      const c = up ? o.upColor : o.downColor;
      const top = Math.min(yt, yz);
      const h = Math.max(1, Math.abs(yz - yt));
      const x = Math.round(b.x * hr) - Math.floor(w / 2);
      ctx.globalAlpha = fadeAt(x, bitmapSize.width, 0.6, 0.24);
      if (lit && h > 2) {
        const g = ctx.createLinearGradient(0, yt, 0, yz);
        g.addColorStop(0, withAlpha(c, o.tipAlpha * k));
        g.addColorStop(1, withAlpha(c, o.baseAlpha * k));
        ctx.fillStyle = g;
      } else ctx.fillStyle = withAlpha(c, o.tipAlpha * k);
      ctx.fillRect(x, top, w, h);
      // the lit rim at the tip, like the volume's caps
      if (lit && h > 3) {
        ctx.fillStyle = withAlpha(c, Math.min(1, o.tipAlpha * 1.25 * k));
        ctx.fillRect(x, up ? yt : yt - Math.max(1, Math.round(vr)), w, Math.max(1, Math.round(vr)));
      }
    }
    ctx.restore();
  }
}

export class SoftHistSeries implements ICustomSeriesPaneView<Time, HistPoint, SoftHistOptions> {
  private r = new SoftHistRenderer();
  renderer() {
    return this.r;
  }
  update(data: PaneRendererCustomData<Time, HistPoint>, opts: SoftHistOptions) {
    this.r.update(data, opts);
  }
  priceValueBuilder(p: HistPoint) {
    // zero stays in the pane's range; the reading (last) is the bar's value
    return [0, p.value ?? 0];
  }
  isWhitespace(p: HistPoint | CustomSeriesWhitespaceData<Time>): p is CustomSeriesWhitespaceData<Time> {
    const v = (p as HistPoint).value;
    return v === undefined || !Number.isFinite(v);
  }
  defaultOptions() {
    return HIST_DEFAULTS;
  }
  destroy() {}
}

/* ---------- level band: an oscillator's reference zone (rsi 30-70, stoch 20-80) ---------- */

/**
 * a series primitive on an oscillator's first line: a faint tint between its outer reference levels
 * (the dashed levels themselves are the series' price lines), brightening toward "now" like the lines.
 * its autoscale range keeps the levels in view, as tradingview's oscillator panes do.
 */
export class LevelBand implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private request: (() => void) | null = null;
  /** follows the series' visibility (the legend's eye): bottom primitives are drawn for hidden series too */
  private on = true;
  private readonly lo: number;
  private readonly hi: number;
  private readonly view: IPrimitivePaneView;
  constructor(
    levels: number[],
    private color: string,
    private alpha: number,
  ) {
    this.lo = Math.min(...levels);
    this.hi = Math.max(...levels);
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.paint(target as Target) };
    this.view = { zOrder: () => "bottom", renderer: () => renderer };
  }
  attached(p: SeriesAttachedParameter<Time, SeriesType>) {
    this.series = p.series;
    this.request = p.requestUpdate;
  }
  detached() {
    this.series = null;
    this.request = null;
  }
  setColor(color: string, alpha: number) {
    if (color === this.color && alpha === this.alpha) return;
    this.color = color;
    this.alpha = alpha;
    this.request?.();
  }
  setVisible(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.request?.();
  }
  paneViews() {
    return [this.view];
  }
  autoscaleInfo(): AutoscaleInfo | null {
    return Number.isFinite(this.lo) && Number.isFinite(this.hi) ? { priceRange: { minValue: this.lo, maxValue: this.hi } } : null;
  }
  private paint(target: Target) {
    const s = this.series;
    if (!s || !this.on || this.hi <= this.lo || this.alpha <= 0) return;
    const y1 = s.priceToCoordinate(this.hi);
    const y2 = s.priceToCoordinate(this.lo);
    if (y1 === null || y2 === null) return;
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vr, bitmapSize }) => {
      const top = Math.round(Math.min(y1, y2) * vr);
      const h = Math.round(Math.abs(y2 - y1) * vr);
      if (h < 1) return;
      const g = ctx.createLinearGradient(0, 0, bitmapSize.width, 0);
      g.addColorStop(0, withAlpha(this.color, this.alpha * 0.45));
      g.addColorStop(1, withAlpha(this.color, this.alpha));
      ctx.fillStyle = g;
      ctx.fillRect(0, top, bitmapSize.width, h);
    });
  }
}
