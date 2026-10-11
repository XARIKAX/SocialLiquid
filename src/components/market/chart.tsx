"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { api } from "@/lib/client";
import { fmtPx } from "@/lib/format";
import { chartPalette, useTheme } from "@/lib/theme";
import { Icon } from "../icons";
import { Toggle } from "../ui";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ChartMarker = { time: number; side: "LONG" | "SHORT" | "CLOSE"; label: string; kind: "mine" | "thesis" };
export type PriceLine = { px: number; color: string; title: string; dashed?: boolean };

type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
const INTERVAL_SEC: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
/** range buttons like the hl chart: label -> [interval, bars] */
const RANGES: [string, Interval, number][] = [["5y", "1w", 260], ["1y", "1d", 365], ["6m", "1d", 180], ["3m", "4h", 540], ["1m", "1h", 720], ["5d", "15m", 480], ["1d", "5m", 288]];
type Ind = "sma20" | "sma50" | "ema21" | "bb" | "vwap";
const INDICATORS: [Ind, string, string][] = [["sma20", "SMA 20", "#f5b236"], ["sma50", "SMA 50", "#6b93ff"], ["ema21", "EMA 21", "#c084fc"], ["bb", "Bollinger 20·2", "#8b8b98"], ["vwap", "VWAP", "#4de3c1"]];
type Tool = "cursor" | "trend" | "hline" | "ruler";
type Pt = { t: number; p: number };
type Drawing = { id: string; type: "trend" | "hline" | "ruler"; a: Pt; b?: Pt };

function sma(v: number[], n: number) { return v.map((_, i) => (i + 1 < n ? NaN : v.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n)); }
function ema(v: number[], n: number) { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); }
function std(v: number[], n: number, m: number[]) { return v.map((_, i) => (i + 1 < n ? NaN : Math.sqrt(v.slice(i + 1 - n, i + 1).reduce((a, b) => a + (b - m[i]) ** 2, 0) / n))); }

function useClock() {
  const [s, setS] = useState("");
  useEffect(() => {
    const f = () => {
      const d = new Date();
      const off = -d.getTimezoneOffset() / 60;
      setS(`${d.toLocaleTimeString("en-GB", { hour12: false })} (UTC${off >= 0 ? "+" : ""}${off})`);
    };
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);
  return s;
}

export function Chart({ coin, markers = [], lastPx, lines = [] }: { coin: string; markers?: ChartMarker[]; lastPx?: number; lines?: PriceLine[] }) {
  const [theme] = useTheme();
  const pal = chartPalette(theme);
  const [interval, setInterval_] = useState<Interval>("1h");
  const [bars, setBars] = useState(400);
  const [mode, setMode] = useState<"chart" | "funding">("chart");
  const [showMine, setShowMine] = useState(true);
  const [showThesis, setShowThesis] = useState(true);
  const [scale, setScale] = useState<0 | 1 | 2>(0);
  const [inds, setInds] = useState<Ind[]>([]);
  const [indOpen, setIndOpen] = useState(false);
  const [legend, setLegend] = useState<Candle | null>(null);
  const [full, setFull] = useState(false);
  const [tool, setTool] = useState<Tool>("cursor");
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const clock = useClock();

  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fundRef = useRef<ISeriesApi<"Line"> | null>(null);
  const indRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const lineRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const indMenuRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<Candle[]>([]);

  const q = useQuery({
    queryKey: ["candles", coin, interval, bars],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${coin}&interval=${interval}&bars=${bars}`).then((r) => r.candles),
    refetchInterval: interval === "1m" ? 5000 : 15_000,
  });
  const funding = useQuery({ queryKey: ["funding-hist", coin], queryFn: () => api<{ rows: { time: number; rate: number }[] }>(`/api/funding?coin=${coin}&days=7`).then((r) => r.rows), enabled: mode === "funding" });

  // persist drawings per coin
  useEffect(() => {
    try {
      setDrawings(JSON.parse(localStorage.getItem(`sl:draw:${coin}`) ?? "[]"));
    } catch {
      setDrawings([]);
    }
    setSelected(null);
    setDraft(null);
  }, [coin]);
  useEffect(() => {
    try {
      localStorage.setItem(`sl:draw:${coin}`, JSON.stringify(drawings.filter((d) => d.type !== "ruler")));
    } catch {}
  }, [drawings, coin]);

  // chart init
  useEffect(() => {
    if (!ref.current) return;
    const p = chartPalette(theme);
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text, fontSize: 11, fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif", attributionLogo: false },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.border, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { horzLine: { color: p.brand, labelBackgroundColor: p.brand, style: 3 }, vertLine: { color: p.brand, labelBackgroundColor: p.brand, style: 3 } },
      localization: { locale: "en-US" },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down, borderVisible: false, priceLineColor: p.brand, priceLineStyle: 3 });
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: p.vol });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    const fund = chart.addSeries(LineSeries, { color: p.brand, lineWidth: 2, priceFormat: { type: "custom", formatter: (v: number) => `${(v * 100).toFixed(4)}%` }, visible: false });
    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;
    fundRef.current = fund;
    markersRef.current = createSeriesMarkers(series, []);
    const bump = () => setTick((t) => t + 1);
    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined;
      setLegend(d ? { time: Number(param.time), open: d.open, high: d.high, low: d.low, close: d.close, volume: 0 } : null);
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    // keep the same bars in view when the pane is resized (fullscreen, rail collapse)
    let lastW = ref.current.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = ref.current?.clientWidth ?? lastW;
      if (w !== lastW) {
        const r = chart.timeScale().getVisibleLogicalRange();
        lastW = w;
        if (r) {
          const apply = () => chart.timeScale().setVisibleLogicalRange(r);
          requestAnimationFrame(apply);
          setTimeout(apply, 80);
        }
      }
      bump();
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      fundRef.current = null;
      markersRef.current = null;
      indRef.current.clear();
      lineRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme switch
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: pal.bg }, textColor: pal.text },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border },
      crosshair: { horzLine: { color: pal.brand, labelBackgroundColor: pal.brand }, vertLine: { color: pal.brand, labelBackgroundColor: pal.brand } },
    });
    seriesRef.current?.applyOptions({ upColor: pal.up, downColor: pal.down, wickUpColor: pal.up, wickDownColor: pal.down, priceLineColor: pal.brand });
    fundRef.current?.applyOptions({ color: pal.brand });
    if (dataRef.current.length) volRef.current?.setData(dataRef.current.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? pal.upSoft : pal.downSoft })));
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: MouseEvent) => !indMenuRef.current?.contains(e.target as Node) && setIndOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // candles + volume
  useEffect(() => {
    const s = seriesRef.current;
    const v = volRef.current;
    if (!s || !v || !q.data) return;
    dataRef.current = q.data;
    const data = q.data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const last = data.at(-1);
    const precision = last ? (last.close >= 1000 ? 1 : last.close >= 1 ? 3 : last.close >= 0.01 ? 5 : 8) : 5;
    s.applyOptions({ priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) } });
    s.setData(data);
    v.setData(q.data.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? pal.upSoft : pal.downSoft })));
    chartRef.current?.timeScale().fitContent();
    setTick((t) => t + 1);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = chartRef.current;
    if (!c || !seriesRef.current || !volRef.current || !fundRef.current) return;
    const chartMode = mode === "chart";
    seriesRef.current.applyOptions({ visible: chartMode });
    volRef.current.applyOptions({ visible: chartMode });
    fundRef.current.applyOptions({ visible: !chartMode });
    for (const s of indRef.current.values()) s.applyOptions({ visible: chartMode });
    if (!chartMode && funding.data) {
      fundRef.current.setData(funding.data.map((r) => ({ time: Math.floor(r.time / 1000) as UTCTimestamp, value: r.rate })));
      c.timeScale().fitContent();
    }
  }, [mode, funding.data]);

  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({ mode: scale, autoScale: true });
  }, [scale]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !q.data?.length || !lastPx || mode !== "chart") return;
    const last = q.data[q.data.length - 1];
    s.update({ time: last.time as UTCTimestamp, open: last.open, high: Math.max(last.high, lastPx), low: Math.min(last.low, lastPx), close: lastPx });
  }, [lastPx, q.data, mode]);

  const indData = useMemo(() => {
    if (!q.data) return null;
    const closes = q.data.map((c) => c.close);
    const times = q.data.map((c) => c.time as UTCTimestamp);
    const out: Record<string, { time: UTCTimestamp; value: number }[]> = {};
    const pack = (arr: number[]) => arr.map((v, i) => ({ time: times[i], value: v })).filter((p) => Number.isFinite(p.value));
    if (inds.includes("sma20")) out.sma20 = pack(sma(closes, 20));
    if (inds.includes("sma50")) out.sma50 = pack(sma(closes, 50));
    if (inds.includes("ema21")) out.ema21 = pack(ema(closes, 21));
    if (inds.includes("bb")) {
      const m = sma(closes, 20);
      const sd = std(closes, 20, m);
      out.bbU = pack(m.map((x, i) => x + 2 * sd[i]));
      out.bbL = pack(m.map((x, i) => x - 2 * sd[i]));
    }
    if (inds.includes("vwap")) {
      let pv = 0;
      let vv = 0;
      out.vwap = pack(q.data.map((c) => { const tp = (c.high + c.low + c.close) / 3; pv += tp * c.volume; vv += c.volume; return vv ? pv / vv : NaN; }));
    }
    return out;
  }, [q.data, inds]);
  useEffect(() => {
    const c = chartRef.current;
    if (!c || !indData) return;
    const colors: Record<string, string> = { sma20: "#f5b236", sma50: "#6b93ff", ema21: "#c084fc", bbU: "#8b8b98", bbL: "#8b8b98", vwap: pal.brand };
    for (const [k, s] of indRef.current) if (!indData[k]) { c.removeSeries(s); indRef.current.delete(k); }
    for (const k of Object.keys(indData)) {
      let s = indRef.current.get(k);
      if (!s) {
        s = c.addSeries(LineSeries, { color: colors[k], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: k.startsWith("bb") ? 2 : 0 });
        indRef.current.set(k, s);
      }
      s.setData(indData[k]);
    }
  }, [indData, pal.brand]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of lineRef.current) s.removePriceLine(l);
    lineRef.current = lines.map((l) => s.createPriceLine({ price: l.px, color: l.color, lineWidth: 1, lineStyle: l.dashed ? 2 : 0, axisLabelVisible: true, title: l.title }));
  }, [lines]);

  useEffect(() => {
    if (!markersRef.current || !q.data?.length) return;
    const first = q.data[0].time;
    const list: SeriesMarker<Time>[] = markers
      .filter((m) => (m.kind === "mine" ? showMine : showThesis) && m.time / 1000 >= first)
      .sort((a, b) => a.time - b.time)
      .map((m) => ({
        time: Math.floor(m.time / 1000) as UTCTimestamp,
        position: m.side === "SHORT" ? "aboveBar" : "belowBar",
        shape: m.kind === "thesis" ? "square" : m.side === "SHORT" ? "arrowDown" : m.side === "LONG" ? "arrowUp" : "circle",
        color: m.kind === "thesis" ? "#6b93ff" : m.side === "SHORT" ? pal.down : m.side === "LONG" ? pal.up : pal.text,
        text: m.kind === "mine" ? m.label : undefined,
        size: m.kind === "thesis" ? 0.8 : 1,
      }));
    markersRef.current.setMarkers(list);
  }, [markers, showMine, showThesis, q.data, pal]);

  // fullscreen
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const fullRangeRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    // the pane changes width when entering/leaving fullscreen: keep the same bars in view
    const r = fullRangeRef.current;
    const chart = chartRef.current;
    if (!r || !chart) return;
    const apply = () => chart.timeScale().setVisibleLogicalRange(r);
    const t1 = setTimeout(apply, 60);
    const t2 = setTimeout(apply, 250);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [full]);
  const toggleFull = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = chartRef.current?.timeScale().getVisibleLogicalRange();
    fullRangeRef.current = r ? { from: r.from, to: r.to } : null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => setFull((f) => !f));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!document.fullscreenElement) setFull(false);
        setTool("cursor");
        setDraft(null);
        setSelected(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected && (document.activeElement?.tagName ?? "") !== "INPUT" && (document.activeElement?.tagName ?? "") !== "TEXTAREA") {
        setDrawings((d) => d.filter((x) => x.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  // nav controls
  const zoom = (f: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2;
    const half = ((r.to - r.from) / 2) * f;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  };
  const pan = (dir: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const step = (r.to - r.from) * 0.25 * dir;
    ts.setVisibleLogicalRange({ from: r.from + step, to: r.to + step });
  };
  const reset = () => {
    chartRef.current?.timeScale().resetTimeScale();
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    chartRef.current?.timeScale().fitContent();
  };
  const snapshot = () => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${coin}-${interval}-${new Date().toISOString().slice(0, 19)}.png`;
    a.click();
  };
  const goToDate = (v: string) => {
    const ts = chartRef.current?.timeScale();
    const d = dataRef.current;
    if (!ts || !v || !d.length) return;
    const target = new Date(v).getTime() / 1000;
    const idx = d.findIndex((c) => c.time >= target);
    const i = idx < 0 ? d.length - 1 : idx;
    const r = ts.getVisibleLogicalRange();
    const width = r ? r.to - r.from : 100;
    ts.setVisibleLogicalRange({ from: i - width / 2, to: i + width / 2 });
  };
  const setRange = (iv: Interval, n: number) => {
    setInterval_(iv);
    setBars(Math.min(1000, n + 20));
  };

  // coordinate helpers for the drawing layer
  const xOf = useCallback((t: number): number | null => {
    const ts = chartRef.current?.timeScale();
    const d = dataRef.current;
    if (!ts || !d.length) return null;
    const direct = ts.timeToCoordinate(t as UTCTimestamp);
    if (direct !== null) return direct;
    const last = d[d.length - 1];
    const logical = d.length - 1 + (t - last.time) / INTERVAL_SEC[interval];
    return ts.logicalToCoordinate(logical as never);
  }, [interval]);
  const tOf = useCallback((x: number): number | null => {
    const ts = chartRef.current?.timeScale();
    const d = dataRef.current;
    if (!ts || !d.length) return null;
    const t = ts.coordinateToTime(x);
    if (t !== null) return Number(t);
    const logical = ts.coordinateToLogical(x);
    if (logical === null) return null;
    const last = d[d.length - 1];
    return last.time + (Number(logical) - (d.length - 1)) * INTERVAL_SEC[interval];
  }, [interval]);
  const yOf = (p: number) => seriesRef.current?.priceToCoordinate(p) ?? null;
  const pOf = (y: number) => seriesRef.current?.coordinateToPrice(y) ?? null;

  const ptAt = (e: React.MouseEvent): Pt | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const t = tOf(e.clientX - rect.left);
    const p = pOf(e.clientY - rect.top);
    return t === null || p === null ? null : { t, p: Number(p) };
  };
  const onDown = (e: React.MouseEvent) => {
    if (tool === "cursor" || locked) return;
    const pt = ptAt(e);
    if (!pt) return;
    if (tool === "hline") {
      setDrawings((d) => [...d, { id: crypto.randomUUID(), type: "hline", a: pt }]);
      setTool("cursor");
      return;
    }
    if (tool === "ruler") {
      setDrawings((d) => d.filter((x) => x.type !== "ruler"));
      setDraft({ id: crypto.randomUUID(), type: "ruler", a: pt, b: pt });
      return;
    }
    if (!draft) setDraft({ id: crypto.randomUUID(), type: "trend", a: pt, b: pt });
    else {
      setDrawings((d) => [...d, { ...draft, b: pt }]);
      setDraft(null);
      setTool("cursor");
    }
  };
  const onMove = (e: React.MouseEvent) => {
    if (!draft) return;
    const pt = ptAt(e);
    if (pt) setDraft({ ...draft, b: pt });
  };
  const onUp = (e: React.MouseEvent) => {
    if (draft?.type !== "ruler") return;
    const pt = ptAt(e);
    if (pt) setDrawings((d) => [...d, { ...draft, b: pt }]);
    setDraft(null);
    setTool("cursor");
  };

  const cur = legend ?? q.data?.at(-1) ?? null;
  const up = cur ? cur.close >= cur.open : true;
  const lastFunding = funding.data?.at(-1);
  const visible = hidden ? [] : [...drawings, ...(draft ? [draft] : [])];
  void tick;

  return (
    <div ref={wrapRef} className={`group/chart flex flex-col h-full bg-panel ${full ? "fixed inset-0 z-50" : ""}`}>
      {/* top toolbar */}
      <div className="flex items-center gap-0.5 px-2 h-10 border-b border-line text-xs shrink-0 overflow-x-auto">
        <button className={`tab h-8 px-3 ${mode === "chart" ? "tab-active" : ""}`} onClick={() => setMode("chart")}>Chart</button>
        <button className={`tab h-8 px-3 ${mode === "funding" ? "tab-active" : ""}`} onClick={() => setMode("funding")}>Funding</button>
        <span className="mx-1.5 w-px h-4 bg-line-2" />
        {INTERVALS.map((i) => (
          <button key={i} className={`px-2 h-7 rounded-lg num ${interval === i ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`} onClick={() => setInterval_(i)}>{i === "1d" ? "D" : i === "1w" ? "W" : i}</button>
        ))}
        <span className="mx-1.5 w-px h-4 bg-line-2" />
        <div ref={indMenuRef} className="relative">
          <button className={`tab h-8 px-2.5 ${inds.length ? "text-brand" : ""}`} onClick={() => setIndOpen((v) => !v)}><span className="italic font-serif">ƒ</span>x Indicators{inds.length ? ` (${inds.length})` : ""}</button>
          {indOpen && (
            <div className="absolute left-0 top-9 z-30 w-52 card p-1.5 shadow-2xl shadow-black/40">
              {INDICATORS.map(([k, l, c]) => (
                <button key={k} className="w-full flex items-center gap-2 px-2.5 h-9 rounded-lg hover:bg-panel-2 text-left" onClick={() => setInds((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}>
                  <span className="w-3 h-0.5 rounded" style={{ background: c }} />
                  <span className="flex-1">{l}</span>
                  {inds.includes(k) && <span className="text-brand"><Icon.check /></span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto flex items-center gap-2 shrink-0 pl-2">
          <Toggle on={showMine} onChange={setShowMine} label="My trades" />
          <Toggle on={showThesis} onChange={setShowThesis} label="Thesis" />
          <span className="w-px h-4 bg-line-2" />
          <button className="rail-btn w-7 h-7" onClick={snapshot} title="Take a snapshot"><Icon.camera /></button>
          <button className="rail-btn w-7 h-7" onClick={toggleFull} title={full ? "Exit fullscreen" : "Fullscreen"}>{full ? <Icon.shrink /> : <Icon.expand />}</button>
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* drawing rail */}
        <div className="w-10 shrink-0 border-r border-line flex flex-col items-center py-1.5 gap-0.5">
          {([["cursor", "Cursor", <Icon.cursor key="c" />], ["trend", "Trend line", <Icon.trend key="t" />], ["hline", "Horizontal line", <Icon.hline key="h" />], ["ruler", "Measure", <Icon.ruler key="r" />]] as [Tool, string, React.ReactNode][]).map(([t, title, icon]) => (
            <button key={t} className={`rail-btn ${tool === t ? "rail-btn-active" : ""}`} onClick={() => { setTool(t); setDraft(null); }} title={title} disabled={locked && t !== "cursor"}>{icon}</button>
          ))}
          <span className="w-5 h-px bg-line-2 my-1" />
          <button className={`rail-btn ${locked ? "rail-btn-active" : ""}`} onClick={() => setLocked((v) => !v)} title={locked ? "Unlock drawings" : "Lock drawings"}><Icon.lock /></button>
          <button className={`rail-btn ${hidden ? "rail-btn-active" : ""}`} onClick={() => setHidden((v) => !v)} title={hidden ? "Show drawings" : "Hide drawings"}>{hidden ? <Icon.eyeOff /> : <Icon.eye />}</button>
          <button className="rail-btn hover:text-down" onClick={() => { setDrawings([]); setDraft(null); setSelected(null); }} title="Remove all drawings"><Icon.trash /></button>
        </div>

        {/* chart pane */}
        <div className="relative flex-1 min-h-[280px] min-w-0">
          <div ref={ref} className="absolute inset-0" />
          {/* drawing overlay */}
          <svg
            className={`absolute inset-0 z-[5] w-full h-full ${tool !== "cursor" && !locked ? "cursor-crosshair" : ""}`}
            style={{ pointerEvents: tool !== "cursor" && !locked ? "auto" : "none" }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
          >
            {mode === "chart" && visible.map((d) => <DrawingShape key={d.id} d={d} xOf={xOf} yOf={yOf} selected={selected === d.id} onSelect={() => !locked && setSelected(d.id)} pal={pal} />)}
          </svg>
          {/* legend */}
          {mode === "chart" && cur && (
            <div className="absolute left-3 right-16 top-2 z-10 text-[11px] num flex items-center gap-2 pointer-events-none flex-wrap">
              <span className="text-fg-2 font-sans font-medium hidden sm:inline">{coin}-USD · {interval} · socialLiquid</span>
              <span className="text-dim">O</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.open)}</span>
              <span className="text-dim">H</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.high)}</span>
              <span className="text-dim">L</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.low)}</span>
              <span className="text-dim">C</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.close)}</span>
              {inds.map((k) => { const d = INDICATORS.find((x) => x[0] === k)!; return <span key={k} className="ml-1" style={{ color: d[2] }}>{d[1]}</span>; })}
            </div>
          )}
          {mode === "funding" && (
            <div className="absolute left-3 top-2 z-10 text-[11px] num flex items-center gap-2 pointer-events-none">
              <span className="text-fg-2 font-sans font-medium">{coin} funding · hourly · 7d</span>
              {lastFunding && <span className={lastFunding.rate >= 0 ? "text-up" : "text-down"}>{(lastFunding.rate * 100).toFixed(4)}%</span>}
            </div>
          )}
          {/* hover nav */}
          <div className="chart-nav">
            <button onClick={() => zoom(1.25)} title="Zoom out"><Icon.minus /></button>
            <button onClick={() => zoom(0.8)} title="Zoom in"><Icon.plus /></button>
            <span className="w-px h-4 bg-line-2 mx-0.5" />
            <button onClick={() => pan(-1)} title="Scroll left"><Icon.left /></button>
            <button onClick={() => pan(1)} title="Scroll right"><Icon.right /></button>
            <span className="w-px h-4 bg-line-2 mx-0.5" />
            <button onClick={reset} title="Reset chart"><Icon.reset /></button>
          </div>
          {q.isLoading && <div className="absolute inset-0 skeleton rounded-none" />}
          {q.isError && <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">Chart unavailable: {(q.error as Error).message}</div>}
        </div>
      </div>

      {/* bottom bar */}
      <div className="h-9 shrink-0 border-t border-line flex items-center px-2 text-[11px] num gap-1 overflow-x-auto">
        {RANGES.map(([l, iv, n]) => (
          <button key={l} className={`px-1.5 h-6 rounded ${interval === iv && bars === Math.min(1000, n + 20) ? "text-fg bg-panel-3" : "text-muted hover:text-fg"}`} onClick={() => setRange(iv, n)}>{l}</button>
        ))}
        <button className="rail-btn w-7 h-7" title="Go to date" onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.click()}><Icon.calendar /></button>
        <input ref={dateRef} type="date" className="sr-only" onChange={(e) => goToDate(e.target.value)} aria-label="go to date" />
        <span className="ml-auto text-muted">{clock}</span>
        <span className="w-px h-4 bg-line-2 mx-1" />
        <button className={`px-1.5 h-6 rounded ${scale === 2 ? "text-brand" : "text-muted hover:text-fg"}`} onClick={() => setScale(scale === 2 ? 0 : 2)} title="Percent scale">%</button>
        <button className={`px-1.5 h-6 rounded ${scale === 1 ? "text-brand" : "text-muted hover:text-fg"}`} onClick={() => setScale(scale === 1 ? 0 : 1)} title="Log scale">log</button>
        <button className={`px-1.5 h-6 rounded ${scale === 0 ? "text-brand" : "text-muted hover:text-fg"}`} onClick={() => { setScale(0); reset(); }} title="Auto scale">auto</button>
      </div>
    </div>
  );
}

function DrawingShape({ d, xOf, yOf, selected, onSelect, pal }: { d: Drawing; xOf: (t: number) => number | null; yOf: (p: number) => number | null; selected: boolean; onSelect: () => void; pal: ReturnType<typeof chartPalette> }) {
  const color = selected ? pal.brand : d.type === "ruler" ? pal.brand : "#6b93ff";
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); onSelect(); };
  if (d.type === "hline") {
    const y = yOf(d.a.p);
    if (y === null) return null;
    return (
      <g>
        <line x1="0" x2="100%" y1={y} y2={y} stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray="6 4" style={{ pointerEvents: "visibleStroke", cursor: "pointer" }} onMouseDown={stop} />
        <text x="calc(100% - 68px)" y={y - 4} textAnchor="end" fill={color} fontSize="10" className="num">{fmtPx(d.a.p)}</text>
      </g>
    );
  }
  if (!d.b) return null;
  const x1 = xOf(d.a.t), y1 = yOf(d.a.p), x2 = xOf(d.b.t), y2 = yOf(d.b.p);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  if (d.type === "trend") {
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={selected ? 2.5 : 1.5} style={{ pointerEvents: "visibleStroke", cursor: "pointer" }} onMouseDown={stop} />
        {selected && <><circle cx={x1} cy={y1} r="4" fill={pal.bg} stroke={color} /><circle cx={x2} cy={y2} r="4" fill={pal.bg} stroke={color} /></>}
      </g>
    );
  }
  const pct = ((d.b.p - d.a.p) / d.a.p) * 100;
  const upMove = pct >= 0;
  const fill = upMove ? pal.up : pal.down;
  const left = Math.min(x1, x2), top = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  return (
    <g>
      <rect x={left} y={top} width={w} height={h} fill={fill} fillOpacity="0.12" stroke={fill} strokeDasharray="4 3" />
      <rect x={left + w / 2 - 54} y={top - 34} width="108" height="28" rx="6" fill={pal.bg} stroke={fill} />
      <text x={left + w / 2} y={top - 16} textAnchor="middle" fill={fill} fontSize="11" className="num">{upMove ? "+" : ""}{pct.toFixed(2)}%  {fmtPx(Math.abs(d.b.p - d.a.p))}</text>
    </g>
  );
}
