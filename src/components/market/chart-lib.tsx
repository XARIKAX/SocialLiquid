import { INDICATOR_DEFS, ema, vwap, type IndicatorDef } from "@/lib/indicators";

/* =====================================================================
   pure helpers for the terminal chart: intervals, formatting, heikin
   ashi, the indicator catalogue (the shared library's definitions, see
   src/lib/indicators.ts, with the chart's presentation on top), and
   guarded preference storage. no react, no lightweight-charts.
   ===================================================================== */

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
/** [interval, toolbar label, spoken name] in tradingview order */
export const INTERVALS: [Interval, string, string][] = [
  ["1m", "1m", "1 minute"],
  ["5m", "5m", "5 minutes"],
  ["15m", "15m", "15 minutes"],
  ["1h", "1h", "1 hour"],
  ["4h", "4h", "4 hours"],
  ["1d", "1D", "1 day"],
  ["1w", "1W", "1 week"],
];
export const INTERVAL_SEC: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
export const intervalLabel = (iv: Interval) => INTERVALS.find((x) => x[0] === iv)?.[1] ?? iv;

/** range buttons, ascending like tradingview: label -> [interval, bars, spoken] */
export const RANGES: [string, Interval, number, string][] = [
  ["1D", "5m", 288, "1 day of 5 minute bars"],
  ["5D", "15m", 480, "5 days of 15 minute bars"],
  ["1M", "1h", 720, "1 month of hourly bars"],
  ["3M", "4h", 540, "3 months of 4 hour bars"],
  ["6M", "1d", 180, "6 months of daily bars"],
  ["1Y", "1d", 365, "1 year of daily bars"],
  ["5Y", "1w", 260, "5 years of weekly bars"],
];
export const rangeBars = (n: number) => Math.min(1000, n + 20);

export type ChartType = "candles" | "bars" | "line" | "area" | "ha";
export const CHART_TYPES: [ChartType, string, string][] = [
  ["candles", "Candles", "Classic candlesticks"],
  ["bars", "Bars", "OHLC bars"],
  ["line", "Line", "Closing prices"],
  ["area", "Area", "Closing prices, filled"],
  ["ha", "Heikin Ashi", "Smoothed candles"],
];

/* ---------- indicators: one catalogue, the shared library's ---------- */

/** an indicator id from the catalogue below ("rsi", "macd", "ema20", ...) */
export type Ind = string;
export type IndDef = IndicatorDef;

/** ema 20, the terminal's default average (drawn with the mock's halo). the library's ema; its list has 9 / 21 / 50 / 200 */
const EMA20: IndicatorDef = { id: "ema20", name: "EMA 20", pane: "price", lines: [{ key: "v", color: "#4de3c1" }], compute: (c) => ({ v: ema(c.map((x) => x.close), 20) }) };

/** what the indicator menu offers: the library's catalogue in its order, with ema 20 beside its siblings */
export const IND_DEFS: IndicatorDef[] = (() => {
  const out = [...INDICATOR_DEFS];
  if (!out.some((d) => d.id === EMA20.id)) {
    const at = out.findIndex((d) => d.id === "ema21");
    out.splice(at < 0 ? out.length : at, 0, EMA20);
  }
  return out;
})();
const DEF_BY_ID = new Map(IND_DEFS.map((d) => [d.id, d]));
export const indDef = (id: string) => DEF_BY_ID.get(id);
export const isInd = (x: unknown): x is Ind => typeof x === "string" && DEF_BY_ID.has(x);

/** how a value reads: prices ("px"), price distances ("dpx": macd, atr), bounded oscillators ("osc"), volume ("vol") */
export type IndFmt = "px" | "dpx" | "osc" | "vol";
/** the chart's presentation of a catalogue entry: a short legend name, its parameters, how it draws, how its numbers read */
export type IndLook = { short: string; params: string; desc: string; draw: "lines" | "band" | "dots"; fmt: IndFmt };
const LOOK: Record<string, Partial<IndLook>> = {
  sma9: { desc: "Simple moving average" },
  sma20: { desc: "Simple moving average" },
  sma50: { desc: "Simple moving average" },
  sma100: { desc: "Simple moving average" },
  sma200: { desc: "Simple moving average" },
  ema9: { desc: "Exponential moving average" },
  ema20: { desc: "Exponential moving average" },
  ema21: { desc: "Exponential moving average" },
  ema50: { desc: "Exponential moving average" },
  ema200: { desc: "Exponential moving average" },
  wma20: { desc: "Weighted moving average" },
  bb: { short: "BB", desc: "Bands at two standard deviations", draw: "band" },
  vwap: { desc: "Volume weighted average price, UTC day anchor" },
  supertrend: { desc: "ATR trailing stop, trend" },
  psar: { short: "SAR", desc: "Parabolic stop and reverse", draw: "dots" },
  donchian: { short: "DC", desc: "Highest high, lowest low channel", draw: "band" },
  ichimoku: { short: "Ichimoku", desc: "Tenkan, kijun and cloud spans" },
  rsi: { desc: "Relative strength index, momentum" },
  macd: { desc: "Moving average convergence divergence, momentum", fmt: "dpx" },
  stoch: { short: "Stoch", desc: "Stochastic oscillator, momentum" },
  stochrsi: { short: "Stoch RSI", desc: "Stochastic of the RSI, momentum" },
  atr: { desc: "Average true range, volatility", fmt: "dpx" },
  obv: { short: "OBV", desc: "On-balance volume, volume flow", fmt: "vol" },
  cci: { desc: "Commodity channel index, momentum" },
  willr: { short: "%R", desc: "Williams percent range, momentum" },
  mfi: { short: "MFI", desc: "Money flow index, volume-weighted RSI" },
};
/** "Bollinger Bands 20·2" -> ["Bollinger Bands", "20·2"]: the name and its parameters, for the mono micro label */
export function splitIndName(name: string): [string, string] {
  const m = /^(.*?)\s+(\d[\d·.,]*)$/.exec(name);
  return m ? [m[1], m[2]] : [name, ""];
}
const lookCache = new Map<string, IndLook>();
export function indLook(d: IndicatorDef): IndLook {
  let l = lookCache.get(d.id);
  if (!l) {
    const [title, params] = splitIndName(d.name);
    l = { short: title, params, desc: "", draw: "lines", fmt: d.pane === "own" ? "osc" : "px", ...LOOK[d.id] };
    lookCache.set(d.id, l);
  }
  return l;
}
/** the menu's search: the name, the legend name, or what it measures ("momentum", "moving average", "bb") */
export function indMatches(d: IndicatorDef, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const l = indLook(d);
  return d.name.toLowerCase().includes(s) || l.short.toLowerCase().includes(s) || l.desc.toLowerCase().includes(s) || d.id.includes(s);
}
/** "#rrggbb" toward black by k (0..1): the catalogue's bright inks, readable on paper */
function deepen(hex: string, k: number) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (x: number) => Math.round(x * (1 - k)).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
/**
 * a line's colour on this theme: the palette's tuned colour for the averages the terminal shipped with
 * (both themes were designed for them), else the catalogue's colour, deepened a little on paper
 */
export function indColor(d: IndicatorDef, line: number, tuned: Record<string, string>, light: boolean): string {
  const t = line === 0 ? tuned[d.id] : undefined;
  if (t) return t;
  const base = d.lines[line]?.color ?? d.lines[0]?.color ?? "#8b98a5";
  return light ? deepen(base, 0.28) : base;
}

/* ---------- numbers ---------- */

/** decimals the price axis and legend use for a market at this price */
export function precisionFor(px: number) {
  const a = Math.abs(px);
  if (a >= 1000) return 1;
  if (a >= 1) return 3;
  if (a >= 0.01) return 5;
  return 8;
}

const nfCache = new Map<number, Intl.NumberFormat>();
function nf(d: number) {
  let f = nfCache.get(d);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    nfCache.set(d, f);
  }
  return f;
}
export const fmtFixed = (v: number, d: number) => nf(d).format(v);

/** axis tick labels: as few decimals as the ticks need ("112,000", "43.25"), never a negative price */
export function tickLabels(prices: number[], precision: number): string[] {
  let d = 0;
  for (; d < precision; d++) {
    const k = Math.pow(10, d);
    if (prices.every((p) => Math.abs(p * k - Math.round(p * k)) < 1e-6)) break;
  }
  return prices.map((p) => (p < 0 ? "" : nf(d).format(p)));
}

export function fmtCompact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

export function fmtSigned(v: number, d: number) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtFixed(Math.abs(v), d)}`;
}

/* ---------- time ---------- */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** crosshair time label, tradingview style: "Sun 12 Oct '26  14:00" */
export function fmtCrossTime(sec: number, intraday: boolean) {
  const d = new Date(sec * 1000);
  const day = `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
  return intraday ? `${day}  ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : day;
}

/** time-axis ticks, as the mock prints them: "Oct 12", "12:00", "Oct", "2026" (type: 0 year, 1 month, 2 day, 3-4 time) */
export function fmtTick(sec: number, type: number) {
  const d = new Date(sec * 1000);
  if (type === 0) return String(d.getUTCFullYear());
  if (type === 1) return MON[d.getUTCMonth()];
  if (type === 2) return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (type === 4) return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** time left on the live bar: "42:07", "03:42:07", "4d 11h" */
export function fmtCountdown(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${p2(h)}h`;
  if (h > 0) return `${p2(h)}:${p2(m)}:${p2(s % 60)}`;
  return `${p2(m)}:${p2(s % 60)}`;
}

export function fmtSpan(sec: number) {
  const m = Math.round(Math.abs(sec) / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** index of the bar that contains time t (seconds): the last bar starting at or before t */
export function barIndexAt(c: { time: number }[], t: number) {
  let lo = 0;
  let hi = c.length - 1;
  if (hi < 0 || t < c[0].time) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ---------- heikin ashi ---------- */

export function haNext(prev: Candle | undefined, c: Candle): Candle {
  const close = (c.open + c.high + c.low + c.close) / 4;
  const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
  return { time: c.time, open, close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close), volume: c.volume };
}

export function heikinAshi(c: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < c.length; i++) out.push(haNext(out[i - 1], c[i]));
  return out;
}

/* ---------- indicator values (aligned 1:1 with the candles; NaN until warmed up) ---------- */

/**
 * vwap anchored as tradingview anchors it: each utc day (session) on intraday charts, the first loaded
 * bar on daily and weekly ones. the sum is the library's vwap, restarted per session.
 */
function sessionVwap(c: Candle[], intervalSec: number): number[] {
  if (intervalSec >= 86400) return vwap(c);
  const out: number[] = [];
  for (let i = 0; i < c.length; ) {
    const day = Math.floor(c[i].time / 86400);
    let j = i + 1;
    while (j < c.length && Math.floor(c[j].time / 86400) === day) j++;
    for (const v of vwap(c.slice(i, j))) out.push(v);
    i = j;
  }
  return out;
}

/** one indicator's lines over the candles: line key -> values. throws if the definition does */
export function computeInd(d: IndicatorDef, c: Candle[], intervalSec: number): Record<string, number[]> {
  if (d.id === "vwap") return { v: sessionVwap(c, intervalSec) };
  return d.compute(c);
}

/** every selected indicator's lines: id -> line key -> values. an indicator that fails to compute is left out */
export type IndData = Record<Ind, Record<string, number[]>>;
export function computeIndicators(c: Candle[] | undefined, inds: Ind[], intervalSec: number): IndData {
  const out: IndData = {};
  if (!c?.length) return out;
  for (const id of inds) {
    const d = indDef(id);
    if (!d) continue;
    try {
      out[id] = computeInd(d, c, intervalSec);
    } catch {}
  }
  return out;
}

/** the indicators' readings on the live bar: id -> line key -> value */
export type IndLive = Record<Ind, Record<string, number>>;

/**
 * indicator values on the live bar, as tradingview keeps them: the series recomputed with the streaming
 * close in place of the last bar (idx = n - 1), or appended as a new bar (idx = n). the mids tick every
 * few seconds; a full pass over 400 bars costs well under a millisecond per indicator.
 */
export function liveIndicatorValues(c: Candle[], inds: Ind[], live: Candle, idx: number, intervalSec: number): IndLive {
  const out: IndLive = {};
  const n = c.length;
  if (!n || !inds.length || idx < n - 1 || idx > n) return out;
  const cs = idx === n ? [...c, live] : [...c.slice(0, n - 1), live];
  for (const id of inds) {
    const d = indDef(id);
    if (!d) continue;
    let s: Record<string, number[]>;
    try {
      s = computeInd(d, cs, intervalSec);
    } catch {
      continue;
    }
    const row: Record<string, number> = {};
    for (const l of d.lines) {
      const v = s[l.key]?.[idx];
      if (v !== undefined && Number.isFinite(v)) row[l.key] = v;
    }
    out[id] = row;
  }
  return out;
}

/** a value as its legend and axis print it */
export function fmtInd(v: number, fmt: IndFmt, prec: number): string {
  if (!Number.isFinite(v)) return "–";
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (fmt === "vol") s = fmtCompact(a);
  else if (fmt === "px") s = fmtFixed(a, prec);
  else if (fmt === "dpx") s = fmtFixed(a, Math.min(8, prec + 1));
  else s = a >= 10_000 ? fmtCompact(a) : fmtFixed(a, 2);
  return neg && /[1-9]/.test(s) ? `−${s}` : s;
}
/** decimals an oscillator's axis needs (its minMove) */
export const indDecimals = (fmt: IndFmt, prec: number) => (fmt === "px" ? prec : fmt === "dpx" ? Math.min(8, prec + 1) : fmt === "vol" ? 0 : 2);

/* ---------- preferences (private windows and blocked storage are fine) ---------- */

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
