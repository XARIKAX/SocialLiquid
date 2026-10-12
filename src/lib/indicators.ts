/**
 * technical indicators over ohlcv arrays. pure functions, NaN where a value is not defined yet.
 * overlays draw on the price pane; oscillators get their own pane.
 */
export type Ohlcv = { time: number; open: number; high: number; low: number; close: number; volume: number };

export const sma = (v: number[], n: number) => {
  const out = new Array<number>(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
};
export const ema = (v: number[], n: number) => {
  const k = 2 / (n + 1);
  const out = new Array<number>(v.length).fill(NaN);
  let e = NaN;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    e = Number.isFinite(e) ? v[i] * k + e * (1 - k) : v[i];
    out[i] = e;
  }
  return out;
};
export const wma = (v: number[], n: number) => {
  const out = new Array<number>(v.length).fill(NaN);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += v[i - j] * (n - j);
    out[i] = s / denom;
  }
  return out;
};
export const stdev = (v: number[], n: number, mean: number[]) => {
  const out = new Array<number>(v.length).fill(NaN);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = i + 1 - n; j <= i; j++) s += (v[j] - mean[i]) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
};
export const bollinger = (close: number[], n = 20, k = 2) => {
  const mid = sma(close, n);
  const sd = stdev(close, n, mid);
  return { mid, upper: mid.map((m, i) => m + k * sd[i]), lower: mid.map((m, i) => m - k * sd[i]) };
};
export const vwap = (c: Ohlcv[]) => {
  let pv = 0;
  let vv = 0;
  return c.map((x) => {
    const tp = (x.high + x.low + x.close) / 3;
    pv += tp * x.volume;
    vv += x.volume;
    return vv ? pv / vv : NaN;
  });
};
export const trueRange = (c: Ohlcv[]) => c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
/** wilder smoothing (rma) */
export const rma = (v: number[], n: number) => {
  const out = new Array<number>(v.length).fill(NaN);
  let s = 0;
  let count = 0;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    count++;
    if (count < n) s += v[i];
    else if (count === n) {
      s += v[i];
      out[i] = s / n;
    } else out[i] = (out[i - 1] * (n - 1) + v[i]) / n;
  }
  return out;
};
export const atr = (c: Ohlcv[], n = 14) => rma(trueRange(c), n);
export const rsi = (close: number[], n = 14) => {
  const gains = close.map((x, i) => (i === 0 ? NaN : Math.max(0, x - close[i - 1])));
  const losses = close.map((x, i) => (i === 0 ? NaN : Math.max(0, close[i - 1] - x)));
  const ag = rma(gains, n);
  const al = rma(losses, n);
  return ag.map((g, i) => (Number.isFinite(g) && Number.isFinite(al[i]) ? (al[i] === 0 ? 100 : 100 - 100 / (1 + g / al[i])) : NaN));
};
export const macd = (close: number[], fast = 12, slow = 26, signal = 9) => {
  const line = ema(close, fast).map((f, i) => f - ema(close, slow)[i]);
  const valid = line.map((x, i) => (i >= slow - 1 ? x : NaN));
  const sig = ema(valid, signal);
  return { line: valid, signal: sig, hist: valid.map((x, i) => x - sig[i]) };
};
export const stochastic = (c: Ohlcv[], n = 14, smoothK = 3, smoothD = 3) => {
  const raw = c.map((_, i) => {
    if (i < n - 1) return NaN;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i + 1 - n; j <= i; j++) {
      hi = Math.max(hi, c[j].high);
      lo = Math.min(lo, c[j].low);
    }
    return hi === lo ? 50 : ((c[i].close - lo) / (hi - lo)) * 100;
  });
  const k = sma(raw.map((x) => (Number.isFinite(x) ? x : 0)), smoothK).map((x, i) => (i >= n - 1 + smoothK - 1 ? x : NaN));
  const d = sma(k.map((x) => (Number.isFinite(x) ? x : 0)), smoothD).map((x, i) => (i >= n - 1 + smoothK - 1 + smoothD - 1 ? x : NaN));
  return { k, d };
};
export const obv = (c: Ohlcv[]) => {
  let v = 0;
  return c.map((x, i) => (i === 0 ? 0 : (v += x.close > c[i - 1].close ? x.volume : x.close < c[i - 1].close ? -x.volume : 0)));
};
export const cci = (c: Ohlcv[], n = 20) => {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  const m = sma(tp, n);
  return tp.map((x, i) => {
    if (i < n - 1) return NaN;
    let dev = 0;
    for (let j = i + 1 - n; j <= i; j++) dev += Math.abs(tp[j] - m[i]);
    dev /= n;
    return dev === 0 ? 0 : (x - m[i]) / (0.015 * dev);
  });
};
export const williamsR = (c: Ohlcv[], n = 14) =>
  c.map((x, i) => {
    if (i < n - 1) return NaN;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i + 1 - n; j <= i; j++) {
      hi = Math.max(hi, c[j].high);
      lo = Math.min(lo, c[j].low);
    }
    return hi === lo ? -50 : ((hi - x.close) / (hi - lo)) * -100;
  });
export const mfi = (c: Ohlcv[], n = 14) => {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  const pos = tp.map((x, i) => (i === 0 ? 0 : x > tp[i - 1] ? x * c[i].volume : 0));
  const neg = tp.map((x, i) => (i === 0 ? 0 : x < tp[i - 1] ? x * c[i].volume : 0));
  const sp = sma(pos, n);
  const sn = sma(neg, n);
  return sp.map((p, i) => (Number.isFinite(p) ? (sn[i] === 0 ? 100 : 100 - 100 / (1 + p / sn[i])) : NaN));
};
/** supertrend: returns the line and the direction (+1 up trend, -1 down) */
export const supertrend = (c: Ohlcv[], n = 10, mult = 3) => {
  const a = atr(c, n);
  const line = new Array<number>(c.length).fill(NaN);
  const dir = new Array<number>(c.length).fill(1);
  let upper = NaN;
  let lower = NaN;
  for (let i = 0; i < c.length; i++) {
    if (!Number.isFinite(a[i])) continue;
    const hl2 = (c[i].high + c[i].low) / 2;
    let bu = hl2 + mult * a[i];
    let bl = hl2 - mult * a[i];
    if (Number.isFinite(lower) && c[i - 1].close > lower) bl = Math.max(bl, lower);
    if (Number.isFinite(upper) && c[i - 1].close < upper) bu = Math.min(bu, upper);
    let d = dir[i - 1] ?? 1;
    if (Number.isFinite(upper) && c[i].close > upper) d = 1;
    else if (Number.isFinite(lower) && c[i].close < lower) d = -1;
    dir[i] = d;
    upper = bu;
    lower = bl;
    line[i] = d === 1 ? bl : bu;
  }
  return { line, dir };
};
/** parabolic sar (wilder) */
export const psar = (c: Ohlcv[], step = 0.02, max = 0.2) => {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length < 2) return out;
  let up = c[1].close >= c[0].close;
  let sar = up ? c[0].low : c[0].high;
  let ep = up ? c[0].high : c[0].low;
  let af = step;
  for (let i = 1; i < c.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, c[i - 1].low, i > 1 ? c[i - 2].low : c[i - 1].low);
      if (c[i].high > ep) {
        ep = c[i].high;
        af = Math.min(max, af + step);
      }
      if (c[i].low < sar) {
        up = false;
        sar = ep;
        ep = c[i].low;
        af = step;
      }
    } else {
      sar = Math.max(sar, c[i - 1].high, i > 1 ? c[i - 2].high : c[i - 1].high);
      if (c[i].low < ep) {
        ep = c[i].low;
        af = Math.min(max, af + step);
      }
      if (c[i].high > sar) {
        up = true;
        sar = ep;
        ep = c[i].high;
        af = step;
      }
    }
    out[i] = sar;
  }
  return out;
};
export const donchian = (c: Ohlcv[], n = 20) => {
  const upper = c.map((_, i) => (i < n - 1 ? NaN : Math.max(...c.slice(i + 1 - n, i + 1).map((x) => x.high))));
  const lower = c.map((_, i) => (i < n - 1 ? NaN : Math.min(...c.slice(i + 1 - n, i + 1).map((x) => x.low))));
  return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
};
const midRange = (c: Ohlcv[], n: number) => c.map((_, i) => (i < n - 1 ? NaN : (Math.max(...c.slice(i + 1 - n, i + 1).map((x) => x.high)) + Math.min(...c.slice(i + 1 - n, i + 1).map((x) => x.low))) / 2));
/** ichimoku (tenkan 9, kijun 26, senkou b 52); spans are not shifted forward, they are drawn at their own bar */
export const ichimoku = (c: Ohlcv[]) => {
  const tenkan = midRange(c, 9);
  const kijun = midRange(c, 26);
  const spanA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const spanB = midRange(c, 52);
  return { tenkan, kijun, spanA, spanB };
};

export type IndicatorDef = {
  id: string;
  name: string;
  /** overlay on price, or its own pane */
  pane: "price" | "own";
  /** series produced: key, colour, style (0 solid, 2 dashed), optional histogram flag */
  lines: { key: string; color: string; style?: number; histogram?: boolean }[];
  /** reference levels for own-pane oscillators */
  levels?: number[];
  compute: (c: Ohlcv[]) => Record<string, number[]>;
};

/** the catalogue the indicator menu shows (hyperliquid's chart ships tradingview's list; these are the ones traders reach for) */
export const INDICATOR_DEFS: IndicatorDef[] = [
  { id: "sma9", name: "SMA 9", pane: "price", lines: [{ key: "v", color: "#f5b236" }], compute: (c) => ({ v: sma(c.map((x) => x.close), 9) }) },
  { id: "sma20", name: "SMA 20", pane: "price", lines: [{ key: "v", color: "#f5b236" }], compute: (c) => ({ v: sma(c.map((x) => x.close), 20) }) },
  { id: "sma50", name: "SMA 50", pane: "price", lines: [{ key: "v", color: "#6b93ff" }], compute: (c) => ({ v: sma(c.map((x) => x.close), 50) }) },
  { id: "sma100", name: "SMA 100", pane: "price", lines: [{ key: "v", color: "#38bdf8" }], compute: (c) => ({ v: sma(c.map((x) => x.close), 100) }) },
  { id: "sma200", name: "SMA 200", pane: "price", lines: [{ key: "v", color: "#e879f9" }], compute: (c) => ({ v: sma(c.map((x) => x.close), 200) }) },
  { id: "ema9", name: "EMA 9", pane: "price", lines: [{ key: "v", color: "#fb923c" }], compute: (c) => ({ v: ema(c.map((x) => x.close), 9) }) },
  { id: "ema21", name: "EMA 21", pane: "price", lines: [{ key: "v", color: "#c084fc" }], compute: (c) => ({ v: ema(c.map((x) => x.close), 21) }) },
  { id: "ema50", name: "EMA 50", pane: "price", lines: [{ key: "v", color: "#60a5fa" }], compute: (c) => ({ v: ema(c.map((x) => x.close), 50) }) },
  { id: "ema200", name: "EMA 200", pane: "price", lines: [{ key: "v", color: "#f472b6" }], compute: (c) => ({ v: ema(c.map((x) => x.close), 200) }) },
  { id: "wma20", name: "WMA 20", pane: "price", lines: [{ key: "v", color: "#a3e635" }], compute: (c) => ({ v: wma(c.map((x) => x.close), 20) }) },
  { id: "bb", name: "Bollinger Bands 20·2", pane: "price", lines: [{ key: "upper", color: "#8b8b98", style: 2 }, { key: "mid", color: "#8b8b98" }, { key: "lower", color: "#8b8b98", style: 2 }], compute: (c) => bollinger(c.map((x) => x.close)) },
  { id: "vwap", name: "VWAP", pane: "price", lines: [{ key: "v", color: "#4de3c1" }], compute: (c) => ({ v: vwap(c) }) },
  { id: "supertrend", name: "SuperTrend 10·3", pane: "price", lines: [{ key: "line", color: "#22d36b" }], compute: (c) => ({ line: supertrend(c).line }) },
  { id: "psar", name: "Parabolic SAR", pane: "price", lines: [{ key: "v", color: "#fbbf24", style: 1 }], compute: (c) => ({ v: psar(c) }) },
  { id: "donchian", name: "Donchian Channels 20", pane: "price", lines: [{ key: "upper", color: "#67e8f9", style: 2 }, { key: "mid", color: "#67e8f9" }, { key: "lower", color: "#67e8f9", style: 2 }], compute: (c) => donchian(c) },
  { id: "ichimoku", name: "Ichimoku Cloud", pane: "price", lines: [{ key: "tenkan", color: "#60a5fa" }, { key: "kijun", color: "#f87171" }, { key: "spanA", color: "#22d36b", style: 2 }, { key: "spanB", color: "#ef4444", style: 2 }], compute: (c) => ichimoku(c) },
  { id: "rsi", name: "RSI 14", pane: "own", lines: [{ key: "v", color: "#c084fc" }], levels: [30, 70], compute: (c) => ({ v: rsi(c.map((x) => x.close)) }) },
  { id: "macd", name: "MACD 12·26·9", pane: "own", lines: [{ key: "hist", color: "#4de3c1", histogram: true }, { key: "line", color: "#60a5fa" }, { key: "signal", color: "#fb923c" }], levels: [0], compute: (c) => macd(c.map((x) => x.close)) },
  { id: "stoch", name: "Stochastic 14·3·3", pane: "own", lines: [{ key: "k", color: "#60a5fa" }, { key: "d", color: "#fb923c" }], levels: [20, 80], compute: (c) => stochastic(c) },
  { id: "stochrsi", name: "Stochastic RSI", pane: "own", lines: [{ key: "k", color: "#60a5fa" }, { key: "d", color: "#fb923c" }], levels: [20, 80], compute: (c) => { const r = rsi(c.map((x) => x.close)); const fake = r.map((v, i) => ({ time: c[i].time, open: v, high: v, low: v, close: v, volume: 0 })); return stochastic(fake); } },
  { id: "atr", name: "ATR 14", pane: "own", lines: [{ key: "v", color: "#f5b236" }], compute: (c) => ({ v: atr(c) }) },
  { id: "obv", name: "On-Balance Volume", pane: "own", lines: [{ key: "v", color: "#38bdf8" }], compute: (c) => ({ v: obv(c) }) },
  { id: "cci", name: "CCI 20", pane: "own", lines: [{ key: "v", color: "#a3e635" }], levels: [-100, 100], compute: (c) => ({ v: cci(c) }) },
  { id: "willr", name: "Williams %R 14", pane: "own", lines: [{ key: "v", color: "#e879f9" }], levels: [-80, -20], compute: (c) => ({ v: williamsR(c) }) },
  { id: "mfi", name: "Money Flow Index 14", pane: "own", lines: [{ key: "v", color: "#34d399" }], levels: [20, 80], compute: (c) => ({ v: mfi(c) }) },
];
export const indicatorById = (id: string) => INDICATOR_DEFS.find((d) => d.id === id);
