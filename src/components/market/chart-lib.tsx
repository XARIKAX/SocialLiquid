/* =====================================================================
   pure helpers for the terminal chart: intervals, formatting, heikin
   ashi, indicators (aligned 1:1 with the candles, NaN before warm-up),
   and guarded preference storage. no react, no lightweight-charts.
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

export type Ind = "ema20" | "ema50" | "sma20" | "sma50" | "sma200" | "bb" | "vwap";
export const INDICATORS: { id: Ind; label: string; short: string; desc: string }[] = [
  { id: "ema20", label: "EMA 20", short: "EMA 20", desc: "Exponential moving average" },
  { id: "ema50", label: "EMA 50", short: "EMA 50", desc: "Exponential moving average" },
  { id: "sma20", label: "SMA 20", short: "SMA 20", desc: "Simple moving average" },
  { id: "sma50", label: "SMA 50", short: "SMA 50", desc: "Simple moving average" },
  { id: "sma200", label: "SMA 200", short: "SMA 200", desc: "Simple moving average" },
  { id: "bb", label: "Bollinger 20 · 2", short: "BB 20·2", desc: "Bands at two standard deviations" },
  { id: "vwap", label: "VWAP", short: "VWAP", desc: "Volume weighted, UTC day anchor" },
];
export const IND_IDS = INDICATORS.map((x) => x.id);

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

/* ---------- indicators (aligned with candles; NaN until warmed up) ---------- */

export function sma(v: number[], n: number) {
  const out = new Array<number>(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** tradingview's ema: seeded with the sma of the first n closes */
export function ema(v: number[], n: number) {
  const out = new Array<number>(v.length).fill(NaN);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += v[i];
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < v.length; i++) out[i] = e = v[i] * k + e * (1 - k);
  return out;
}

function stdev(v: number[], n: number, mean: number[]) {
  return v.map((_, i) => {
    if (i + 1 < n || !Number.isFinite(mean[i])) return NaN;
    let s = 0;
    for (let j = i + 1 - n; j <= i; j++) s += (v[j] - mean[i]) ** 2;
    return Math.sqrt(s / n);
  });
}

export type IndLine = { kind: "line"; values: number[] };
export type IndBand = { kind: "band"; upper: number[]; mid: number[]; lower: number[] };
export type IndData = Partial<Record<Ind, IndLine | IndBand>>;

export function computeIndicators(c: Candle[] | undefined, inds: Ind[], intervalSec: number): IndData {
  const out: IndData = {};
  if (!c?.length) return out;
  const closes = c.map((x) => x.close);
  for (const id of inds) {
    if (id === "ema20") out[id] = { kind: "line", values: ema(closes, 20) };
    if (id === "ema50") out[id] = { kind: "line", values: ema(closes, 50) };
    if (id === "sma20") out[id] = { kind: "line", values: sma(closes, 20) };
    if (id === "sma50") out[id] = { kind: "line", values: sma(closes, 50) };
    if (id === "sma200") out[id] = { kind: "line", values: sma(closes, 200) };
    if (id === "bb") {
      const m = sma(closes, 20);
      const sd = stdev(closes, 20, m);
      out[id] = { kind: "band", mid: m, upper: m.map((x, i) => x + 2 * sd[i]), lower: m.map((x, i) => x - 2 * sd[i]) };
    }
    if (id === "vwap") {
      // anchored to the utc day on intraday charts, to the first loaded bar otherwise
      const anchorDay = intervalSec < 86400;
      let pv = 0;
      let vv = 0;
      let day = -1;
      out[id] = {
        kind: "line",
        values: c.map((x) => {
          const d = Math.floor(x.time / 86400);
          if (anchorDay && d !== day) {
            day = d;
            pv = 0;
            vv = 0;
          }
          const tp = (x.high + x.low + x.close) / 3;
          pv += tp * x.volume;
          vv += x.volume;
          return vv ? pv / vv : NaN;
        }),
      };
    }
  }
  return out;
}

/** one indicator reading: a line value, or a band's three */
export type IndValue = number | { upper: number; mid: number; lower: number };

/**
 * indicator values on the live bar, as tradingview keeps them: the fetched series with the
 * streaming close in place of the last bar (idx = n - 1), or appended as a new bar (idx = n).
 * incremental, so a tick costs a few window sums, not a full recompute.
 */
export function liveIndicatorValues(c: Candle[], ind: IndData, inds: Ind[], live: Candle, idx: number, intervalSec: number): Partial<Record<Ind, IndValue>> {
  const out: Partial<Record<Ind, IndValue>> = {};
  const n = c.length;
  if (!n || idx < n - 1 || idx > n) return out;
  const close = (i: number) => (i === idx ? live.close : c[i].close);
  const windowStats = (len: number) => {
    if (idx + 1 < len) return null;
    let s = 0;
    for (let i = idx - len + 1; i <= idx; i++) s += close(i);
    const mean = s / len;
    let v = 0;
    for (let i = idx - len + 1; i <= idx; i++) v += (close(i) - mean) ** 2;
    return { mean, sd: Math.sqrt(v / len) };
  };
  for (const id of inds) {
    const d = ind[id];
    if (!d) continue;
    if (id === "ema20" || id === "ema50") {
      const len = id === "ema20" ? 20 : 50;
      const prev = d.kind === "line" ? d.values[idx - 1] : NaN;
      if (Number.isFinite(prev)) out[id] = live.close * (2 / (len + 1)) + prev * (1 - 2 / (len + 1));
    } else if (id === "sma20" || id === "sma50" || id === "sma200") {
      const w = windowStats(id === "sma20" ? 20 : id === "sma50" ? 50 : 200);
      if (w) out[id] = w.mean;
    } else if (id === "bb") {
      const w = windowStats(20);
      if (w) out[id] = { upper: w.mean + 2 * w.sd, mid: w.mean, lower: w.mean - 2 * w.sd };
    } else if (id === "vwap") {
      // the anchored sums up to the live bar, its typical price taken from the streaming high/low/close
      const anchorDay = intervalSec < 86400;
      const day = Math.floor(live.time / 86400);
      let pv = 0;
      let vv = 0;
      for (let i = idx; i >= 0; i--) {
        const x = i === idx ? live : c[i];
        if (anchorDay && Math.floor(x.time / 86400) !== day) break;
        pv += ((x.high + x.low + x.close) / 3) * x.volume;
        vv += x.volume;
      }
      if (vv > 0) out[id] = pv / vv;
    }
  }
  return out;
}

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
