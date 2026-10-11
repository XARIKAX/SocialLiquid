"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, HistogramSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { api } from "@/lib/client";
import { fmtPx } from "@/lib/format";
import { Toggle } from "../ui";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ChartMarker = { time: number; side: "LONG" | "SHORT" | "CLOSE"; label: string; kind: "mine" | "thesis" };

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const UP = "#22d36b";
const DOWN = "#ff4d4f";

export function Chart({ coin, markers = [], lastPx }: { coin: string; markers?: ChartMarker[]; lastPx?: number }) {
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>("1h");
  const [showMine, setShowMine] = useState(true);
  const [showThesis, setShowThesis] = useState(true);
  const [legend, setLegend] = useState<Candle | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);

  const q = useQuery({
    queryKey: ["candles", coin, interval],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${coin}&interval=${interval}&bars=300`).then((r) => r.candles),
    refetchInterval: interval === "1m" ? 5000 : 15_000,
  });

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
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineColor: "#4de3c1",
      priceLineStyle: 3,
    });
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#26262e" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;
    markersRef.current = createSeriesMarkers(series, []);
    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(series) as { open: number; high: number; low: number; close: number; time: number } | undefined;
      if (!d) return setLegend(null);
      setLegend({ time: Number(param.time), open: d.open, high: d.high, low: d.low, close: d.close, volume: 0 });
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      markersRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !q.data?.length || !lastPx) return;
    const last = q.data[q.data.length - 1];
    s.update({ time: last.time as UTCTimestamp, open: last.open, high: Math.max(last.high, lastPx), low: Math.min(last.low, lastPx), close: lastPx });
  }, [lastPx, q.data]);

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
        // thesis squares stack when several traders post close together; labels only for the viewer's own trades
        text: m.kind === "mine" ? m.label : undefined,
        size: m.kind === "thesis" ? 0.8 : 1,
      }));
    markersRef.current.setMarkers(list);
  }, [markers, showMine, showThesis, q.data]);

  const cur = legend ?? q.data?.at(-1) ?? null;
  const up = cur ? cur.close >= cur.open : true;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 h-10 border-b border-line text-xs shrink-0 overflow-x-auto">
        {INTERVALS.map((i) => (
          <button key={i} className={`px-2 h-7 rounded-lg num ${interval === i ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`} onClick={() => setInterval_(i)}>
            {i}
          </button>
        ))}
        <span className="mx-2 w-px h-4 bg-line-2" />
        <span className="text-muted hidden sm:inline">Price</span>
        <span className="ml-auto flex items-center gap-3 shrink-0 pl-2">
          <span className="text-dim hidden md:inline">Chart overlays</span>
          <Toggle on={showMine} onChange={setShowMine} label="My trades" />
          <Toggle on={showThesis} onChange={setShowThesis} label="Thesis" />
        </span>
      </div>
      <div className="relative flex-1 min-h-[280px]">
        <div ref={ref} className="absolute inset-0" />
        {cur && (
          <div className="absolute left-3 top-2 z-10 text-[11px] num flex items-center gap-2 pointer-events-none">
            <span className="text-fg-2 font-sans font-medium hidden sm:inline">{coin}-USD · {interval} · socialLiquid</span>
            <span className="text-dim">O</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.open)}</span>
            <span className="text-dim">H</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.high)}</span>
            <span className="text-dim">L</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.low)}</span>
            <span className="text-dim">C</span><span className={up ? "text-up" : "text-down"}>{fmtPx(cur.close)}</span>
          </div>
        )}
        {q.isLoading && <div className="absolute inset-0 skeleton rounded-none" />}
        {q.isError && <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">Chart unavailable: {(q.error as Error).message}</div>}
      </div>
    </div>
  );
}
