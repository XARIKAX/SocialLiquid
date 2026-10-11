import Link from "next/link";
import type { FeedItem } from "@/lib/queries";
import { fmtUsd } from "@/lib/format";
import { Globe } from "./globe";
import { CountUp } from "./motion";
import { Arrow, Check, TrendArrow, vars } from "./parts";
import type { LandingData } from "./types";

export function Hero({ d }: { d: LandingData }) {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <Sky />
      <div className="lp-hero-copy lp-container">
        <span className="lp-badge" style={vars({ "--d": "0.6s" })}>
          <span className="lp-badge-tag">
            <span className="lp-live" /> Live
          </span>
          Now trading on Hyperliquid{d.testnet ? " testnet" : ""}
        </span>
        <h1 id="lp-hero-title" className="lp-h1 lp-hero-title" style={vars({ "--d": "0s" })}>
          <span className="lp-lit" style={vars({ "--d": "0.78s" })}>Where traders show</span>
          <span className="lp-grad" style={vars({ "--d": "0.96s" })}>their receipts.</span>
        </h1>
        <p className="lp-lead" style={vars({ "--d": "1.14s" })}>
          The first social trading platform for perpetuals. Post a thesis, open the position on Hyperliquid, and let everyone watch you hold or dump.
        </p>
        <div className="lp-hero-ctas" style={vars({ "--d": "1.3s" })}>
          <Link href="/trade" className="lp-btn lp-btn-primary">
            Start trading <Arrow />
          </Link>
          <Link href="/trade" className="lp-btn lp-btn-ghost">
            Watch the feed
          </Link>
        </div>
        <div className="lp-hero-trust" style={vars({ "--d": "1.44s" })}>
          <span><Check /> Non-custodial</span>
          <span><Check /> Perps only</span>
          <span><Check /> Every fill on-chain</span>
        </div>
      </div>
      <Stage d={d} />
    </section>
  );
}

/* ---------- the light ---------- */
const NODES: [number, number, boolean][] = [
  // angle (deg, 0 = 3 o'clock, -90 = top), intro delay, bright
  // nodes light as the orbit line, drawn outward from the top, reaches them
  [-90, 1.2, true],
  [-128, 1.9, false],
  [-52, 1.9, false],
  [-158, 2.3, true],
  [-22, 2.3, true],
  [-176, 2.5, false],
  [-4, 2.5, false],
];
const MOTES = [
  [-38, 0, 9, -14], [-22, 2.1, 11, 10], [-8, 4.4, 8.5, -6], [6, 1.2, 10, 12], [19, 3.3, 9.5, -10], [31, 5.6, 12, 8], [44, 0.6, 10.5, -4], [-48, 6.2, 11, 6],
];

function Sky() {
  return (
    <div className="lp-sky" aria-hidden>
      <div className="lp-beam" />
      <div className="lp-arch">
        <div className="lp-arch-bloom" />
        <div className="lp-arch-band" />
        <div className="lp-arch-inner" />
        <div className="lp-arch-echo" />
        <div className="lp-arch-crown" />
        <div className="lp-arch-crown-core" />
        <div className="lp-orbit">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lp-orbit-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#cdeff3" stopOpacity="0.5" />
                <stop offset="0.3" stopColor="#9fc9d6" stopOpacity="0.22" />
                <stop offset="0.5" stopColor="#9fc9d6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* two halves drawn outward from the top */}
            <path className="lp-orbit-path" pathLength={1} d="M50 0 A50 50 0 0 0 0 50 A50 50 0 0 0 50 100" />
            <path className="lp-orbit-path" pathLength={1} d="M50 0 A50 50 0 0 1 100 50 A50 50 0 0 1 50 100" />
          </svg>
          {NODES.map(([a, delay, bright]) => (
            <span
              key={a}
              className={`lp-node ${bright ? "" : "lp-node-dim"}`}
              style={vars({ left: `${50 + 50 * Math.cos((a * Math.PI) / 180)}%`, top: `${50 + 50 * Math.sin((a * Math.PI) / 180)}%`, "--d": `${delay}s` })}
            />
          ))}
          <div className="lp-comet">
            <div className="lp-comet-arm" />
          </div>
        </div>
      </div>
      <div className="lp-motes">
        {MOTES.map(([x, delay, t, drift], i) => (
          <span key={i} className="lp-mote" style={vars({ left: `${50 + x}%`, "--d": `${delay + 2.4}s`, "--t": `${t}s`, "--x": `${drift}px` })} />
        ))}
      </div>
      <div className="lp-grain" />
    </div>
  );
}

/* ---------- product cards ---------- */
function Stage({ d }: { d: LandingData }) {
  return (
    <div className="lp-stage">
      <div className="lp-stage-glow" />
      <div className="lp-stage-row">
        <PositionsCard items={d.items} />
        <MarketCard d={d} />
        <ReceiptsCard />
      </div>
    </div>
  );
}

const SAMPLE_CHIPS = [
  { side: "LONG", coin: "BTC", usd: 192_000 },
  { side: "SHORT", coin: "ETH", usd: 96_400 },
  { side: "LONG", coin: "SOL", usd: 48_200 },
];
const CHIP_SPOTS = [
  { left: "6%", top: "34%", d: "2.3s", t: "6.5s" },
  { left: "54%", top: "17%", d: "2.55s", t: "7.2s" },
  { left: "40%", top: "74%", d: "2.8s", t: "5.8s" },
];

function PositionsCard({ items }: { items: FeedItem[] }) {
  const live = items
    .filter((i) => (i.type === "LONG" || i.type === "SHORT") && typeof (i.payload as { sizeUsd?: number }).sizeUsd === "number")
    .slice(0, 3)
    .map((i) => ({ side: i.type, coin: i.coin, usd: (i.payload as { sizeUsd: number }).sizeUsd }));
  const chips = live.length === 3 ? live : SAMPLE_CHIPS;
  return (
    <div className="lp-card lp-card-side lp-card-left lp-glass lp-spot" data-spotlight style={vars({ "--d": "1.55s" })}>
      <div className="lp-card-head">
        <span className="lp-card-label">
          <span className="lp-live" /> Live positions
        </span>
        <span className="lp-pill lp-pill-neutral">Worldwide</span>
      </div>
      <div className="lp-globe">
        <div className="lp-globe-halo" style={{ width: 252, height: 252 }} />
        <Globe size={252} />
        {chips.map((c, i) => {
          const up = c.side === "LONG";
          return (
            <span key={i} className={`lp-chip ${up ? "lp-chip-up" : "lp-chip-down"}`} style={vars({ left: CHIP_SPOTS[i].left, top: CHIP_SPOTS[i].top, "--d": CHIP_SPOTS[i].d, "--t": CHIP_SPOTS[i].t })}>
              <span className="lp-chip-ico">
                <TrendArrow up={up} size={12} />
              </span>
              <span className="lp-num">
                {up ? "Long" : "Short"} {c.coin} <span className="text-[var(--lp-muted)]">{fmtUsd(c.usd, { compact: true })}</span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** a smooth path through points (catmull-rom as cubic beziers) */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** a calm, deterministic stand-in if the candle feed is unreachable */
const FALLBACK = Array.from({ length: 48 }, (_, i) => 100 + Math.sin(i / 4.2) * 2.4 + Math.sin(i / 1.7) * 0.8 + i * 0.09);

function compactPx(v: number) {
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

function MarketCard({ d }: { d: LandingData }) {
  // every other hourly close: the same 48h, calmer to read
  const raw = d.candles.length > 4 ? d.candles.map((c) => c.c) : FALLBACK;
  const vals = raw.filter((_, i) => i % 2 === (raw.length - 1) % 2);
  const real = d.candles.length > 4;
  const W = 600;
  const H = 230;
  const top = 26;
  const bottom = 18;
  const left = 78; // clear of the y labels
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1e-9, max - min);
  const right = 92; // room for the last-price tag
  const sx = (i: number) => left + (i / (vals.length - 1)) * (W - left - right);
  const sy = (v: number) => top + (1 - (v - min) / span) * (H - top - bottom);
  const pts = vals.map((v, i) => [sx(i), sy(v)] as [number, number]);
  const line = smooth(pts);
  const last = pts[pts.length - 1];
  const levels = [0, 1, 2, 3].map((k) => min + (span * (3 - k)) / 3);
  const btc = d.btc;
  const up = (btc?.change24h ?? 0) >= 0;
  return (
    <div className="lp-card lp-card-center lp-glass lp-spot" data-spotlight style={vars({ "--d": "1.4s" })}>
      <div className="lp-card-head">
        <div>
          <span className="lp-card-label">
            <span className="lp-coin">₿</span> BTC-PERP · Mark price
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="lp-card-figure lp-num">
              {btc ? <CountUp to={btc.markPx} format="usd0" delay={700} duration={1900} /> : "$—"}
            </span>
            {btc && (
              <span className={`lp-pill ${up ? "lp-pill-up" : "lp-pill-down"} lp-num mt-1.5`}>
                <TrendArrow up={up} size={11} />
                {(btc.change24h * 100).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div className="lp-seg shrink-0" aria-hidden>
          <span>24H</span>
          <span data-on="">48H</span>
          <span>7D</span>
        </div>
      </div>
      <div className="lp-card-meta lp-num">
        <span>Funding <b className={btc && btc.funding < 0 ? "text-[var(--lp-down)]" : "text-[var(--lp-mint)]"}>{btc ? `${(btc.funding * 100).toFixed(4)}%` : "—"}</b></span>
        <span>Open interest <b>{btc ? fmtUsd(btc.openInterestUsd, { compact: true }) : "—"}</b></span>
        <span>Max <b>{btc?.maxLeverage ?? 40}x</b></span>
      </div>
      <div className="lp-chart" aria-hidden>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="lp-line-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#2aa98f" stopOpacity="0.6" />
              <stop offset="0.55" stopColor="#4de3c1" />
              <stop offset="1" stopColor="#c9fff2" />
            </linearGradient>
            <linearGradient id="lp-area-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#4de3c1" stopOpacity="0.24" />
              <stop offset="0.6" stopColor="#4de3c1" stopOpacity="0.04" />
              <stop offset="1" stopColor="#4de3c1" stopOpacity="0" />
            </linearGradient>
          </defs>
          {levels.map((v) => (
            <line key={v} className="lp-chart-grid" x1="44" x2={W} y1={sy(v)} y2={sy(v)} />
          ))}
          <clipPath id="lp-chart-clip">
            <rect className="lp-chart-sweep" x="0" y="-20" width={W} height={H + 40} />
          </clipPath>
          <g clipPath="url(#lp-chart-clip)">
            <path d={`${line} L${last[0].toFixed(1)},${H} L${left},${H} Z`} fill="url(#lp-area-grad)" />
            <path className="lp-chart-line" d={line} />
          </g>
          <line className="lp-chart-now" x1={last[0]} x2={W} y1={last[1]} y2={last[1]} />
        </svg>
        {real &&
          levels.map((v) => (
            <span key={v} className="lp-chart-y lp-num" style={{ top: `${(sy(v) / H) * 100}%` }}>
              {compactPx(v)}
            </span>
          ))}
        <span className="lp-chart-last" style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }} />
        {btc && (
          <span className="lp-chart-tag lp-num" style={{ top: `${(last[1] / H) * 100}%` }}>
            {compactPx(btc.markPx)}
          </span>
        )}
      </div>
      <div className="lp-chart-x lp-num" aria-hidden>
        <span>−48h</span>
        <span>−36h</span>
        <span>−24h</span>
        <span>−12h</span>
        <span>now</span>
      </div>
    </div>
  );
}

const TICKS = 46;
const SCORE = 84;

function ReceiptsCard() {
  const cx = 118;
  const cy = 114;
  const from = 205;
  const sweep = 230;
  const on = Math.round((SCORE / 100) * TICKS);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const rows: [string, string, string, string, string][] = [
    [day(1), "BTC long · 20x", "Closed in profit", "+$4,210", "lp-pill-up"],
    [day(2), "ETH short · 10x", "Closed inside the hour", "Dumped", "lp-pill-amber"],
    [day(3), "SOL long · 5x", "Thesis still live", "Holding", "lp-pill-brand"],
  ];
  return (
    <div className="lp-card lp-card-side lp-card-right lp-glass lp-spot" data-spotlight style={vars({ "--d": "1.55s" })}>
      <div className="lp-card-head">
        <span className="lp-card-label">Thesis accuracy</span>
        <span className="lp-pill lp-pill-neutral">30d</span>
      </div>
      <div className="lp-gauge" aria-hidden>
        <svg viewBox="0 0 236 150">
          {Array.from({ length: TICKS }, (_, i) => {
            const a = ((from - (sweep * i) / (TICKS - 1)) * Math.PI) / 180;
            const r1 = 92;
            const r2 = i % 5 === 0 ? 108 : 104;
            const x1 = cx + r1 * Math.cos(a);
            const y1 = cy - r1 * Math.sin(a);
            const x2 = cx + r2 * Math.cos(a);
            const y2 = cy - r2 * Math.sin(a);
            const lit = i < on;
            const k = i / Math.max(1, on - 1);
            const c = `rgb(${Math.round(42 + (151 - 42) * k)} ${Math.round(169 + (252 - 169) * k)} ${Math.round(143 + (228 - 143) * k)})`;
            return (
              <g key={i}>
                <line className="lp-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
                {lit && <line className={`lp-tick lp-tick-on ${i === on - 1 ? "lp-tick-head" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} style={vars({ "--c": c, "--d": `${1.9 + i * 0.032}s` })} />}
              </g>
            );
          })}
        </svg>
        <div className="lp-gauge-value">
          <b className="lp-num">
            <CountUp to={SCORE} from={0} format="pct" delay={900} duration={1500} />
          </b>
          <small>of theses closed green</small>
        </div>
      </div>
      <div className="lp-receipts">
        {rows.map(([date, what, sub, tag, cls]) => (
          <div key={what} className="lp-receipt">
            <span className="lp-receipt-date lp-num">{date}</span>
            <span>
              <b>{what}</b>
              <small>{sub}</small>
            </span>
            <span className={`lp-pill ${cls} lp-num`}>{tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
