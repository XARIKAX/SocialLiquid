"use client";
import "./chart.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LastPriceAnimationMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type TickMarkType,
  type UTCTimestamp,
} from "lightweight-charts";
import { api } from "@/lib/client";
import { chartPalette, useTheme } from "@/lib/theme";
import { Icon } from "../icons";
import { BandSeries, GlowCandleSeries, GlowLineSeries, SoftVolumeSeries, withAlpha } from "./chart-series";
import {
  CHART_TYPES,
  IND_IDS,
  INTERVALS,
  INTERVAL_SEC,
  RANGES,
  barIndexAt,
  computeIndicators,
  fmtCountdown,
  fmtCrossTime,
  fmtFixed,
  fmtTick,
  haNext,
  heikinAshi,
  intervalLabel,
  liveIndicatorValues,
  precisionFor,
  rangeBars,
  readPref,
  tickLabels,
  writePref,
  type Candle,
  type ChartType,
  type Ind,
  type IndValue,
  type Interval,
} from "./chart-lib";
import { CIcon, Clock, CtxMenu, IndMenu, Legend, TfMenu, ThesisPins, TipLayer, TypeMenu, type ChartMarker, type PinGroup, type PriceLine } from "./chart-ui";
import { DrawingLayer, createViewport, type Drawing, type Part, type Pt, type Tool } from "./chart-draw";
import { downloadSnapshot } from "./chart-snapshot";

export type { ChartMarker, PriceLine } from "./chart-ui";

/* =====================================================================
   the market chart. behaves like tradingview (free crosshair with an
   optional magnet, chart types, keyboard, measure, scroll to realtime,
   a view that never resets under you), dressed like the landing mock:
   lit gradient candles on the card's glass, a soft teal pool of light,
   a breathing last-price tag with the bar countdown, thesis pins.
   ===================================================================== */

type Pal = ReturnType<typeof chartPalette>;
type AnySeries = ISeriesApi<SeriesType, Time>;
/** the live bar: row as drawn (heikin ashi when that type is on), raw as traded */
type Live = { row: Candle; raw: Candle; prevClose: number; idx: number; time: number; ivSec: number; dir: "up" | "down" };
/** the drawing rail opens by itself on charts at least this wide (until the trader picks), and folds below the lower bound */
const RAIL_OPEN_W = 760;
const RAIL_FOLD_W = 700;
/** thesis pins (px): callout offset from the stem, air kept over the wicks, half a callout, anchor to callout at rest, most extra stem */
const PIN_X = 11;
const PIN_GAP = 6;
const PIN_HALF = 11.5;
const PIN_REST = 21.5;
const PIN_STRETCH = 40;
const PIN_STRETCH_FOLDED = 72;
const PIN_CARD_W = 268;
/** the price tag's reach on the axis around its price (cell -10..+10, countdown to +25), plus air for a label's glyphs */
const TAG_ABOVE = 17;
const TAG_BELOW = 32;

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/* ---------- series setup ---------- */

const candleStyle = (p: Pal) => ({
  upTop: p.upTop,
  upMid: p.up,
  upBottom: p.upBot,
  downTop: p.downTop,
  downMid: p.down,
  downBottom: p.downBot,
  wickUp: p.wickUp,
  wickDown: p.wickDown,
  glowUp: p.glowUp,
  glowDown: p.glowDown,
  color: p.brand,
});

function mainStyle(type: ChartType, p: Pal) {
  if (type === "candles" || type === "ha") return candleStyle(p);
  if (type === "bars") return { upColor: p.up, downColor: p.down };
  // price is the brightest line on the chart; mint stays with the averages
  if (type === "line") return { color: p.ink, crosshairMarkerBackgroundColor: p.ink, crosshairMarkerBorderColor: p.bgTop };
  return { lineColor: p.ink, topColor: p.areaTop, bottomColor: p.areaBot, crosshairMarkerBackgroundColor: p.ink, crosshairMarkerBorderColor: p.bgTop };
}

function addMain(chart: IChartApi, type: ChartType, p: Pal): AnySeries {
  // the html tag replaces the canvas last-value label and price line
  const base = { lastValueVisible: false, priceLineVisible: false };
  if (type === "candles" || type === "ha") return chart.addCustomSeries(new GlowCandleSeries(), { ...base, ...candleStyle(p) }) as unknown as AnySeries;
  if (type === "bars") return chart.addSeries(BarSeries, { ...base, ...mainStyle(type, p), thinBars: false, openVisible: true }) as unknown as AnySeries;
  const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const live = { lineWidth: 2 as const, crosshairMarkerRadius: 4, crosshairMarkerBorderWidth: 2, lastPriceAnimation: calm ? LastPriceAnimationMode.Disabled : LastPriceAnimationMode.Continuous };
  if (type === "line") return chart.addSeries(LineSeries, { ...base, ...live, ...mainStyle(type, p) }) as unknown as AnySeries;
  return chart.addSeries(AreaSeries, { ...base, ...live, ...mainStyle(type, p) }) as unknown as AnySeries;
}

const volStyle = (p: Pal, theme: string) => ({ upColor: p.up, downColor: p.down, topAlpha: theme === "light" ? 0.26 : 0.3, bottomAlpha: theme === "light" ? 0.03 : 0.035 });

const toPoint = (type: ChartType, c: Candle) =>
  type === "line" || type === "area" ? { time: c.time as UTCTimestamp, value: c.close } : { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };

/** the axis labels pass through this, so the ones under the html price tag can step aside */
type TickHook = (prices: number[], labels: string[]) => string[];
const priceFmt = (prec: number, hook?: TickHook) => ({
  type: "custom" as const,
  minMove: Math.pow(10, -prec),
  // a price series never prints a negative price, however far the margins reach below zero
  formatter: (v: number) => (v < 0 ? "" : fmtFixed(v, prec)),
  tickmarksFormatter: (vs: number[]) => {
    const labels = tickLabels(vs, prec);
    return hook ? hook(vs, labels) : labels;
  },
});
const fundText = (v: number) => `${(v * 100).toFixed(4)}%`;
const fundFmt = (hook?: TickHook) => ({
  type: "custom" as const,
  minMove: 0.0000001,
  formatter: fundText,
  tickmarksFormatter: (vs: number[]) => {
    const labels = vs.map(fundText);
    return hook ? hook(vs, labels) : labels;
  },
});

/* ---------- the chart ---------- */

export function Chart({ coin, markers = [], lastPx, lines = [] }: { coin: string; markers?: ChartMarker[]; lastPx?: number; lines?: PriceLine[] }) {
  const [theme] = useTheme();
  const pal = useMemo(() => chartPalette(theme), [theme]);

  /* view state (ui preferences persist; the data flow does not change) */
  const [interval, setInterval_] = useState<Interval>("1h");
  const [bars, setBars] = useState(400);
  const [mode, setMode] = useState<"chart" | "funding">("chart");
  const [chartType, setChartType] = useState<ChartType>(() => {
    const v = readPref("sl:chart:type");
    return CHART_TYPES.some((t) => t[0] === v) ? (v as ChartType) : "candles";
  });
  const [inds, setInds] = useState<Ind[]>(() => {
    try {
      const v = JSON.parse(readPref("sl:chart:inds") ?? "null");
      if (Array.isArray(v)) return v.filter((x): x is Ind => IND_IDS.includes(x));
    } catch {}
    return ["ema20"];
  });
  const [showVol, setShowVol] = useState(() => readPref("sl:chart:vol") !== "0");
  const [magnet, setMagnet] = useState(() => readPref("sl:chart:magnet") === "1");
  // the trader's choice once made; until then the rail follows the chart's own width, so a narrow
  // chart (the 1440 layout, phones) keeps its candles and a wide or fullscreen one gets tradingview's rail
  const [railPref, setRailPref] = useState<boolean | null>(() => {
    const v = readPref("sl:chart:rail");
    return v === "1" ? true : v === "0" ? false : null;
  });
  const [wideChart, setWideChart] = useState(true);
  const railOpen = railPref ?? wideChart;
  // the layout's server-rendered placeholder sits under the chart in its card: on the first load
  // the chart stays clear over it (it shows the real recent closes) instead of painting a skeleton
  const [overPlaceholder, setOverPlaceholder] = useState(false);
  const [showMine, setShowMine] = useState(true);
  const [showThesis, setShowThesis] = useState(true);
  const [priceMode, setPriceMode] = useState<0 | 1 | 2>(0);
  const [autoScale, setAutoScale] = useState(true);
  const [full, setFull] = useState(false);
  const [tool, setTool] = useState<Tool>("cursor");
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: "type" | "ind" | "tf"; x: number; y: number; h: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; pt: Pt | null } | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [build, setBuild] = useState(0);
  // once candles are on the canvas, later loads (interval, range, market) veil them instead of blanking
  const [drawn, setDrawn] = useState(false);

  useEffect(() => writePref("sl:chart:type", chartType), [chartType]);
  useEffect(() => writePref("sl:chart:inds", JSON.stringify(inds)), [inds]);
  useEffect(() => writePref("sl:chart:vol", showVol ? "1" : "0"), [showVol]);
  useEffect(() => writePref("sl:chart:magnet", magnet ? "1" : "0"), [magnet]);
  useEffect(() => {
    if (railPref !== null) writePref("sl:chart:rail", railPref ? "1" : "0");
  }, [railPref]);

  /* data (unchanged: same keys, same endpoints, same refresh) */
  const q = useQuery({
    queryKey: ["candles", coin, interval, bars],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${coin}&interval=${interval}&bars=${bars}`).then((r) => r.candles),
    refetchInterval: interval === "1m" ? 5000 : 15_000,
  });
  const funding = useQuery({ queryKey: ["funding-hist", coin], queryFn: () => api<{ rows: { time: number; rate: number }[] }>(`/api/funding?coin=${coin}&days=7`).then((r) => r.rows), enabled: mode === "funding" });

  const candles = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => (chartType === "ha" ? heikinAshi(candles) : candles), [candles, chartType]);
  const prec = useMemo(() => precisionFor(candles.at(-1)?.close ?? lastPx ?? 1), [candles, lastPx]);
  const ivSec = INTERVAL_SEC[interval];

  /** the live bar: the last candle carried by the streaming mid; it rolls into a new bar on time */
  const live = useMemo<Live | null>(() => {
    const n = candles.length;
    if (!n) return null;
    let last = candles[n - 1];
    let idx = n - 1;
    const px = lastPx !== undefined && Number.isFinite(lastPx) && lastPx > 0 ? lastPx : undefined;
    if (px !== undefined) {
      const now = Date.now() / 1000;
      if (now >= last.time + ivSec && now < last.time + 2 * ivSec) {
        last = { time: last.time + ivSec, open: last.close, high: Math.max(last.close, px), low: Math.min(last.close, px), close: px, volume: 0 };
        idx = n;
      } else last = { ...last, high: Math.max(last.high, px), low: Math.min(last.low, px), close: px };
    }
    const prevSrc = idx === n ? candles[n - 1] : candles[n - 2];
    const prevRow = chartType === "ha" ? (idx === n ? rows[n - 1] : rows[n - 2]) : prevSrc;
    const row = chartType === "ha" ? haNext(prevRow, last) : last;
    const prevClose = prevRow?.close ?? row.open;
    const dir = chartType === "line" || chartType === "area" ? (row.close >= prevClose ? "up" : "down") : row.close >= row.open ? "up" : "down";
    return { row, raw: last, prevClose, idx, time: row.time, ivSec, dir };
  }, [candles, rows, chartType, lastPx, ivSec]);

  const indData = useMemo(() => computeIndicators(q.data, inds, ivSec), [q.data, inds, ivSec]);
  /** the indicators' readings on the live bar: the lines follow the streaming price, as on tradingview */
  const liveInd = useMemo<Partial<Record<Ind, IndValue>>>(
    () => (live && mode === "chart" ? liveIndicatorValues(candles, indData, inds, live.raw, live.idx, ivSec) : {}),
    [live, candles, indData, inds, ivSec, mode],
  );

  /* ---------- refs the frame loop and handlers read ---------- */
  const wrapRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const tagPxRef = useRef<HTMLSpanElement>(null);
  const tagCdRef = useRef<HTMLSpanElement>(null);
  const pxLineRef = useRef<HTMLSpanElement>(null);
  const nowRef = useRef<HTMLSpanElement>(null);
  const rtRef = useRef<HTMLButtonElement>(null);
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  const tfBtnRef = useRef<HTMLButtonElement>(null);
  const indBtnRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<AnySeries | null>(null);
  const volRef = useRef<AnySeries | null>(null);
  const fundRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  const indRef = useRef<Map<string, AnySeries>>(new Map());
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const liveRef = useRef<Live | null>(null);
  const rowsRef = useRef<Candle[]>([]);
  const dataRef = useRef<Candle[]>([]);
  const modeRef = useRef(mode);
  const precRef = useRef(prec);
  const ivRef = useRef(ivSec);
  const palRef = useRef(pal);
  const magnetRef = useRef(magnet);
  const autoRef = useRef(true);
  const crossYRef = useRef<number | null>(null);
  const hoverRef = useRef(false);
  const drawingsRef = useRef(drawings);
  const draftRef = useRef(draft);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const viewKeyRef = useRef("");
  const fadedBuildRef = useRef(-1);
  const fitNextRef = useRef(false);
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null);
  const pinElsRef = useRef(new Map<string, HTMLElement>());
  const pinGroupsRef = useRef<PinGroup[]>([]);
  const pinVerRef = useRef(0);
  const plElsRef = useRef(new Map<number, HTMLElement>());
  const linesRef = useRef<PriceLine[]>([]);
  const plVerRef = useRef(0);
  const fundLastRef = useRef<{ time: number; rate: number } | null>(null);
  const legendElRef = useRef<HTMLDivElement | null>(null);
  const legendRORef = useRef<ResizeObserver | null>(null);
  const marginRef = useRef({ top: -1, bottom: -1, pending: false });
  const showVolRef = useRef(showVol);
  const priceModeRef = useRef(priceMode);
  const wideRef = useRef(true);
  const openerRef = useRef<HTMLElement | null>(null);
  const vp = useMemo(createViewport, []);
  modeRef.current = mode;
  precRef.current = prec;
  ivRef.current = ivSec;
  palRef.current = pal;
  magnetRef.current = magnet;
  drawingsRef.current = drawings;
  draftRef.current = draft;
  rowsRef.current = rows;
  dataRef.current = candles;
  linesRef.current = lines;
  showVolRef.current = showVol;
  priceModeRef.current = priceMode;

  /* ---------- the rail follows the chart's width until the trader chooses (with a little hysteresis) ---------- */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setOverPlaceholder(!!el.closest(".card")?.querySelector(".tm-lay-ph"));
    const check = (w: number) => {
      const next = wideRef.current ? w >= RAIL_FOLD_W : w >= RAIL_OPEN_W;
      if (next === wideRef.current) return;
      wideRef.current = next;
      setWideChart(next);
    };
    check(el.clientWidth);
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width;
      if (w) check(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * the axis labels under the html price tag step aside, as tradingview's (and the mock's) do. the
   * library caches its marks, so the frame loop asks for a rebuild only when a label should hide or
   * show; this hook records which ticks it saw and hid.
   */
  const tagZoneRef = useRef<{ top: number; bottom: number } | null>(null);
  const ticksRef = useRef<{ prices: number[]; hidden: boolean[] }>({ prices: [], hidden: [] });
  const tickHook = useCallback<TickHook>((prices, labels) => {
    const z = tagZoneRef.current;
    const s = modeRef.current === "chart" ? mainRef.current : fundRef.current;
    const hidden = prices.map((v) => {
      if (!z || !s) return false;
      const y = s.priceToCoordinate(v);
      return y !== null && y > z.top && y < z.bottom;
    });
    ticksRef.current = { prices: prices.slice(), hidden };
    return labels.map((l, i) => (hidden[i] ? "" : l));
  }, []);

  /**
   * room for the legend, as the mock leaves it: the top price margin is sized from the legend's
   * height, so at rest the newest highs never run under it (phones wrap it onto four lines).
   * hovering can change the legend's height; the margin waits until the crosshair leaves.
   */
  const fitMargins = useCallback(() => {
    const c = chartRef.current;
    const m = marginRef.current;
    if (!c) return;
    if (crossYRef.current !== null) {
      m.pending = true;
      return;
    }
    m.pending = false;
    let paneH = 0;
    try {
      paneH = c.paneSize().height;
    } catch {
      return;
    }
    if (paneH < 40) return;
    let top = 0.16;
    let bottom = 0.1;
    if (modeRef.current === "chart") {
      const el = legendElRef.current;
      const need = el ? (el.offsetTop + el.offsetHeight + 12) / paneH : 0.13;
      top = Math.round(Math.min(0.32, Math.max(0.1, need)) * 200) / 200;
      bottom = showVolRef.current ? 0.2 : 0.08;
    }
    if (top === m.top && bottom === m.bottom) return;
    m.top = top;
    m.bottom = bottom;
    c.priceScale("right").applyOptions({ scaleMargins: { top, bottom } });
  }, []);
  const legendBox = useCallback(
    (el: HTMLDivElement | null) => {
      legendRORef.current?.disconnect();
      legendRORef.current = null;
      legendElRef.current = el;
      if (!el) return;
      const ro = new ResizeObserver(() => fitMargins());
      ro.observe(el);
      legendRORef.current = ro;
    },
    [fitMargins],
  );
  useEffect(() => () => legendRORef.current?.disconnect(), []);

  /* ---------- create the chart once ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = palRef.current;
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
    const c = createChart(host, {
      width: Math.max(1, Math.floor(host.clientWidth)),
      height: Math.max(1, Math.floor(host.clientHeight)),
      autoSize: false,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: p.text, fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", attributionLogo: false, panes: { separatorColor: p.border, separatorHoverColor: withAlpha(p.brand, 0.2), enableResize: false } },
      grid: { vertLines: { color: p.gridV }, horzLines: { color: p.grid } },
      rightPriceScale: { borderVisible: true, borderColor: p.border, scaleMargins: { top: 0.13, bottom: 0.2 }, minimumWidth: 78, entireTextOnly: true },
      timeScale: { borderVisible: true, borderColor: p.border, timeVisible: true, secondsVisible: false, rightOffset: 7, barSpacing: 9, minBarSpacing: 0.4, shiftVisibleRangeOnNewBar: true, allowBoldLabels: false, tickMarkFormatter: (t: Time, type: TickMarkType) => fmtTick(Number(t), type) },
      crosshair: {
        mode: magnetRef.current ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal,
        vertLine: { color: p.cross, width: 1, style: LineStyle.Dashed, labelBackgroundColor: p.crossLabel },
        horzLine: { color: p.cross, width: 1, style: LineStyle.Dashed, labelBackgroundColor: p.crossLabel },
      },
      localization: { locale: "en-US", timeFormatter: (t: Time) => fmtCrossTime(Number(t), ivRef.current < 86400) },
      // vertical swipes scroll the page on phones; horizontal swipes and pinches drive the chart
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = c;
    c.subscribeCrosshairMove((e) => {
      crossYRef.current = e.point ? e.point.y : null;
      if (!e.point && marginRef.current.pending) fitMargins();
    });
    // canvas text cannot read css variables: hand it geist mono by name once the face is in
    if (mono) {
      const fam = mono.split(",")[0].trim();
      document.fonts
        ?.load(`11px ${fam}`)
        .then(() => chartRef.current?.applyOptions({ layout: { fontFamily: mono } }))
        .catch(() => {});
    }
    // our own resize: the same bars stay in view while the pane is dragged, collapsed or fullscreened
    let w = Math.floor(host.clientWidth);
    let h = Math.floor(host.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const nw = Math.floor(r.width);
      const nh = Math.floor(r.height);
      if (nw < 24 || nh < 24 || (nw === w && nh === h)) return;
      const ts = c.timeScale();
      const range = w >= 24 ? ts.getVisibleLogicalRange() : null;
      c.resize(nw, nh, true);
      if (range && nw !== w) ts.setVisibleLogicalRange(range);
      if (nh !== h) fitMargins();
      w = nw;
      h = nh;
    });
    ro.observe(host);
    setChart(c);
    return () => {
      ro.disconnect();
      c.remove();
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
      fundRef.current = null;
      markersRef.current = null;
      indRef.current.clear();
      priceLinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- (re)build the series for the chart type / view ---------- */
  useEffect(() => {
    const c = chart;
    if (!c) return;
    const p = palRef.current;
    const ts = c.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (mainRef.current && r) savedRangeRef.current = { from: r.from, to: r.to };
    try {
      markersRef.current?.detach();
    } catch {}
    markersRef.current = null;
    for (const s of indRef.current.values()) c.removeSeries(s);
    indRef.current.clear();
    priceLinesRef.current = [];
    for (const s of [mainRef.current, volRef.current, fundRef.current]) if (s) c.removeSeries(s as AnySeries);
    mainRef.current = null;
    volRef.current = null;
    fundRef.current = null;
    liveRef.current = null;
    if (mode === "funding") {
      fundRef.current = c.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        lineWidth: 2,
        topLineColor: p.brand,
        topFillColor1: p.fundUp,
        topFillColor2: withAlpha(p.fundUp, 0.08),
        bottomLineColor: p.down,
        bottomFillColor1: withAlpha(p.fundDown, 0.08),
        bottomFillColor2: p.fundDown,
        // the glass tag on the scale replaces the flat canvas label (see the frame loop)
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: fundFmt(tickHook),
      });
    } else {
      mainRef.current = addMain(c, chartType, p);
      volRef.current = c.addCustomSeries(new SoftVolumeSeries(), { ...volStyle(p, theme), priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false, visible: showVol }) as unknown as AnySeries;
      c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 }, visible: false });
      markersRef.current = createSeriesMarkers(mainRef.current, []);
    }
    fitMargins();
    setBuild((b) => b + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, mode, chartType]);

  /* ---------- candles + volume ---------- */
  useEffect(() => {
    const c = chart;
    const main = mainRef.current;
    const vol = volRef.current;
    if (!c || !main || !q.data || mode !== "chart") return;
    const ts = c.timeScale();
    const key = `${coin}|${interval}|${bars}`;
    const fresh = viewKeyRef.current !== key;
    // the zoom the user had on the previous interval or market, read before the new bars land
    const before = fresh && viewKeyRef.current ? ts.getVisibleLogicalRange() : null;
    main.applyOptions({ priceFormat: priceFmt(prec, tickHook) });
    main.setData(rows.map((x) => toPoint(chartType, x)) as never);
    setDrawn(true);
    vol?.setData(q.data.map((x) => ({ time: x.time as UTCTimestamp, value: x.volume, up: x.close >= x.open })) as never);
    // new bars arrive with a short fade (opacity only, nothing moves), not a hard cut
    if ((fresh || build !== fadedBuildRef.current) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      hostRef.current?.animate([{ opacity: fadedBuildRef.current < 0 ? 0 : 0.35 }, { opacity: 1 }], { duration: fadedBuildRef.current < 0 ? 520 : 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    fadedBuildRef.current = build;
    if (fresh) {
      // a new market, interval or range: frame it once. refetches never move the view.
      // like tradingview, a new interval keeps the zoom (bars in view) and snaps to now
      viewKeyRef.current = key;
      savedRangeRef.current = null;
      if (fitNextRef.current) ts.fitContent();
      else if (before && rows.length > 1) {
        const off = ts.options().rightOffset;
        const span = Math.min(Math.max(before.to - before.from, 20), rows.length + off);
        ts.setVisibleLogicalRange({ from: rows.length - 1 + off - span, to: rows.length - 1 + off });
      } else ts.resetTimeScale();
      fitNextRef.current = false;
      c.priceScale("right").applyOptions({ autoScale: true });
    } else if (savedRangeRef.current) {
      ts.setVisibleLogicalRange(savedRangeRef.current);
      savedRangeRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, rows, build]);

  /* ---------- the live bar ---------- */
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !live || mode !== "chart" || !q.data) {
      liveRef.current = null;
      return;
    }
    try {
      main.update(toPoint(chartType, live.row) as never);
    } catch {}
    liveRef.current = live;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, build]);

  /* ---------- funding ---------- */
  const fundFitRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  useEffect(() => {
    const f = fundRef.current;
    fundLastRef.current = mode === "funding" ? (funding.data?.at(-1) ?? null) : null;
    if (!f || !funding.data || mode !== "funding") return;
    f.setData(funding.data.map((r) => ({ time: Math.floor(r.time / 1000) as UTCTimestamp, value: r.rate })));
    // frame the week once per visit; later refreshes keep the view
    if (fundFitRef.current !== f) {
      fundFitRef.current = f;
      chart?.timeScale().fitContent();
      chart?.priceScale("right").applyOptions({ autoScale: true });
    }
  }, [funding.data, build, mode, chart]);

  /* ---------- volume visibility, price scale mode, magnet ---------- */
  useEffect(() => {
    if (!chart || mode !== "chart") return;
    volRef.current?.applyOptions({ visible: showVol });
    fitMargins();
  }, [chart, showVol, build, mode, fitMargins]);
  useEffect(() => {
    chart?.priceScale("right").applyOptions({ mode: priceMode });
  }, [chart, priceMode, build]);
  useEffect(() => {
    chart?.applyOptions({ crosshair: { mode: magnet ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal } });
  }, [chart, magnet]);

  /* ---------- theme ---------- */
  useEffect(() => {
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: pal.text, panes: { separatorColor: pal.border } },
      grid: { vertLines: { color: pal.gridV }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border },
      crosshair: { vertLine: { color: pal.cross, labelBackgroundColor: pal.crossLabel }, horzLine: { color: pal.cross, labelBackgroundColor: pal.crossLabel } },
    });
    mainRef.current?.applyOptions(mainStyle(chartType, pal) as never);
    fundRef.current?.applyOptions({ topLineColor: pal.brand, topFillColor1: pal.fundUp, topFillColor2: withAlpha(pal.fundUp, 0.08), bottomLineColor: pal.down, bottomFillColor1: withAlpha(pal.fundDown, 0.08), bottomFillColor2: pal.fundDown });
    volRef.current?.applyOptions(volStyle(pal, theme) as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pal, chart]);

  /* ---------- indicators ---------- */
  useEffect(() => {
    const c = chart;
    if (!c || mode !== "chart" || !mainRef.current) return;
    const keep = new Set(Object.keys(indData));
    for (const [k, s] of indRef.current)
      if (!keep.has(k)) {
        c.removeSeries(s);
        indRef.current.delete(k);
      }
    const times = candles.map((x) => x.time as UTCTimestamp);
    for (const id of IND_IDS) {
      const d = indData[id];
      if (!d) continue;
      const color = pal.ind[id];
      let s = indRef.current.get(id);
      if (d.kind === "band") {
        const opts = { lineColor: color, fillAlpha: theme === "light" ? 0.06 : 0.07, lastValueVisible: false, priceLineVisible: false };
        if (!s) {
          s = c.addCustomSeries(new BandSeries(), opts) as unknown as AnySeries;
          indRef.current.set(id, s);
        } else s.applyOptions(opts as never);
        s.setData(times.map((time, i) => (Number.isFinite(d.upper[i]) ? { time, upper: d.upper[i], mid: d.mid[i], lower: d.lower[i] } : { time })) as never);
      } else {
        // the hero average (ema 20) gets the mock's treatment: a halo and a fade-in from the left
        const hero = id === "ema20";
        const opts = { lineColor: color, lineWidth: hero ? 1.7 : 1.4, halo: hero ? (theme === "light" ? 0.07 : 0.16) : 0, fade: hero ? 0.32 : 0.62, dashed: id === "vwap", lastValueVisible: false, priceLineVisible: false };
        if (!s) {
          s = c.addCustomSeries(new GlowLineSeries(), opts) as unknown as AnySeries;
          indRef.current.set(id, s);
        } else s.applyOptions(opts as never);
        s.setData(times.map((time, i) => (Number.isFinite(d.values[i]) ? { time, value: d.values[i] } : { time })) as never);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indData, build, pal, chart]);

  /* ---------- the indicators ride the live bar between fetches (declared after setData above) ---------- */
  useEffect(() => {
    if (!live || mode !== "chart") return;
    const time = live.time as UTCTimestamp;
    for (const [id, v] of Object.entries(liveInd) as [Ind, IndValue][]) {
      const s = indRef.current.get(id);
      if (!s) continue;
      try {
        s.update((typeof v === "number" ? { time, value: v } : { time, upper: v.upper, mid: v.mid, lower: v.lower }) as never);
      } catch {}
    }
    // build / pal: a rebuilt or restyled series starts from the fetched values again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveInd, build, pal]);

  /* ---------- order / position price lines ---------- */
  useEffect(() => {
    const s = mainRef.current;
    if (!s) return;
    for (const l of priceLinesRef.current)
      try {
        s.removePriceLine(l);
      } catch {}
    // the canvas draws the line; the glass tags on the scale are html (see .tm-chart-pl)
    priceLinesRef.current = lines.map((l) => s.createPriceLine({ price: l.px, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: false, title: "" }));
    plVerRef.current++;
  }, [lines, build]);

  /* ---------- my trades: series arrows in up/down ---------- */
  useEffect(() => {
    const m = markersRef.current;
    if (!m) return;
    if (!showMine || !candles.length) return m.setMarkers([]);
    const first = candles[0].time;
    const list: SeriesMarker<Time>[] = markers
      .filter((x) => x.kind === "mine" && x.time / 1000 >= first)
      .sort((a, b) => a.time - b.time)
      .map((x) => {
        const i = barIndexAt(candles, x.time / 1000);
        const short = x.side === "SHORT";
        return {
          time: candles[Math.max(0, i)].time as UTCTimestamp,
          position: short ? "aboveBar" : "belowBar",
          shape: short ? "arrowDown" : x.side === "LONG" ? "arrowUp" : "circle",
          color: short ? pal.down : x.side === "LONG" ? pal.up : pal.textStrong,
          text: x.label,
          size: 1,
        };
      });
    m.setMarkers(list);
  }, [markers, showMine, candles, pal, build]);

  /* ---------- thesis pins: grouped per bar and side ---------- */
  const pinGroups = useMemo<PinGroup[]>(() => {
    if (!showThesis || mode !== "chart" || !rows.length) return [];
    const map = new Map<string, PinGroup>();
    for (const m of markers) {
      if (m.kind !== "thesis") continue;
      const i = barIndexAt(rows, m.time / 1000);
      if (i < 0) continue;
      const bar = rows[i];
      const side = m.side === "SHORT" ? "SHORT" : "LONG";
      const key = `${bar.time}:${side}`;
      let g = map.get(key);
      if (!g) {
        g = { id: key, time: bar.time, price: m.px && m.px > 0 ? m.px : side === "SHORT" ? bar.high : bar.low, side, items: [] };
        map.set(key, g);
      }
      g.items.push(m);
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [markers, rows, showThesis, mode]);
  pinGroupsRef.current = pinGroups;
  useEffect(() => {
    pinVerRef.current++;
  }, [pinGroups]);
  const registerPin = useCallback((id: string, el: HTMLElement | null) => {
    if (el) pinElsRef.current.set(id, el);
    else pinElsRef.current.delete(id);
    pinVerRef.current++;
  }, []);

  /* ---------- the frame loop: tag, countdown, price line, glow, pins, realtime button ---------- */
  useEffect(() => {
    const c = chart;
    const pane = paneRef.current;
    if (!c || !pane) return;
    const st = { sig: "", pinSig: "", plSig: "", px: "", cd: "", dir: "", y: NaN, x: NaN, w: NaN, aw: NaN, ah: NaN, edge: "", under: false, ly: NaN, lw: NaN, nx: NaN, ny: NaN, on: false, rt: false, n: 0, pinW: -1, rl: -99 };
    const pinW = new Map<string, [number, number]>();
    const pinD = new Map<string, number>();
    const show = (el: Element | null, on: boolean) => el?.toggleAttribute("data-on", on);
    /** the library caches its axis marks: rebuild them (a format change) only when a label should hide or show */
    const relabel = (s: AnySeries | ISeriesApi<"Baseline"> | null) => {
      // the percent scale formats its own labels (the hook never sees them): leave it be
      if (!s || priceModeRef.current === 2 || st.n - st.rl < 8) return;
      const t = ticksRef.current;
      const z = tagZoneRef.current;
      let stale = false;
      for (let i = 0; i < t.prices.length && !stale; i++) {
        const ty = z ? s.priceToCoordinate(t.prices[i]) : null;
        stale = (ty !== null && ty > z!.top && ty < z!.bottom) !== t.hidden[i];
      }
      if (!stale) return;
      st.rl = st.n;
      if (s === fundRef.current) s.applyOptions({ priceFormat: fundFmt(tickHook) });
      else s.applyOptions({ priceFormat: priceFmt(precRef.current, tickHook) });
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      st.n++;
      let paneW = 0;
      let paneH = 0;
      try {
        const s = c.paneSize();
        paneW = s.width;
        paneH = s.height;
      } catch {
        return;
      }
      if (paneW < 4 || paneH < 4) return;
      const ts = c.timeScale();
      const main = mainRef.current;
      const isChart = modeRef.current === "chart";
      // the live value: the last bar's close on the price chart, the latest rate on the funding view
      const lv = isChart ? liveRef.current : null;
      const fl = isChart ? null : fundLastRef.current;
      const fs = isChart ? null : fundRef.current;
      const range = ts.getVisibleLogicalRange();
      const yA = lv && main ? main.priceToCoordinate(lv.row.close) : fl && fs ? fs.priceToCoordinate(fl.rate) : null;
      // the viewport signature uses a fixed reference price, so live ticks alone do not redraw the drawings
      const ref = dataRef.current[0]?.close;
      const r1 = main && ref ? main.priceToCoordinate(ref) : null;
      const r2 = main && ref ? main.priceToCoordinate(ref * 1.01) : null;
      const sig = `${range ? range.from.toFixed(3) : ""}|${range ? range.to.toFixed(3) : ""}|${r1 === null ? "" : r1.toFixed(2)}|${r2 === null ? "" : r2.toFixed(2)}|${paneW}|${paneH}`;
      const moved = sig !== st.sig;
      if (moved) {
        st.sig = sig;
        vp.bump();
      }
      if (st.n % 12 === 0) {
        const a = c.priceScale("right").options().autoScale;
        if (a !== autoRef.current) {
          autoRef.current = a;
          setAutoScale(a);
        }
      }
      const axisW = c.priceScale("right").width();
      const axisH = ts.height();
      if (axisW !== st.aw || axisH !== st.ah) {
        st.aw = axisW;
        st.ah = axisH;
        pane.style.setProperty("--tm-axis", `${axisW}px`);
        pane.style.setProperty("--tm-taxis", `${axisH}px`);
      }
      const tag = tagRef.current;
      const line = pxLineRef.current;
      const now = nowRef.current;
      const rt = rtRef.current;
      if (yA === null || (!lv && !fl) || !tag || !line || !now || !rt) {
        if (st.on) {
          st.on = false;
          show(tag, false);
          show(line, false);
          show(now, false);
          show(rt, false);
          st.rt = false;
        }
        if (tagZoneRef.current) {
          tagZoneRef.current = null;
          relabel(lv ? main : fl ? fundRef.current : null);
        }
        return;
      }
      if (!st.on) {
        st.on = true;
        show(tag, true);
      }
      const nowSec = Date.now() / 1000;
      // the tag: the close and the time left on the bar; on the funding view, the rate and the time to the next hourly payment
      const pxText = lv ? fmtFixed(lv.row.close, precRef.current) : fundText(fl!.rate);
      if (pxText !== st.px) {
        st.px = pxText;
        if (tagPxRef.current) tagPxRef.current.textContent = pxText;
      }
      const cd = lv ? fmtCountdown(lv.time + lv.ivSec - nowSec) : fmtCountdown(3600 - (nowSec % 3600));
      if (cd !== st.cd) {
        st.cd = cd;
        if (tagCdRef.current) tagCdRef.current.textContent = cd;
      }
      const dir = lv ? lv.dir : fl!.rate < 0 ? "down" : "brand";
      if (dir !== st.dir) {
        st.dir = dir;
        tag.dataset.dir = dir;
        line.dataset.dir = dir;
        now.dataset.dir = dir;
      }
      // the tag rides the price scale; past an edge it parks there, dimmed
      const edge = yA < 11 ? "top" : yA > paneH - 11 ? "bottom" : "";
      const y = Math.round(Math.min(Math.max(yA, 11), paneH - 11));
      if (y !== st.y || paneW !== st.x || axisW !== st.w) {
        st.y = y;
        st.x = paneW;
        st.w = axisW;
        tag.style.transform = `translate3d(${paneW}px, ${y}px, 0)`;
        tag.style.width = `${axisW}px`;
      }
      if (edge !== st.edge) {
        st.edge = edge;
        // drop the attribute when back in range ([data-edge=""] would still match the dimmed rule)
        if (edge) tag.dataset.edge = edge;
        else delete tag.dataset.edge;
      }
      // the axis labels under the tag (price cell and countdown, with air for the glyphs) step aside
      const zone = tagZoneRef.current;
      if (!zone || zone.top !== y - TAG_ABOVE || zone.bottom !== y + TAG_BELOW) tagZoneRef.current = { top: y - TAG_ABOVE, bottom: y + TAG_BELOW };
      if (!moved) relabel(lv ? main : fundRef.current);
      const cy = crossYRef.current;
      const under = cy !== null && cy > y - 16 && cy < y + 30;
      if (under !== st.under) {
        st.under = under;
        tag.toggleAttribute("data-under", under);
      }
      // the price line spans the pane, as tradingview's (and the mock's) does, gathering light toward the tag
      const inY = !edge;
      show(line, inY);
      if (inY && (y !== st.ly || paneW !== st.lw)) {
        st.ly = y;
        st.lw = paneW;
        line.style.transform = `translate3d(0, ${y}px, 0)`;
        line.style.width = `${paneW}px`;
      }
      // the pool of light under "now"
      const xLast = lv ? ts.logicalToCoordinate(lv.idx as Logical) : ts.timeToCoordinate(Math.floor(fl!.time / 1000) as UTCTimestamp);
      const glowOn = inY && xLast !== null && xLast >= 0 && xLast <= paneW;
      show(now, glowOn);
      if (glowOn && (xLast !== st.nx || y !== st.ny)) {
        st.nx = xLast!;
        st.ny = y;
        now.style.transform = `translate3d(${Math.round(xLast!)}px, ${y}px, 0)`;
      }
      // scroll to realtime: when the live bar is out of view
      const off = xLast === null || xLast > paneW + 1 || xLast < -1;
      if (off !== st.rt) {
        st.rt = off;
        show(rt, off);
      }
      if (!lv || !main) return;
      // order and position lines: their glass tags ride the scale too
      const plSig = `${sig}|${plVerRef.current}`;
      if (plSig !== st.plSig) {
        st.plSig = plSig;
        linesRef.current.forEach((pl, i) => {
          const el = plElsRef.current.get(i);
          if (!el) return;
          const py = main.priceToCoordinate(pl.px);
          const hide = py === null || py < 8 || py > paneH - 8;
          el.toggleAttribute("data-hidden", hide);
          if (!hide) el.style.transform = `translate3d(0, ${Math.round(py!)}px, 0)`;
        });
      }
      // thesis pins follow their bar and price. each callout finds clear air under the lows beside it
      // (over the highs for a short), with the stem tying it back to its bar, as the mock's flag sits
      const pinSig = `${sig}|${pinVerRef.current}`;
      if (pinSig !== st.pinSig) {
        st.pinSig = pinSig;
        const els = pinElsRef.current;
        // callout widths change only when the pins render: measure them then, before this frame writes
        if (st.pinW !== pinVerRef.current) {
          st.pinW = pinVerRef.current;
          pinD.clear();
          for (const el of els.values()) el.removeAttribute("data-c");
          for (const [id, el] of els) {
            const t = el.querySelector<HTMLElement>(".tm-chart-pin-tag");
            const f = el.querySelector<HTMLElement>(".tm-chart-pin-faces");
            pinW.set(id, [t?.offsetWidth || 140, (f?.offsetWidth || 15) + 9]);
          }
        }
        const rs = rowsRef.current;
        /** the distance from the bar to the callout's centre that clears every wick under its span */
        const need = (px: number, py: number, w: number, flip: boolean, below: boolean) => {
          const x0 = flip ? px - PIN_X - w : px + PIN_X;
          const l0 = ts.coordinateToLogical(x0 - 4);
          const l1 = ts.coordinateToLogical(x0 + w + 4);
          let ext = py;
          if (l0 !== null && l1 !== null) {
            for (let i = Math.max(0, Math.floor(l0)), b = Math.min(rs.length - 1, Math.ceil(l1)); i <= b; i++) {
              const yy = main.priceToCoordinate(below ? rs[i].low : rs[i].high);
              if (yy !== null) ext = below ? Math.max(ext, yy) : Math.min(ext, yy);
            }
          }
          return Math.max(PIN_REST, (below ? ext - py : py - ext) + PIN_GAP + PIN_HALF);
        };
        /** the side with the most air that the callout fits on (the right edge decides a tie), and its distance */
        const place = (px: number, py: number, w: number, below: boolean) => {
          const lean = px > paneW * 0.62;
          let best: { flip: boolean; d: number } | null = null;
          for (const flip of [lean, !lean]) {
            const fits = flip ? px - PIN_X - w >= 2 : px + PIN_X + w <= paneW - 2;
            if (!fits) continue;
            const d = need(px, py, w, flip, below);
            if (!best || d < best.d - 0.5) best = { flip, d };
          }
          return best ?? { flip: lean, d: need(px, py, w, lean, below) };
        };
        const room = (py: number, below: boolean) => Math.max(PIN_REST, below ? paneH - 6 - PIN_HALF - py : py - 6 - PIN_HALF);
        // a folded callout is small, so it may ride a longer stem to reach clear air; neither leaves the pane
        const clampD = (d: number, folded: boolean, py: number, below: boolean) => Math.round(Math.min(d, PIN_REST + (folded ? PIN_STRETCH_FOLDED : PIN_STRETCH), room(py, below)));
        type Placed = { el: HTMLElement; id: string; x: number; y: number; below: boolean; flip: boolean; d: number; w: number; c: boolean };
        const pos: Placed[] = [];
        for (const g of pinGroupsRef.current) {
          const el = els.get(g.id);
          if (!el) continue;
          const px = ts.timeToCoordinate(g.time as UTCTimestamp);
          const py = main.priceToCoordinate(g.price);
          if (px === null || py === null || px < -30 || px > paneW + 2 || py < -24 || py > paneH + 24) {
            el.setAttribute("data-hidden", "");
            continue;
          }
          el.removeAttribute("data-hidden");
          el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
          const below = g.side !== "SHORT";
          const [wFull, wFaces] = pinW.get(g.id) ?? [140, 32];
          // the full callout when it finds clear air on a short stem; otherwise it folds to its faces
          // (the hover card has the rest), so a thesis never sits on the price action it is about
          let at = place(px, py, wFull, below);
          let w = wFull;
          let c = false;
          if (at.d > PIN_REST + PIN_STRETCH) {
            at = place(px, py, wFaces, below);
            w = wFaces;
            c = true;
          }
          pos.push({ el, id: g.id, x: px, y: py, below, flip: at.flip, d: clampD(at.d, c, py, below), w, c });
        }
        // neighbours whose callouts would touch: the later one folds too
        pos.sort((a, b) => a.x - b.x);
        const box = (q: Placed) => {
          const x0 = q.flip ? q.x - PIN_X - q.w : q.x + PIN_X;
          const yc = q.y + (q.below ? q.d : -q.d);
          return { x0, x1: x0 + q.w, y0: yc - PIN_HALF, y1: yc + PIN_HALF };
        };
        pos.forEach((p, i) => {
          if (p.c) return;
          const a = box(p);
          const hit = pos.slice(0, i).some((q) => {
            const b = box(q);
            return a.x0 < b.x1 + 6 && b.x0 < a.x1 + 6 && a.y0 < b.y1 + 4 && b.y0 < a.y1 + 4;
          });
          if (!hit) return;
          const [, wFaces] = pinW.get(p.id) ?? [140, 32];
          const at = place(p.x, p.y, wFaces, p.below);
          Object.assign(p, { flip: at.flip, d: clampD(at.d, true, p.y, p.below), w: wFaces, c: true });
        });
        for (const p of pos) {
          const d = p.d;
          p.el.toggleAttribute("data-flip", p.flip);
          p.el.toggleAttribute("data-c", p.c);
          p.el.toggleAttribute("data-up", p.y + (p.below ? d : -d) > paneH * 0.56);
          // the hover card opens toward the room it has
          p.el.toggleAttribute("data-cflip", p.flip ? p.x - PIN_X - PIN_CARD_W >= 2 : p.x + PIN_X + PIN_CARD_W > paneW - 2);
          if (pinD.get(p.id) !== d) {
            pinD.set(p.id, d);
            p.el.style.setProperty("--d", `${d}px`);
          }
        }
      }
    };
    let raf = 0;
    let running = false;
    let inView = true;
    const start = () => {
      if (running || !inView || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // the loop only runs while the chart is on screen and the tab is visible
    const io = new IntersectionObserver((es) => {
      inView = es.some((e) => e.isIntersecting);
      if (inView) start();
      else stop();
    });
    io.observe(pane);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    start();
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [chart, vp, tickHook]);

  /* the svg pen layer sits over the canvas: hand wheel zoom/scroll through to the chart */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!svg.hasAttribute("data-active")) return;
      e.preventDefault();
      const prev = svg.style.pointerEvents;
      svg.style.pointerEvents = "none";
      const under = document.elementFromPoint(e.clientX, e.clientY);
      svg.style.pointerEvents = prev;
      if (under && under !== svg && hostRef.current?.contains(under)) under.dispatchEvent(new WheelEvent("wheel", e));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------- drawings: per coin, persisted (debounced while dragging) ---------- */
  useEffect(() => {
    try {
      const v = JSON.parse(readPref(`sl:draw:${coin}`) ?? "[]");
      setDrawings(Array.isArray(v) ? v : []);
    } catch {
      setDrawings([]);
    }
    setSelected(null);
    setDraft(null);
  }, [coin]);
  useEffect(() => {
    const t = setTimeout(() => writePref(`sl:draw:${coin}`, JSON.stringify(drawings.filter((d) => d.type !== "ruler"))), 250);
    return () => clearTimeout(t);
  }, [drawings, coin]);

  /* ---------- coordinate helpers ---------- */
  const xOf = useCallback((t: number): number | null => {
    const ts = chartRef.current?.timeScale();
    const d = dataRef.current;
    if (!ts || !d.length) return null;
    const direct = ts.timeToCoordinate(t as UTCTimestamp);
    if (direct !== null) return direct;
    const last = d[d.length - 1];
    return ts.logicalToCoordinate((d.length - 1 + (t - last.time) / ivRef.current) as Logical);
  }, []);
  const tOf = useCallback((x: number): number | null => {
    const ts = chartRef.current?.timeScale();
    const d = dataRef.current;
    if (!ts || !d.length) return null;
    const logical = ts.coordinateToLogical(x);
    if (logical === null) return null;
    const i = Math.round(Number(logical));
    if (i >= 0 && i < d.length) return d[i].time;
    const last = d[d.length - 1];
    return last.time + (i - (d.length - 1)) * ivRef.current;
  }, []);
  const yOf = useCallback((p: number) => mainRef.current?.priceToCoordinate(p) ?? null, []);
  const paneWidth = useCallback(() => {
    try {
      return chartRef.current?.paneSize().width ?? 0;
    } catch {
      return 0;
    }
  }, []);
  const axisWidth = useCallback(() => chartRef.current?.priceScale("right").width() ?? 0, []);
  /** a point under the pointer; with the magnet on it snaps to the nearest o/h/l/c within reach */
  const ptAt = useCallback((clientX: number, clientY: number): Pt | null => {
    const host = hostRef.current;
    const main = mainRef.current;
    if (!host || !main) return null;
    const r = host.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const t = tOf(x);
    const p = main.coordinateToPrice(y);
    if (t === null || p === null) return null;
    let price = Number(p);
    if (magnetRef.current) {
      const rs = rowsRef.current;
      const i = barIndexAt(rs, t);
      const bar = i >= 0 && rs[i]?.time === t ? rs[i] : null;
      if (bar) {
        let best = Infinity;
        for (const v of [bar.open, bar.high, bar.low, bar.close]) {
          const yy = main.priceToCoordinate(v);
          if (yy !== null && Math.abs(yy - y) < best && Math.abs(yy - y) < 28) {
            best = Math.abs(yy - y);
            price = v;
          }
        }
      }
    }
    return { t, p: price };
  }, [tOf]);

  /* ---------- drawing interactions ---------- */
  const finish = useCallback((d: Drawing) => {
    setDrawings((ds) => [...(d.type === "ruler" ? ds.filter((x) => x.type !== "ruler") : ds), d]);
    setDraft(null);
    setTool("cursor");
    if (d.type !== "ruler") setSelected(d.id);
  }, []);
  const follow = (pt: Pt) => {
    // keep tradingview's crosshair alive under the pen
    const c = chartRef.current;
    const main = mainRef.current;
    if (!c || !main) return;
    try {
      c.setCrosshairPosition(pt.p, pt.t as UTCTimestamp, main);
    } catch {}
  };
  const onDrawDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === "cursor" || locked || e.button !== 0) return;
    const pt = ptAt(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    if (tool === "hline") return finish({ id: uid(), type: "hline", a: pt });
    const cur = draftRef.current;
    if (!cur) {
      setDraft({ id: uid(), type: tool, a: pt, b: pt });
      downAt.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    finish({ ...cur, b: pt });
  };
  const onDrawMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === "cursor") return;
    const pt = ptAt(e.clientX, e.clientY);
    if (!pt) return;
    follow(pt);
    const cur = draftRef.current;
    if (cur) setDraft({ ...cur, b: pt });
  };
  const onDrawUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d0 = downAt.current;
    downAt.current = null;
    const cur = draftRef.current;
    if (!cur || !d0) return;
    // dragged: finish on release; clicked: wait for the second click
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 5) finish({ ...cur, b: ptAt(e.clientX, e.clientY) ?? cur.b });
  };
  const onShapeDown = useCallback(
    (e: ReactPointerEvent, id: string, part: Part) => {
      if (locked || tool !== "cursor" || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setSelected(id);
      const d0 = drawingsRef.current.find((x) => x.id === id);
      const start = ptAt(e.clientX, e.clientY);
      if (!d0 || !start || d0.type === "ruler") return;
      const move = (ev: PointerEvent) => {
        const pt = ptAt(ev.clientX, ev.clientY);
        if (!pt) return;
        const dt = pt.t - start.t;
        const dp = pt.p - start.p;
        setDrawings((ds) =>
          ds.map((x) => {
            if (x.id !== id) return x;
            if (x.type === "hline") return { ...x, a: { t: d0.a.t, p: d0.a.p + dp } };
            if (part === "a") return { ...x, a: pt };
            if (part === "b") return { ...x, b: pt };
            return { ...x, a: { t: d0.a.t + dt, p: d0.a.p + dp }, b: d0.b ? { t: d0.b.t + dt, p: d0.b.p + dp } : undefined };
          }),
        );
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [locked, tool, ptAt],
  );
  /** the zoom / scroll pill shows when the pointer nears the bottom of the pane, as in tradingview */
  const onPaneMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const near = e.clientY - r.top > r.height * 0.62;
    if (near !== el.hasAttribute("data-nav")) el.toggleAttribute("data-nav", near);
  };
  const removeInd = useCallback((id: Ind) => setInds((s) => s.filter((x) => x !== id)), []);
  /** right click: tradingview's chart menu, at the pointer */
  const onPaneContext = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== "chart" || !hostRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    const w = wrapRef.current;
    if (!w) return;
    const R = w.getBoundingClientRect();
    const x = Math.min(e.clientX - R.left, R.width - 250);
    const y = Math.min(e.clientY - R.top, R.height - 260);
    setMenu(null);
    setCtxMenu({ x: Math.max(6, x), y: Math.max(6, y), pt: ptAt(e.clientX, e.clientY) });
  };
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: Event) => {
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest(".tm-chart-ctx")) return;
      setCtxMenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [ctxMenu]);
  /** clicks on the canvas: clear selection and the measure; shift + drag measures, as in tradingview */
  const onPaneDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (menu) setMenu(null);
    if (mode !== "chart" || e.button !== 0 || tool !== "cursor") return;
    if (!hostRef.current?.contains(e.target as Node)) return;
    if (selected) setSelected(null);
    if (drawingsRef.current.some((d) => d.type === "ruler")) setDrawings((ds) => ds.filter((d) => d.type !== "ruler"));
    if (!e.shiftKey || locked) return;
    const pt = ptAt(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    e.stopPropagation();
    const d: Drawing = { id: uid(), type: "ruler", a: pt, b: pt };
    setDraft(d);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const p2 = ptAt(ev.clientX, ev.clientY);
      if (p2) setDraft({ ...d, b: p2 });
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const up = (ev: PointerEvent) => {
      done();
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) finish({ ...d, b: ptAt(ev.clientX, ev.clientY) ?? d.b });
      else setTool("ruler"); // a plain shift+click: the next click ends the measure
    };
    const cancel = () => {
      done();
      setDraft(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  /* ---------- navigation ---------- */
  // the library applies a new range on its next frame: queued steps build on the pending one
  const pendingRange = useRef<{ from: number; to: number } | null>(null);
  const setRangeSoon = useCallback((r: { from: number; to: number }) => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    pendingRange.current = r;
    ts.setVisibleLogicalRange(r);
    requestAnimationFrame(() => requestAnimationFrame(() => (pendingRange.current = null)));
  }, []);
  const currentRange = () => {
    const r = pendingRange.current ?? chartRef.current?.timeScale().getVisibleLogicalRange();
    return r ? { from: Number(r.from), to: Number(r.to) } : null;
  };
  const zoom = useCallback((f: number) => {
    const ts = chartRef.current?.timeScale();
    const r = currentRange();
    if (!ts || !r) return;
    // anchored at the right edge while the live bar is in view (tradingview), else at the centre
    const n = dataRef.current.length;
    const anchorRight = !pendingRange.current ? ts.scrollPosition() >= 0 : r.to >= n - 1;
    const span = Math.max(8, (r.to - r.from) * f);
    if (anchorRight) setRangeSoon({ from: r.to - span, to: r.to });
    else {
      const mid = (r.from + r.to) / 2;
      setRangeSoon({ from: mid - span / 2, to: mid + span / 2 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRangeSoon]);
  const pan = useCallback((dir: number, share = 0.25) => {
    const r = currentRange();
    if (!r) return;
    const step = Math.max(1, (r.to - r.from) * share) * dir;
    setRangeSoon({ from: r.from + step, to: r.to + step });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRangeSoon]);
  const reset = useCallback(() => {
    const c = chartRef.current;
    if (!c) return;
    c.timeScale().resetTimeScale();
    c.priceScale("right").applyOptions({ autoScale: true });
    autoRef.current = true;
    setAutoScale(true);
  }, []);
  const setAuto = (on: boolean) => {
    chartRef.current?.priceScale("right").applyOptions({ autoScale: on });
    autoRef.current = on;
    setAutoScale(on);
  };
  const pickInterval = (iv: Interval) => {
    setMode("chart");
    if (iv !== interval) setInterval_(iv);
  };
  const setRange = (iv: Interval, n: number) => {
    setMode("chart");
    const nb = rangeBars(n);
    if (iv === interval && nb === bars) {
      chartRef.current?.timeScale().fitContent();
      return;
    }
    fitNextRef.current = true;
    setInterval_(iv);
    setBars(nb);
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
  const pickTool = useCallback((t: Tool) => {
    setTool(t);
    setDraft(null);
    // a tool picked from the keyboard shows the rail, so the armed tool (and the way back) is in sight
    if (t !== "cursor") setRailPref(true);
  }, []);

  /* ---------- fullscreen ---------- */
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const toggleFull = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => setFull((f) => !f));
    else setFull((f) => !f);
  }, []);

  /*
   * keyboard: the chart answers when focus is inside it (a click on the canvas focuses the pane),
   * or when the pointer is over it and focus is not parked on another control: an arrow key meant
   * for a tab list or a slider elsewhere never also pans the chart. never while typing.
   */
  const keyState = useRef({ tool, draft, selected, menu, ctx: ctxMenu, full, locked, mode, zoom, pan, reset, pickTool, toggleFull });
  keyState.current = { tool, draft, selected, menu, ctx: ctxMenu, full, locked, mode, zoom, pan, reset, pickTool, toggleFull };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const wrap = wrapRef.current;
      if (!wrap || e.defaultPrevented || isTyping(e.target) || (e.target as HTMLElement | null)?.closest?.("[role=menu]")) return;
      const ae = document.activeElement;
      const focusFree = !ae || ae === document.body || ae === document.documentElement;
      if (!((ae && wrap.contains(ae)) || (hoverRef.current && focusFree))) return;
      const s = keyState.current;
      if (e.key === "Escape") {
        if (s.menu) return setMenu(null);
        if (s.ctx) return setCtxMenu(null);
        if (s.tool !== "cursor" || s.draft) {
          e.preventDefault();
          setTool("cursor");
          setDraft(null);
          return;
        }
        if (s.selected) return setSelected(null);
        setDrawings((ds) => (ds.some((d) => d.type === "ruler") ? ds.filter((d) => d.type !== "ruler") : ds));
        if (s.full && !document.fullscreenElement) setFull(false);
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.altKey) {
        const k = e.code;
        if (k === "KeyR") {
          e.preventDefault();
          s.reset();
        } else if (k === "KeyT" && s.mode === "chart" && !s.locked) {
          e.preventDefault();
          s.pickTool("trend");
        } else if (k === "KeyH" && s.mode === "chart" && !s.locked) {
          e.preventDefault();
          s.pickTool("hline");
        }
        return;
      }
      if (e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        s.toggleFull();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        s.zoom(0.8);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        s.zoom(1.25);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        s.pan(e.key === "ArrowLeft" ? -1 : 1, 0.06);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selected) {
        e.preventDefault();
        const id = s.selected;
        setDrawings((ds) => ds.filter((x) => x.id !== id));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- menus ---------- */
  const openMenu = (kind: "type" | "ind" | "tf", btn: HTMLButtonElement | null) => {
    if (menu?.kind === kind) return setMenu(null);
    const w = wrapRef.current;
    if (!w || !btn) return;
    const R = w.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const width = kind === "ind" ? 268 : kind === "tf" ? 190 : 236;
    const y = r.bottom - R.top + 6;
    openerRef.current = btn;
    setMenu({ kind, x: Math.max(8, Math.min(r.left - R.left - 6, R.width - width - 8)), y, h: Math.max(160, R.height - y - 10) });
  };
  useEffect(() => {
    if (!menu) return;
    const h = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // the chart's own triggers toggle their menus on click; anything else closes it
      const trigger = t.closest("[aria-haspopup=menu]");
      if (t.closest(".tm-chart-menu") || (trigger && wrapRef.current?.contains(trigger))) return;
      setMenu(null);
    };
    const bar = barRef.current;
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", h, true);
    bar?.addEventListener("scroll", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", h, true);
      bar?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  const closeMenu = useCallback(() => {
    setMenu(null);
    // focus goes back to whichever trigger opened it (the interval menu has two)
    openerRef.current?.focus();
  }, []);

  /* ---------- toolbar / footer scroll fades ---------- */
  useEffect(() => {
    const els = [barRef.current, footRef.current].filter(Boolean) as HTMLElement[];
    const upd = () => {
      for (const el of els) {
        el.toggleAttribute("data-fl", el.scrollLeft > 2);
        el.toggleAttribute("data-fr", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      }
    };
    upd();
    const ro = new ResizeObserver(upd);
    els.forEach((el) => {
      el.addEventListener("scroll", upd, { passive: true });
      ro.observe(el);
    });
    return () => {
      ro.disconnect();
      els.forEach((el) => el.removeEventListener("scroll", upd));
    };
  }, []);

  /* ---------- snapshot (chart-snapshot.tsx) ---------- */
  const snapshot = () => {
    const c = chartRef.current;
    const host = hostRef.current;
    if (!c || !host) return;
    const lv = liveRef.current;
    void downloadSnapshot({
      chart: c,
      host,
      svg: hidden || !drawings.length ? null : svgRef.current,
      pal: palRef.current,
      light: theme === "light",
      main: mode === "chart" ? mainRef.current : null,
      live: lv && mode === "chart" ? { close: lv.row.close, dir: lv.dir } : null,
      prec,
      title: `${coin}-USD`,
      subtitle: mode === "funding" ? "Funding · 7d" : `${intervalLabel(interval)} · Hyperliquid`,
      fileName: `${coin}-${interval}-${new Date().toISOString().slice(0, 19)}.png`,
    });
  };

  /* ---------- render ---------- */
  const ivLabel = intervalLabel(interval);
  const typeMeta = CHART_TYPES.find((t) => t[0] === chartType)!;
  const lastFunding = funding.data?.at(-1);
  const colors = pal.ind as Record<Ind, string>;
  const visibleDrawings = hidden || mode !== "chart" ? [] : draft ? [...drawings, draft] : drawings;
  const drawColors = useMemo(
    () => ({ line: pal.thesis, sel: pal.brand, up: pal.up, down: pal.down, bg: pal.bgTop, ink: theme === "light" ? "#ffffff" : "#04120d", muted: pal.text, font: "ui-monospace, SFMono-Regular, Menlo, monospace" }),
    [pal, theme],
  );
  const loadingFirst = q.isLoading && !drawn;
  const loadingNext = q.isLoading && drawn && mode === "chart";
  const noData = !q.isLoading && !q.isError && q.data !== undefined && q.data.length === 0;
  const showRail = railOpen && mode === "chart";

  return (
    <div
      ref={wrapRef}
      className="tm-chart"
      data-full={full || undefined}
      data-mode={mode}
      data-first={(loadingFirst && overPlaceholder) || undefined}
      onPointerEnter={() => (hoverRef.current = true)}
      onPointerLeave={() => {
        hoverRef.current = false;
        if (tool !== "cursor") chartRef.current?.clearCrosshairPosition();
      }}
    >
      {/* ---------- toolbar ---------- */}
      <div ref={barRef} className="tm-chart-bar" role="toolbar" aria-label="Chart tools">
        {/* phones: one interval button with a menu */}
        <button ref={tfBtnRef} type="button" className="tm-chart-tf tm-chart-tfdd" data-on={mode === "chart" || undefined} aria-haspopup="menu" aria-expanded={menu?.kind === "tf"} aria-label={`Interval: ${INTERVALS.find((x) => x[0] === interval)?.[2]}`} data-tip="Interval" onClick={(e) => openMenu("tf", e.currentTarget)}>
          {intervalLabel(interval)}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {/* the timeframe pills; on mid-size charts only the mock's five favourites stay out, the rest sit behind the chevron (tradingview's favourites) */}
        <div className="tm-chart-tfs" role="group" aria-label="Interval">
          {INTERVALS.map(([iv, label, spoken]) => (
            <button key={iv} type="button" className="tm-chart-tf" data-x={iv === "1m" || iv === "1w" || undefined} aria-pressed={mode === "chart" && interval === iv} data-tip={spoken} aria-label={spoken} onClick={() => pickInterval(iv)}>
              {label}
            </button>
          ))}
          <button type="button" className="tm-chart-tfmore" aria-haspopup="menu" aria-expanded={menu?.kind === "tf"} aria-label="All intervals" data-tip="All intervals" onClick={(e) => openMenu("tf", e.currentTarget)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
        <i className="tm-chart-sep" aria-hidden />
        <button ref={typeBtnRef} type="button" className="tm-chart-tool" aria-haspopup="menu" aria-expanded={menu?.kind === "type"} data-tip={`Chart type · ${typeMeta[1]}`} aria-label={`Chart type: ${typeMeta[1]}`} disabled={mode !== "chart"} onClick={(e) => openMenu("type", e.currentTarget)}>
          <CIcon n={chartType} size={16} />
        </button>
        <button ref={indBtnRef} type="button" className="tm-chart-tool tm-chart-fx" data-on={inds.length > 0 || undefined} aria-haspopup="menu" aria-expanded={menu?.kind === "ind"} data-tip="Indicators" aria-label="Indicators" disabled={mode !== "chart"} onClick={(e) => openMenu("ind", e.currentTarget)}>
          <span className="tm-chart-fx-g" aria-hidden>
            <i>f</i>x
          </span>
          <span className="tm-chart-lbl">Indicators</span>
          {inds.length > 0 && <span className="count">{inds.length}</span>}
        </button>
        <button type="button" className="tm-chart-tool" aria-pressed={showRail} data-tip={railOpen ? "Hide drawing tools" : "Drawing tools"} aria-label="Drawing tools" disabled={mode !== "chart"} onClick={() => setRailPref(!railOpen)}>
          <CIcon n="pencil" size={15} />
        </button>
        <span className="tm-chart-bar-end">
          <button type="button" role="switch" aria-checked={showMine} aria-label="My trades" className="tm-chart-pt" data-c="mine" data-tip="Your entries and exits on the chart" onClick={() => setShowMine((v) => !v)}>
            <i aria-hidden />
            <CIcon n="mine" size={14} className="tm-chart-pt-ico" />
            <span className="tm-chart-pt-l">My trades</span>
          </button>
          <button type="button" role="switch" aria-checked={showThesis} aria-label="Thesis" className="tm-chart-pt" data-c="thesis" data-tip="Traders' theses, pinned where they were posted" onClick={() => setShowThesis((v) => !v)}>
            <i aria-hidden />
            <CIcon n="thesis" size={14} className="tm-chart-pt-ico" />
            <span className="tm-chart-pt-l">Thesis</span>
          </button>
          <i className="tm-chart-sep" aria-hidden />
          <button type="button" className="tm-chart-tool tm-chart-text" aria-pressed={mode === "funding"} data-tip="Funding rate, hourly, last 7 days" aria-label="Funding history" onClick={() => setMode((m) => (m === "funding" ? "chart" : "funding"))}>
            <CIcon n="funding" size={14} />
            <span className="tm-chart-lbl">Funding</span>
          </button>
          <button type="button" className="tm-chart-tool" data-tip="Download a snapshot" aria-label="Download a snapshot" onClick={snapshot}>
            <Icon.camera />
          </button>
          <button type="button" className="tm-chart-tool" data-tip={full ? "Exit fullscreen" : "Fullscreen"} data-kbd="Shift F" aria-label={full ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFull}>
            {full ? <Icon.shrink /> : <Icon.expand />}
          </button>
        </span>
      </div>

      <div className="tm-chart-body">
        {/* ---------- drawing rail ---------- */}
        {showRail && (
          <div className="tm-chart-rail" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
            {(
              [
                ["cursor", "Cursor", "Esc", <Icon.cursor key="c" />],
                ["trend", "Trend line", "Alt T", <Icon.trend key="t" />],
                ["hline", "Horizontal line", "Alt H", <Icon.hline key="h" />],
                ["ruler", "Measure", "Shift Click", <Icon.ruler key="r" />],
              ] as [Tool, string, string, React.ReactNode][]
            ).map(([t, label, kbd, icon]) => (
              <button
                key={t}
                type="button"
                className={`rail-btn tm-chart-rb ${tool === t ? "rail-btn-active" : ""}`}
                aria-pressed={tool === t}
                aria-label={label}
                data-tip={label}
                data-kbd={kbd}
                data-tip-pos="r"
                disabled={locked && t !== "cursor"}
                onClick={() => pickTool(t)}
              >
                {icon}
              </button>
            ))}
            <i className="tm-chart-rail-sep" aria-hidden />
            <button type="button" className={`rail-btn tm-chart-rb ${magnet ? "rail-btn-active" : ""}`} aria-pressed={magnet} aria-label="Magnet" data-tip={magnet ? "Magnet on · snaps to open, high, low, close" : "Magnet · snap to open, high, low, close"} data-tip-pos="r" onClick={() => setMagnet((v) => !v)}>
              <CIcon n="magnet" size={15} />
            </button>
            <i className="tm-chart-rail-sep" aria-hidden />
            <button type="button" className={`rail-btn tm-chart-rb ${locked ? "rail-btn-active" : ""}`} aria-pressed={locked} aria-label={locked ? "Unlock drawings" : "Lock drawings"} data-tip={locked ? "Unlock drawings" : "Lock drawings"} data-tip-pos="r" onClick={() => setLocked((v) => !v)}>
              {locked ? <Icon.lock /> : <CIcon n="unlock" size={15} />}
            </button>
            <button type="button" className={`rail-btn tm-chart-rb ${hidden ? "rail-btn-active" : ""}`} aria-pressed={hidden} aria-label={hidden ? "Show drawings" : "Hide drawings"} data-tip={hidden ? "Show drawings" : "Hide drawings"} data-tip-pos="r" onClick={() => setHidden((v) => !v)}>
              {hidden ? <Icon.eyeOff /> : <Icon.eye />}
            </button>
            <button
              type="button"
              className="rail-btn tm-chart-rb tm-chart-rb-danger"
              aria-label="Remove all drawings"
              data-tip={selected ? "Remove all drawings · Del removes the selected one" : "Remove all drawings"}
              data-tip-pos="r"
              disabled={!drawings.length && !draft}
              onClick={() => {
                setDrawings([]);
                setDraft(null);
                setSelected(null);
              }}
            >
              <Icon.trash />
            </button>
          </div>
        )}

        {/* ---------- the pane ---------- */}
        <div
          ref={paneRef}
          className="tm-chart-pane"
          tabIndex={0}
          role="region"
          aria-roledescription="chart"
          aria-label={`${coin}-USD ${ivLabel} chart. Arrow keys pan, plus and minus zoom, Alt R resets the view.`}
          data-tool={tool}
          onPointerDownCapture={onPaneDownCapture}
          onPointerMove={onPaneMove}
          onPointerLeave={(e) => e.currentTarget.removeAttribute("data-nav")}
          onContextMenu={onPaneContext}
        >
          <span ref={nowRef} className="tm-chart-now" aria-hidden />
          <div ref={hostRef} className="tm-chart-host" />
          <DrawingLayer
            vp={vp}
            svgRef={svgRef}
            items={visibleDrawings}
            selected={selected}
            active={tool !== "cursor" && !locked && mode === "chart"}
            locked={locked}
            width={paneWidth}
            axis={axisWidth}
            xOf={xOf}
            yOf={yOf}
            colors={drawColors}
            prec={prec}
            ivSec={ivSec}
            onShapeDown={onShapeDown}
            onDown={onDrawDown}
            onMove={onDrawMove}
            onUp={onDrawUp}
          />
          <span ref={pxLineRef} className="tm-chart-pxline" aria-hidden />
          {mode === "chart" && <ThesisPins groups={pinGroups} register={registerPin} />}
          {mode === "chart" ? (
            <Legend
              chart={chart}
              coin={coin}
              ivLabel={ivLabel}
              typeLabel={chartType === "candles" ? null : typeMeta[1]}
              rows={rows}
              candles={candles}
              live={live?.row ?? null}
              liveIdx={live?.idx ?? 0}
              prec={prec}
              inds={inds}
              ind={indData}
              colors={colors}
              showVol={showVol}
              onRemove={removeInd}
              liveInd={liveInd}
              boxRef={legendBox}
            />
          ) : (
            <div className="tm-chart-legend">
              <div className="tm-chart-lg-id">
                <i className="tm-chart-lg-dot" data-live="" />
                <span className="tm-chart-lg-sym">{coin}-USD</span>
                <span className="tm-chart-lg-sep">·</span>
                <span>Funding · hourly · 7d</span>
              </div>
              {lastFunding && (
                <div className="tm-chart-lg-ohlc" data-dir={lastFunding.rate >= 0 ? "up" : "down"}>
                  <span>
                    Rate<b className="tm-chart-lg-chg">{(lastFunding.rate * 100).toFixed(4)}%</b>
                  </span>
                  <span>
                    APR<b>{(lastFunding.rate * 24 * 365 * 100).toFixed(2)}%</b>
                  </span>
                </div>
              )}
            </div>
          )}
          {mode === "chart" &&
            lines.map((l, i) => (
              <div
                key={`${i}:${l.px}:${l.title}`}
                ref={(el) => {
                  if (el) plElsRef.current.set(i, el);
                  else plElsRef.current.delete(i);
                  plVerRef.current++;
                }}
                className="tm-chart-pl"
                data-hidden=""
                style={{ "--c": l.color } as CSSProperties}
              >
                <span className="tm-chart-pl-t">{l.title}</span>
                <span className="tm-chart-pl-p">{fmtFixed(l.px, prec)}</span>
              </div>
            ))}
          <span className="tm-chart-utc" aria-hidden>
            UTC
          </span>
          <div ref={tagRef} className="tm-chart-tag" aria-hidden>
            <span ref={tagPxRef} className="tm-chart-tag-px" />
            <span ref={tagCdRef} className="tm-chart-tag-cd" />
          </div>
          <button ref={rtRef} type="button" className="tm-chart-rt" data-tip="Scroll to the latest bar" data-tip-pos="t" aria-label="Scroll to the latest bar" onClick={() => chartRef.current?.timeScale().scrollToRealTime()}>
            <CIcon n="chevrons" size={15} />
          </button>
          <div className="tm-chart-nav" role="group" aria-label="Zoom and scroll">
            <button type="button" onClick={() => zoom(1.25)} data-tip="Zoom out" data-kbd="−" data-tip-pos="t" aria-label="Zoom out">
              <Icon.minus />
            </button>
            <button type="button" onClick={() => zoom(0.8)} data-tip="Zoom in" data-kbd="+" data-tip-pos="t" aria-label="Zoom in">
              <Icon.plus />
            </button>
            <i aria-hidden />
            <button type="button" onClick={() => pan(-1)} data-tip="Scroll left" data-kbd="←" data-tip-pos="t" aria-label="Scroll left">
              <Icon.left />
            </button>
            <button type="button" onClick={() => pan(1)} data-tip="Scroll right" data-kbd="→" data-tip-pos="t" aria-label="Scroll right">
              <Icon.right />
            </button>
            <i aria-hidden />
            <button type="button" onClick={reset} data-tip="Reset chart view" data-kbd="Alt R" data-tip-pos="t" aria-label="Reset chart view">
              <Icon.reset />
            </button>
          </div>
          {loadingFirst && !overPlaceholder && <ChartSkeleton />}
          {mode === "funding" && funding.isLoading && (
            <div className="tm-chart-veil" role="status">
              <span className="tm-chart-veil-bar" />
              <span className="tm-chart-veil-chip">
                <i />
                Loading {coin} funding
              </span>
            </div>
          )}
          {loadingNext && (
            <div className="tm-chart-veil" role="status">
              <span className="tm-chart-veil-bar" />
              <span className="tm-chart-veil-chip">
                <i />
                Loading {coin} · {ivLabel}
              </span>
            </div>
          )}
          {(q.isError && !candles.length) || noData ? (
            <div className="tm-chart-err" role="alert">
              <span className="tm-chart-err-ico">
                <CIcon n="alert" size={18} />
              </span>
              <b>{noData ? "No candles for this market yet" : "Chart unavailable"}</b>
              <span>{noData ? "Try a longer interval." : (q.error as Error)?.message ?? "The candle feed did not answer."}</span>
              <button type="button" className="btn btn-sm" onClick={() => q.refetch()}>
                <Icon.reset /> Retry
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------- footer ---------- */}
      <div ref={footRef} className="tm-chart-foot">
        <div className="tm-chart-ranges" role="group" aria-label="Range">
          {RANGES.map(([l, iv, n, spoken]) => (
            <button key={l} type="button" className="tm-chart-rg" aria-pressed={mode === "chart" && interval === iv && bars === rangeBars(n)} data-tip={spoken} data-tip-pos="t" aria-label={spoken} onClick={() => setRange(iv, n)}>
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tm-chart-tool"
          data-tip="Go to date"
          data-tip-pos="t"
          aria-label="Go to date"
          onClick={() => {
            const el = dateRef.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          }}
        >
          <Icon.calendar />
        </button>
        <input ref={dateRef} type="date" className="sr-only" tabIndex={-1} onChange={(e) => goToDate(e.target.value)} aria-label="Go to date" />
        <span className="tm-chart-foot-end">
          <Clock />
          <i className="tm-chart-sep" aria-hidden />
          <div className="seg tm-chart-seg" role="group" aria-label="Price scale">
            <button type="button" className={`seg-item ${priceMode === 2 ? "seg-active" : ""}`} aria-pressed={priceMode === 2} data-tip="Percent scale" data-tip-pos="t" onClick={() => setPriceMode(priceMode === 2 ? 0 : 2)}>
              %
            </button>
            <button type="button" className={`seg-item ${priceMode === 1 ? "seg-active" : ""}`} aria-pressed={priceMode === 1} data-tip="Logarithmic scale" data-tip-pos="t" onClick={() => setPriceMode(priceMode === 1 ? 0 : 1)}>
              log
            </button>
            <button type="button" className={`seg-item ${autoScale ? "seg-active" : ""}`} aria-pressed={autoScale} data-tip={autoScale ? "Auto scale is on" : "Auto scale: fit the prices in view"} data-tip-pos="t" onClick={() => setAuto(!autoScale)}>
              auto
            </button>
          </div>
        </span>
      </div>

      {menu?.kind === "tf" && (
        <TfMenu
          value={interval}
          style={{ left: menu.x, top: menu.y, maxHeight: menu.h } as CSSProperties}
          onClose={closeMenu}
          onPick={(iv) => {
            pickInterval(iv);
            closeMenu();
          }}
        />
      )}
      {menu?.kind === "type" && (
        <TypeMenu
          value={chartType}
          style={{ left: menu.x, top: menu.y, maxHeight: menu.h } as CSSProperties}
          onClose={closeMenu}
          onPick={(t) => {
            setChartType(t);
            closeMenu();
          }}
        />
      )}
      {menu?.kind === "ind" && (
        <IndMenu inds={inds} colors={colors} showVol={showVol} setShowVol={setShowVol} toggle={(id) => setInds((s) => (s.includes(id) ? s.filter((x) => x !== id) : IND_IDS.filter((x) => x === id || s.includes(x))))} onClose={closeMenu} style={{ left: menu.x, top: menu.y, maxHeight: menu.h } as CSSProperties} />
      )}
      {ctxMenu && (
        <CtxMenu
          style={{ left: ctxMenu.x, top: ctxMenu.y } as CSSProperties}
          price={ctxMenu.pt ? fmtFixed(ctxMenu.pt.p, prec) : null}
          canDraw={!locked && !!ctxMenu.pt}
          hasDrawings={drawings.length > 0}
          onClose={() => setCtxMenu(null)}
          onAction={(a) => {
            const pt = ctxMenu.pt;
            setCtxMenu(null);
            if (a === "reset") reset();
            else if (a === "realtime") chartRef.current?.timeScale().scrollToRealTime();
            else if (a === "hline" && pt) finish({ id: uid(), type: "hline", a: pt });
            else if (a === "copy" && pt) navigator.clipboard?.writeText(fmtFixed(pt.p, prec).replace(/,/g, "")).catch(() => {});
            else if (a === "clear") {
              setDrawings([]);
              setSelected(null);
            } else if (a === "snapshot") snapshot();
          }}
        />
      )}
      <TipLayer root={wrapRef} />
    </div>
  );
}

/* a faint candle silhouette under a slow light sweep, for the very first load */
function ChartSkeleton() {
  const bars = useMemo(() => {
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let v = 0.5;
    return Array.from({ length: 46 }, () => {
      v = Math.min(0.82, Math.max(0.18, v + (r() - 0.5) * 0.12));
      return { y: v, h: 0.04 + r() * 0.12, w: 0.06 + r() * 0.1 };
    });
  }, []);
  return (
    <div className="tm-chart-skel" role="status" aria-label="Loading chart">
      <div className="tm-chart-skel-bars" aria-hidden>
        {bars.map((b, i) => (
          <i key={i} style={{ left: `${(i / bars.length) * 100}%`, top: `${b.y * 100}%`, height: `${b.h * 100}%`, opacity: 0.35 + 0.65 * (i / bars.length) } as CSSProperties} />
        ))}
      </div>
      <span className="tm-chart-skel-sweep" aria-hidden />
    </div>
  );
}
