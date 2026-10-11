"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { api } from "@/lib/client";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ChartMarker = { time: number; side: "LONG" | "SHORT" | "CLOSE"; label: string; kind: "mine" | "thesis" };

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export function Chart({ coin, markers = [], lastPx }: { coin: string; markers?: ChartMarker[]; lastPx?: number }) {
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>("1h");
  const [showMine, setShowMine] = useState(true);
  const [showThesis, setShowThesis] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);

  const q = useQuery({
    queryKey: ["candles", coin, interval],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${coin}&interval=${interval}&bars=300`).then((r) => r.candles),
    refetchInterval: interval === "1m" ? 5000 : 15_000,
  });

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#0a0a0c" }, textColor: "#8c8c98", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#16161c" }, horzLines: { color: "#16161c" } },
      rightPriceScale: { borderColor: "#222229" },
      timeScale: { borderColor: "#222229", timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { color: "#4cc9f0", labelBackgroundColor: "#4cc9f0" }, vertLine: { color: "#4cc9f0", labelBackgroundColor: "#4cc9f0" } },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !q.data) return;
    const data = q.data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const last = data.at(-1);
    const precision = last ? (last.close >= 1000 ? 1 : last.close >= 1 ? 3 : last.close >= 0.01 ? 5 : 8) : 5;
    s.applyOptions({ priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) } });
    s.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [q.data]);

  // live last price nudges the current bar
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
        color: m.kind === "thesis" ? "#4cc9f0" : m.side === "SHORT" ? "#ef4444" : m.side === "LONG" ? "#22c55e" : "#8c8c98",
        text: m.label,
        size: 1,
      }));
    markersRef.current.setMarkers(list);
  }, [markers, showMine, showThesis, q.data]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 h-8 border-b border-line text-[11px]">
        {INTERVALS.map((i) => (
          <button key={i} className={`px-1.5 h-6 rounded ${interval === i ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`} onClick={() => setInterval_(i)}>
            {i}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button className={`px-1.5 h-6 rounded ${showMine ? "text-up" : "text-dim"}`} onClick={() => setShowMine((v) => !v)}>
            ● my trades
          </button>
          <button className={`px-1.5 h-6 rounded ${showThesis ? "text-accent" : "text-dim"}`} onClick={() => setShowThesis((v) => !v)}>
            ■ theses
          </button>
        </span>
      </div>
      <div className="relative flex-1 min-h-[260px]">
        <div ref={ref} className="absolute inset-0" />
        {q.isLoading && <div className="absolute inset-0 skeleton" />}
        {q.isError && <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">chart unavailable: {(q.error as Error).message}</div>}
      </div>
    </div>
  );
}
