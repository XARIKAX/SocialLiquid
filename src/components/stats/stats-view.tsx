"use client";
/** /stats: protocol numbers the way defillama shows them. key metrics on the left, one measure charted by day / week / month on the right */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { METRICS, type Stats, type StatsBucket, type StatsMetric, type StatsPoint, type StatsRange } from "@/lib/stats";
import { fmtUsd } from "@/lib/format";
import { Icon, Skeleton } from "../ui";

const RANGES: [StatsRange, string][] = [["30d", "30D"], ["90d", "90D"], ["1y", "1Y"], ["all", "All"]];
const BUCKETS: [StatsBucket, string][] = [["day", "D"], ["week", "W"], ["month", "M"]];

const fmtCount = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : n >= 10_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : n.toLocaleString("en-US"));
const fmtMetric = (m: StatsMetric, v: number) => (METRICS.find((x) => x.key === m)!.unit === "usd" ? fmtUsd(v, { compact: v >= 1000 }) : fmtCount(v));
const axisLabel = (m: StatsMetric, v: number) => (METRICS.find((x) => x.key === m)!.unit === "usd" ? (v >= 1e9 ? `$${(v / 1e9).toFixed(1).replace(/\.0$/, "")}b` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}m` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`) : fmtCount(v));

export function StatsView() {
  const [range, setRange] = useState<StatsRange>("90d");
  const [bucket, setBucket] = useState<StatsBucket>("day");
  const [metric, setMetric] = useState<StatsMetric>("volume");
  const q = useQuery({ queryKey: ["stats", range, bucket], queryFn: () => api<Stats>(`/api/stats?range=${range}&bucket=${bucket}`), refetchInterval: 60_000, placeholderData: (d) => d });
  const s = q.data;
  const m = METRICS.find((x) => x.key === metric)!;
  return (
    <div className="max-w-7xl space-y-3 pb-6" data-testid="stats-page">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[22px] font-semibold tracking-tight">Stats</h1>
        <span className="text-xs text-dim">what flows through socialLiquid · fills of socialLiquid accounts on Hyperliquid, with the builder fees they carried · refreshed every minute</span>
      </div>
      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-3">
        <section className="card p-4" data-testid="key-metrics">
          <div className="text-[13px] font-semibold mb-2">Key metrics</div>
          {!s && <Skeleton rows={6} h={36} />}
          {s && (
            <dl className="divide-y divide-line/60 text-[13px]">
              <Row label="Fees 30d" value={fmtUsd(s.totals.d30.fees, { compact: s.totals.d30.fees >= 1000 })} delta={pct(s.totals.d30.fees, s.totals.prev30.fees)} hint="builder fees paid on trades by socialLiquid accounts" onClick={() => setMetric("fees")} active={metric === "fees"} testid="km-fees" />
              <Row label="Revenue 30d" value={fmtUsd(s.totals.d30.fees * s.revenueShare, { compact: s.totals.d30.fees >= 1000 })} delta={pct(s.totals.d30.fees, s.totals.prev30.fees)} hint={s.revenueShare === 1 ? "all builder fees stay with the protocol until key payouts go live" : `${Math.round(s.revenueShare * 100)}% of fees after key holder payouts`} onClick={() => setMetric("fees")} active={false} testid="km-revenue" />
              <Row label="Perp volume 30d" value={fmtUsd(s.totals.d30.volume, { compact: true })} delta={pct(s.totals.d30.volume, s.totals.prev30.volume)} hint="notional of fills by socialLiquid accounts" onClick={() => setMetric("volume")} active={metric === "volume"} testid="km-volume" />
              <Row label="Trades 30d" value={fmtCount(s.totals.d30.trades)} delta={pct(s.totals.d30.trades, s.totals.prev30.trades)} hint="fills" onClick={() => setMetric("trades")} active={metric === "trades"} testid="km-trades" />
              <Row label="Active traders 30d" value={fmtCount(s.totals.d30.traders)} delta={pct(s.totals.d30.traders, s.totals.prev30.traders)} hint="distinct accounts with a fill" onClick={() => setMetric("traders")} active={metric === "traders"} testid="km-traders" />
              <Row label="New traders 30d" value={fmtCount(s.totals.d30.newTraders)} delta={pct(s.totals.d30.newTraders, s.totals.prev30.newTraders)} hint="first sign-ins" onClick={() => setMetric("newTraders")} active={metric === "newTraders"} testid="km-new" />
              <Row label="Copies 30d" value={fmtCount(s.totals.d30.copies)} delta={pct(s.totals.d30.copies, s.totals.prev30.copies)} hint="positions opened with Copy" onClick={() => setMetric("copies")} active={metric === "copies"} testid="km-copies" />
              <Row label="Theses 30d" value={fmtCount(s.totals.d30.theses)} delta={pct(s.totals.d30.theses, s.totals.prev30.theses)} hint="theses posted" onClick={() => setMetric("theses")} active={metric === "theses"} testid="km-theses" />
              <Row label="All-time volume" value={fmtUsd(s.totals.all.volume, { compact: true })} hint={`${fmtCount(s.totals.all.trades)} trades · ${fmtCount(s.totals.all.newTraders)} traders · ${fmtUsd(s.totals.all.fees, { compact: s.totals.all.fees >= 1000 })} fees`} testid="km-all" />
            </dl>
          )}
          <div className="text-[11px] text-dim mt-3 leading-snug">Volume and fees count fills by claimed socialLiquid accounts, which is how we attribute what flows through the terminal. Hyperliquid&apos;s own totals for those wallets may be higher if they also trade elsewhere.</div>
        </section>
        <section className="card p-4 min-w-0" data-testid="stats-chart-card">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex gap-1 flex-wrap" data-testid="metric-chips">
              {METRICS.map((x) => (
                <button key={x.key} className={`pill ${metric === x.key ? "pill-brand" : "pill-neutral"} hover:border-brand/50`} onClick={() => setMetric(x.key)} title={x.desc} data-testid={`metric-${x.key}`}>{x.label}</button>
              ))}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="seg" data-testid="stats-buckets">
                {BUCKETS.map(([b, label]) => <button key={b} className={`seg-item h-7 px-2.5 ${bucket === b ? "seg-active" : ""}`} onClick={() => setBucket(b)}>{label}</button>)}
              </span>
              <span className="seg" data-testid="stats-ranges">
                {RANGES.map(([r, label]) => <button key={r} className={`seg-item h-7 px-2.5 ${range === r ? "seg-active" : ""}`} onClick={() => setRange(r)}>{label}</button>)}
              </span>
              <a className="btn h-7 px-2.5 text-xs" href={`/api/stats?range=${range}&bucket=${bucket}&format=csv`} download data-testid="stats-csv">.csv</a>
              <PngButton metric={metric} />
            </span>
          </div>
          <div className="mt-3">
            {!s && <Skeleton rows={1} h={300} />}
            {s && <BarChart points={s.series} metric={metric} bucket={bucket} label={m.label} />}
          </div>
          {s && <DataTable points={s.series} metric={metric} />}
        </section>
      </div>
    </div>
  );
}

const pct = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

function Row({ label, value, delta, hint, onClick, active, testid }: { label: string; value: string; delta?: number | null; hint?: string; onClick?: () => void; active?: boolean; testid?: string }) {
  const inner = (
    <>
      <dt className={`text-fg-2 ${onClick ? "underline decoration-dotted underline-offset-4 decoration-line-2" : ""} ${active ? "text-brand" : ""}`} title={hint}>{label}</dt>
      <dd className="ml-auto num font-semibold flex items-center gap-2">
        {delta !== undefined && delta !== null && <span className={`text-[11px] font-normal ${delta >= 0 ? "text-up" : "text-down"}`} title="vs the 30 days before">{delta >= 0 ? "+" : ""}{(delta * 100).toFixed(0)}%</span>}
        {value}
      </dd>
    </>
  );
  return onClick ? <button className="w-full flex items-center py-2 text-left hover:text-fg" onClick={onClick} data-testid={testid}>{inner}</button> : <div className="flex items-center py-2" data-testid={testid}>{inner}</div>;
}

/** thin bars, rounded tops, hover tooltip. one series, so the title names it and there is no legend */
function BarChart({ points, metric, bucket, label }: { points: StatsPoint[]; metric: StatsMetric; bucket: StatsBucket; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 300, padL = 56, padR = 8, padT = 10, padB = 26;
  const vals = points.map((p) => p[metric]);
  const max = Math.max(1e-9, ...vals);
  const niceMax = useMemo(() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    const n = max / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }, [max]);
  const innerW = Math.max(10, w - padL - padR), innerH = H - padT - padB;
  const n = points.length || 1;
  const slot = innerW / n;
  const bw = Math.max(1, Math.min(slot - 2, slot * 0.72));
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const fmtDate = (t: string) => {
    const d = new Date(t);
    return bucket === "month" ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative select-none" data-testid="stats-chart" data-metric={metric}>
      <svg id="stats-svg" width={w} height={H} role="img" aria-label={`${label} by ${bucket}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line" strokeOpacity={t === 0 ? 0.9 : 0.5} strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-current text-dim" fontSize={10}>{axisLabel(metric, t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const v = p[metric];
          const top = y(v);
          const h = Math.max(0, padT + innerH - top);
          const r = Math.min(4, bw / 2, h);
          const on = hover === i;
          return (
            <g key={p.t} onMouseEnter={() => setHover(i)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={innerH} fill="transparent" />
              {h > 0 && (
                <path d={`M${x},${padT + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + innerH} Z`} className="fill-brand" fillOpacity={on ? 1 : 0.8} />
              )}
              {i % labelEvery === 0 && <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="fill-current text-dim" fontSize={10}>{fmtDate(p.t)}</text>}
            </g>
          );
        })}
      </svg>
      {hp && hover !== null && (
        <div className="absolute pointer-events-none card px-2.5 py-1.5 text-[12px] shadow-xl" style={{ left: Math.min(w - 170, Math.max(0, padL + hover * slot + slot / 2 - 80)), top: Math.max(0, y(hp[metric]) - 56) }} data-testid="stats-tooltip">
          <div className="text-dim">{new Date(hp.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}{bucket !== "day" ? ` · ${bucket}` : ""}</div>
          <div className="num font-semibold">{fmtMetric(metric, hp[metric])} <span className="text-muted font-normal">{label.toLowerCase()}</span></div>
        </div>
      )}
      {!vals.some((v) => v > 0) && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-dim">nothing in this range yet</div>}
    </div>
  );
}

/** the same numbers as a table, for screen readers and anyone who wants to copy them */
function DataTable({ points, metric }: { points: StatsPoint[]; metric: StatsMetric }) {
  const [open, setOpen] = useState(false);
  const rows = [...points].reverse().slice(0, 60);
  return (
    <div className="mt-2">
      <button className="text-[11px] text-dim hover:text-fg" onClick={() => setOpen((v) => !v)} data-testid="stats-table-toggle">{open ? "Hide table" : "Show as table"}</button>
      {open && (
        <table className="w-full text-[12px] mt-2 num" data-testid="stats-table">
          <thead className="text-dim"><tr><th className="text-left font-medium py-1">Date</th><th className="text-right font-medium py-1">Volume</th><th className="text-right font-medium py-1">Fees</th><th className="text-right font-medium py-1">Trades</th><th className="text-right font-medium py-1">Traders</th><th className="text-right font-medium py-1">Copies</th><th className="text-right font-medium py-1">Theses</th><th className="text-right font-medium py-1">New</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.t} className={`border-t border-line/60 ${p[metric] > 0 ? "" : "text-dim"}`}>
                <td className="py-1">{p.t.slice(0, 10)}</td><td className="text-right">{fmtUsd(p.volume, { compact: true })}</td><td className="text-right">{fmtUsd(p.fees)}</td><td className="text-right">{p.trades}</td><td className="text-right">{p.traders}</td><td className="text-right">{p.copies}</td><td className="text-right">{p.theses}</td><td className="text-right">{p.newTraders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** rasterise the svg with the page's current colours */
function PngButton({ metric }: { metric: StatsMetric }) {
  return (
    <button
      className="btn h-7 px-2.5 text-xs"
      data-testid="stats-png"
      onClick={() => {
        const svg = document.getElementById("stats-svg") as SVGSVGElement | null;
        if (!svg) return;
        const clone = svg.cloneNode(true) as SVGSVGElement;
        const cs = getComputedStyle(document.body);
        const brand = cs.getPropertyValue("--color-brand").trim() || "#4de3c1";
        const dim = cs.getPropertyValue("--color-dim").trim() || "#6b7280";
        const bg = cs.getPropertyValue("--color-panel").trim() || "#0b1014";
        clone.querySelectorAll(".fill-brand").forEach((e) => e.setAttribute("fill", brand));
        clone.querySelectorAll("text").forEach((e) => e.setAttribute("fill", dim));
        clone.querySelectorAll("line").forEach((e) => e.setAttribute("stroke", dim));
        const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bgRect.setAttribute("width", "100%"); bgRect.setAttribute("height", "100%"); bgRect.setAttribute("fill", bg);
        clone.insertBefore(bgRect, clone.firstChild);
        const xml = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = svg.width.baseVal.value * 2; c.height = svg.height.baseVal.value * 2;
          const ctx = c.getContext("2d")!;
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          const a = document.createElement("a");
          a.href = c.toDataURL("image/png"); a.download = `socialliquid-${metric}.png`; a.click();
        };
        img.src = url;
      }}
    >
      <span className="inline-flex items-center gap-1"><Icon.share /> .png</span>
    </button>
  );
}
