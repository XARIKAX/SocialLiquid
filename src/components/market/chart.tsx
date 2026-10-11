"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { api } from "@/lib/client";
import { fmtPx } from "@/lib/format";
import { Icon, Toggle } from "../ui";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ChartMarker = { time: number; side: "LONG" | "SHORT" | "CLOSE"; label: string; kind: "mine" | "thesis" };
export type PriceLine = { px: number; color: string; title: string; dashed?: boolean };

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const UP = "#22d36b";
const DOWN = "#ff4d4f";
type Ind = "sma20" | "sma50" | "ema21" | "bb" | "vwap";
const INDICATORS: [Ind, string, string][] = [
  ["sma20", "SMA 20", "#f5b236"],
  ["sma50", "SMA 50", "#6b93ff"],
  ["ema21", "EMA 21", "#c084fc"],
  ["bb", "Bollinger 20·2", "#8b8b98"],
  ["vwap", "VWAP", "#4de3c1"],
];

function sma(v: number[], n: number) { return v.map((_, i) => (i + 1 < n ? NaN : v.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n)); }
function ema(v: number[], n: number) { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); }
function std(v: number[], n: number, m: number[]) { return v.map((_, i) => (i + 1 < n ? NaN : Math.sqrt(v.slice(i + 1 - n, i + 1).reduce((a, b) => a + (b - m[i]) ** 2, 0) / n))); }

export function Chart({ coin, markers = [], lastPx, lines = [] }: { coin: string; markers?: ChartMarker[]; lastPx?: number; lines?: PriceLine[] }) {
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>("1h");
  const [mode, setMode] = useState<"chart" | "funding">("chart");
  const [showMine, setShowMine] = useState(true);
  const [showThesis, setShowThesis] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [inds, setInds] = useState<Ind[]>([]);
  const [indOpen, setIndOpen] = useState(false);
  const [legend, setLegend] = useState<Candle | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fundRef = useRef<ISeriesApi<"Line"> | null>(null);
  const indRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const lineRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const indMenuRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["candles", coin, interval],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${coin}&interval=${interval}&bars=400`).then((r) => r.candles),
    refetchInterval: interval === "1m" ? 5000 : 15_000,
  });
  const funding = useQuery({ queryKey: ["funding-hist", coin], queryFn: () => api<{ rows: { time: number; rate: number }[] }>(`/api/funding?coin=${coin}&days=7`).then((r) => r.rows), enabled: mode === "funding" });

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#0b0b0e" }, textColor: "#8b8b98", fontSize: 11, fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif", attributionLogo: false },
      grid: { vertLines: { color: "#131317" }, horzLines: { color: "#131317" } },
      rightPriceScale: { borderColor: "#1b1b21", scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: "#1b1b21", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { horzLine: { color: "#4de3c1", labelBackgroundColor: "#4de3c1", style: 3 }, vertLine: { color: "#4de3c1", labelBackgroundColor: "#4de3c1", style: 3 } },
      localization: { locale: "en-US" },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false, priceLineColor: "#4de3c1", priceLineStyle: 3 });
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#26262e" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    const fund = chart.addSeries(LineSeries, { color: "#4de3c1", lineWidth: 2, priceFormat: { type: "custom", formatter: (v: number) => `${(v * 100).toFixed(4)}%` }, visible: false });
    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;
    fundRef.current = fund;
    markersRef.current = createSeriesMarkers(series, []);
    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined;
      if (!d) return setLegend(null);
      setLegend({ time: Number(param.time), open: d.open, high: d.high, low: d.low, close: d.close, volume: 0 });
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      fundRef.current = null;
      markersRef.current = null;
      indRef.current.clear();
      lineRef.current = [];
    };
  }, []);

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
    const data = q.data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const last = data.at(-1);
    const precision = last ? (last.close >= 1000 ? 1 : last.close >= 1 ? 3 : last.close >= 0.01 ? 5 : 8) : 5;
    s.applyOptions({ priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) } });
    s.setData(data);
    v.setData(q.data.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(34,211,107,0.22)" : "rgba(255,77,79,0.22)" })));
    chartRef.current?.timeScale().fitContent();
  }, [q.data]);

  // mode toggle
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
    chartRef.current?.priceScale("right").applyOptions({ mode: logScale ? 1 : 0 });
  }, [logScale]);

  // live tick
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !q.data?.length || !lastPx || mode !== "chart") return;
    const last = q.data[q.data.length - 1];
    s.update({ time: last.time as UTCTimestamp, open: last.open, high: Math.max(last.high, lastPx), low: Math.min(last.low, lastPx), close: lastPx });
  }, [lastPx, q.data, mode]);

  // indicators
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
    const colors: Record<string, string> = { sma20: "#f5b236", sma50: "#6b93ff", ema21: "#c084fc", bbU: "#8b8b98", bbL: "#8b8b98", vwap: "#4de3c1" };
    for (const [k, s] of indRef.current) if (!indData[k]) { c.removeSeries(s); indRef.current.delete(k); }
    for (const k of Object.keys(indData)) {
      let s = indRef.current.get(k);
      if (!s) {
        s = c.addSeries(LineSeries, { color: colors[k], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: k.startsWith("bb") ? 2 : 0 });
        indRef.current.set(k, s);
      }
      s.setData(indData[k]);
    }
  }, [indData]);

  // position / order price lines
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of lineRef.current) s.removePriceLine(l);
    lineRef.current = lines.map((l) => s.createPriceLine({ price: l.px, color: l.color, lineWidth: 1, lineStyle: l.dashed ? 2 : 0, axisLabelVisible: true, title: l.title }));
  }, [lines]);

  // markers
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
        color: m.kind === "thesis" ? "#6b93ff" : m.side === "SHORT" ? DOWN : m.side === "LONG" ? UP : "#8b8b98",
        text: m.kind === "mine" ? m.label : undefined,
        size: m.kind === "thesis" ? 0.8 : 1,
      }));
    markersRef.current.setMarkers(list);
  }, [markers, showMine, showThesis, q.data]);

  const cur = legend ?? q.data?.at(-1) ?? null;
  const up = cur ? cur.close >= cur.open : true;
  const lastFunding = funding.data?.at(-1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0.5 px-2 h-10 border-b border-line text-xs shrink-0 overflow-x-auto">
        <button className={`tab h-8 px-3 ${mode === "chart" ? "tab-active" : ""}`} onClick={() => setMode("chart")}>Chart</button>
        <button className={`tab h-8 px-3 ${mode === "funding" ? "tab-active" : ""}`} onClick={() => setMode("funding")}>Funding</button>
        <span className="mx-1.5 w-px h-4 bg-line-2" />
        {INTERVALS.map((i) => (
          <button key={i} className={`px-2 h-7 rounded-lg num ${interval === i ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`} onClick={() => setInterval_(i)}>{i}</button>
        ))}
        <span className="mx-1.5 w-px h-4 bg-line-2" />
        <div ref={indMenuRef} className="relative">
          <button className={`tab h-8 px-2.5 ${inds.length ? "text-brand" : ""}`} onClick={() => setIndOpen((v) => !v)}><span className="italic font-serif">ƒ</span>x Indicators{inds.length ? ` (${inds.length})` : ""}</button>
          {indOpen && (
            <div className="absolute left-0 top-9 z-30 w-52 card p-1.5 shadow-2xl shadow-black/70">
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
        <span className="ml-auto flex items-center gap-3 shrink-0 pl-2">
          <button className={`px-1.5 h-7 rounded ${logScale ? "text-brand" : "text-muted hover:text-fg"}`} onClick={() => setLogScale((v) => !v)}>log</button>
          <button className="px-1.5 h-7 rounded text-muted hover:text-fg" onClick={() => chartRef.current?.timeScale().fitContent()}>auto</button>
          <span className="w-px h-4 bg-line-2" />
          <Toggle on={showMine} onChange={setShowMine} label="My trades" />
          <Toggle on={showThesis} onChange={setShowThesis} label="Thesis" />
        </span>
      </div>
      <div className="relative flex-1 min-h-[280px]">
        <div ref={ref} className="absolute inset-0" />
        {mode === "chart" && cur && (
          <div className="absolute left-3 top-2 z-10 text-[11px] num flex items-center gap-2 pointer-events-none flex-wrap">
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
            <span className="text-dim font-sans">({((funding.data?.reduce((a, r) => a + r.rate, 0) ?? 0) * 100 * (365 * 24 / Math.max(1, funding.data?.length ?? 1))).toFixed(1)}% annualised)</span>
          </div>
        )}
        {q.isLoading && <div className="absolute inset-0 skeleton rounded-none" />}
        {q.isError && <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">Chart unavailable: {(q.error as Error).message}</div>}
      </div>
    </div>
  );
}
