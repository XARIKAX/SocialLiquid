import Link from "next/link";
import type { FeedItem } from "@/lib/queries";
import { fmtUsd } from "@/lib/format";
import { CaPill } from "./ca";
import { Globe } from "./globe";
import { CountUp } from "./motion";
import { Arrow, Check, Disc, TrendArrow, usdCompact, vars } from "./parts";
import type { LandingData } from "./types";

export function Hero({ d }: { d: LandingData }) {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <Sky />
      <div className="lp-hero-copy lp-container">
        {/* the light leads (arch from 0.1s), the words resolve while it is still rising, then the product */}
        <span className="lp-badge" style={vars({ "--d": "0.42s" })}>
          <span className="lp-badge-tag">
            <span className="lp-live" /> Live
          </span>
          {d.inviteOnly ? "Invite-only on Hyperliquid" : "Live on Hyperliquid mainnet"}
        </span>
        <h1 id="lp-hero-title" className="lp-h1 lp-hero-title" style={vars({ "--d": "0s" })}>
          <span className="lp-lit" style={vars({ "--d": "0.52s" })}>The social layer</span>
          <span className="lp-grad" style={vars({ "--d": "0.68s" })}>for Hyperliquid.</span>
        </h1>
        <p className="lp-lead" style={vars({ "--d": "0.84s" })}>
          Follow the best traders on Hyperliquid, see every position the second it opens, and trade alongside them. Post a thesis, put the position behind it, and let everyone watch you hold or dump.
        </p>
        <div className="lp-hero-ctas" style={vars({ "--d": "0.96s" })}>
          <Link href="/trade" className="lp-btn lp-btn-primary">
            Start trading <Arrow />
          </Link>
          <a href="#receipts" className="lp-btn lp-btn-ghost">
            Watch the feed
          </a>
          <CaPill />
        </div>
        <div className="lp-hero-trust" style={vars({ "--d": "1.06s" })}>
          <span><Check /> Non-custodial</span>
          <span><Check /> Copy any trade</span>
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
/** the three cards are a picture of the product: screen readers get one caption, not the mock data */
function Stage({ d }: { d: LandingData }) {
  const live = liveChips(d.items);
  return (
    <figure className="lp-stage">
      <figcaption className="sr-only">
        Product preview: {live ? "live" : "sample"} positions on a globe, the BTC-USD mark price over the last 48 hours
        {d.btc ? ` (now $${Math.round(d.btc.markPx).toLocaleString("en-US")})` : ""}, and a sample trader&apos;s thesis accuracy with recent receipts.
      </figcaption>
      <div className="lp-stage-glow" aria-hidden />
      <div className="lp-stage-row" aria-hidden>
        <PositionsCard live={live} />
        <MarketCard d={d} />
        <ReceiptsCard />
      </div>
    </figure>
  );
}

const SAMPLE_CHIPS = [
  { side: "LONG", coin: "BTC", usd: 192_000 },
  { side: "SHORT", coin: "ETH", usd: 96_400 },
  { side: "LONG", coin: "SOL", usd: 48_200 },
];
/** the middle chip is anchored from the right so it never runs past a narrow card */
const CHIP_SPOTS: { left?: string; right?: string; top: string; d: string; t: string }[] = [
  { left: "6%", top: "34%", d: "2.1s", t: "6.5s" },
  { right: "5%", top: "17%", d: "2.35s", t: "7.2s" },
  { left: "40%", top: "74%", d: "2.6s", t: "5.8s" },
];

type Chip = { side: string; coin: string; usd: number };
/** three real open positions from the feed, or null to show the sample */
function liveChips(items: FeedItem[]): Chip[] | null {
  const live = items
    .filter((i) => (i.type === "LONG" || i.type === "SHORT") && typeof (i.payload as { sizeUsd?: number }).sizeUsd === "number")
    .slice(0, 3)
    .map((i) => ({ side: i.type, coin: i.coin, usd: (i.payload as { sizeUsd: number }).sizeUsd }));
  return live.length === 3 ? live : null;
}

function PositionsCard({ live }: { live: Chip[] | null }) {
  const chips = live ?? SAMPLE_CHIPS;
  return (
    <div className="lp-card lp-card-side lp-card-left lp-glass lp-spot" data-spotlight style={vars({ "--d": "1.2s" })}>
      <div className="lp-card-head">
        <span className="lp-card-label">
          <span className="lp-live" /> {live ? "Live positions" : "Open positions"}
        </span>
        <span className="lp-pill lp-pill-neutral">{live ? "Now" : "Sample"}</span>
      </div>
      <div className="lp-globe">
        <div className="lp-globe-halo" style={{ width: 252, height: 252 }} />
        <Globe size={252} />
        {chips.map((c, i) => {
          const up = c.side === "LONG";
          return (
            <span key={i} className={`lp-chip ${up ? "lp-chip-up" : "lp-chip-down"}`} style={vars({ left: CHIP_SPOTS[i].left ?? "auto", right: CHIP_SPOTS[i].right ?? "auto", top: CHIP_SPOTS[i].top, "--d": CHIP_SPOTS[i].d, "--t": CHIP_SPOTS[i].t })}>
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

/** a calm, deterministic stand-in if the candle feed is unreachable */
const FALLBACK = Array.from({ length: 48 }, (_, i) => 100 + Math.sin(i / 4.2) * 2.4 + Math.sin(i / 1.7) * 0.8 + i * 0.09);

function compactPx(v: number) {
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

/** monotone cubic through points (fritsch–carlson): smooth, but never overshoots the data */
function monotonePath(p: [number, number][]) {
  const n = p.length;
  if (n < 2) return "";
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) m.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1));
  const t = p.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    d += ` C${f(p[i][0] + h)},${f(p[i][1] + t[i] * h)} ${f(p[i + 1][0] - h)},${f(p[i + 1][1] - t[i + 1] * h)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
  }
  return d;
}

/** 2-4 round price levels inside [lo, hi] */
function niceTicks(lo: number, hi: number) {
  const raw = (hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const first = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let k = 0; first + k * step <= hi && k < 5; k++) out.push(first + k * step);
  return { step, ticks: out };
}

function tickLabel(v: number, step: number) {
  if (v >= 10_000) return `$${(v / 1000).toFixed(step >= 1000 ? 0 : step >= 100 ? 1 : 2)}k`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: step < 1 ? 2 : 0 })}`;
}

function MarketCard({ d }: { d: LandingData }) {
  const real = d.candles.length > 4;
  const vals = real ? d.candles.map((c) => c.c) : FALLBACK;
  // the plot sits between a fixed px gutter for the y labels and one for the price tag, so nothing collides at any width
  const W = 600;
  const H = 230;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.16 || hi * 0.002 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const sx = (i: number) => (i / (vals.length - 1)) * W;
  const sy = (v: number) => (1 - (v - min) / (max - min)) * H;
  const pts = vals.map((v, i) => [sx(i), sy(v)] as [number, number]);
  const line = monotonePath(pts);
  const last = pts[pts.length - 1];
  // labels stay out of the top and bottom bands, clear of the x axis
  const { step, ticks } = niceTicks(min + (max - min) * 0.1, max - (max - min) * 0.06);
  const btc = d.btc;
  const up = (btc?.change24h ?? 0) >= 0;
  const lastTop = `${(last[1] / H) * 100}%`;
  return (
    <div className="lp-card lp-card-center lp-glass lp-spot" data-spotlight style={vars({ "--d": "1.08s" })}>
      <div className="lp-card-head">
        <div>
          <span className="lp-card-label">
            <span className="lp-coin">₿</span> BTC-USD · Mark price
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="lp-card-figure lp-num">
              {/* ticks up the last half-percent like a live mark, instead of counting from nothing */}
              {btc ? <CountUp to={btc.markPx} from={btc.markPx * 0.995} format="usd0" delay={500} duration={1700} /> : "$—"}
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
        <span>Open interest <b>{btc ? usdCompact(btc.openInterestUsd) : "—"}</b></span>
        <span>Max <b>{btc?.maxLeverage ?? 40}x</b></span>
      </div>
      <div className="lp-chart" aria-hidden>
        {real &&
          ticks.map((v) => (
            <span key={v} className="lp-chart-y lp-num" style={{ top: `${(sy(v) / H) * 100}%` }}>
              {tickLabel(v, step)}
            </span>
          ))}
        <div className="lp-chart-plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="lp-line-grad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#2aa98f" stopOpacity="0.6" />
                <stop offset="0.55" stopColor="#4de3c1" />
                <stop offset="1" stopColor="#c9fff2" />
              </linearGradient>
              <linearGradient id="lp-area-grad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#4de3c1" stopOpacity="0.22" />
                <stop offset="0.65" stopColor="#4de3c1" stopOpacity="0.04" />
                <stop offset="1" stopColor="#4de3c1" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((v) => (
              <line key={v} className="lp-chart-grid" x1="0" x2={W} y1={sy(v)} y2={sy(v)} />
            ))}
            <clipPath id="lp-chart-clip">
              <rect className="lp-chart-sweep" x="-4" y="-20" width={W + 8} height={H + 40} />
            </clipPath>
            <g clipPath="url(#lp-chart-clip)">
              <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#lp-area-grad)" />
              <path className="lp-chart-line" d={line} />
            </g>
          </svg>
          <span className="lp-chart-last" style={{ left: "100%", top: lastTop }} />
        </div>
        <span className="lp-chart-now" style={{ top: lastTop }} />
        {btc && (
          <span className="lp-chart-tag lp-num" style={{ top: lastTop }}>
            ${Math.round(btc.markPx).toLocaleString("en-US")}
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
  // a sample profile: relative ages, so nothing reads as a dated record
  const rows: [string, string, string, string, string][] = [
    ["1d ago", "BTC long · 20x", "Closed in profit", "+$4,210", "lp-pill-up"],
    ["2d ago", "ETH short · 10x", "Closed inside the hour", "Dumped", "lp-pill-amber"],
    ["3d ago", "SOL long · 5x", "Thesis still live", "Holding", "lp-pill-brand"],
  ];
  return (
    <div className="lp-card lp-card-side lp-card-right lp-glass lp-spot" data-spotlight style={vars({ "--d": "1.2s" })}>
      <div className="lp-card-head">
        <span className="lp-card-label">
          <Disc a="0x7a3fc91e" size={16} /> @nightowl · Thesis accuracy
        </span>
        <span className="lp-pill lp-pill-neutral">Sample</span>
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
                {lit && <line className={`lp-tick lp-tick-on ${i === on - 1 ? "lp-tick-head" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} style={vars({ "--c": c, "--d": `${1.6 + i * 0.032}s` })} />}
              </g>
            );
          })}
        </svg>
        <div className="lp-gauge-value">
          <b className="lp-num">
            <CountUp to={SCORE} from={0} format="pct" delay={900} duration={1500} />
          </b>
          <small>of settled theses closed in profit</small>
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
