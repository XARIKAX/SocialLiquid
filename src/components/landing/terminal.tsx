import type { ReactNode } from "react";
import type { FeedItem } from "@/lib/queries";
import { fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { CountUp } from "./motion";
import { Disc, Mark, SectionHead, usdCompact, vars } from "./parts";
import type { LandingData } from "./types";

/* =====================================================================
   the terminal: the product itself, framed like a lit glass object.
   a browser window settles out of a 3d tilt, candles draw in from the
   left, the feed's newest card lands, and the "now" bits breathe.
   everything inside the window is illustrative ui (aria-hidden); the
   figure carries a caption for screen readers.
   ===================================================================== */

type Candle = { t: number; o: number; h: number; l: number; c: number };
type Kind = "LONG" | "SHORT" | "THESIS" | "CLOSED" | "LIQUIDATED";
type Outcome = "OPEN" | "PROFIT" | "LOSS" | "LIQUIDATED" | "DUMPED";
type FeedRow = {
  id: string;
  addr: string;
  name: string;
  kind: Kind;
  side?: string;
  coin: string;
  sizeUsd?: number;
  lev?: number;
  entry?: number;
  pnl?: number;
  thesis?: string;
  outcome?: Outcome;
  likes?: number;
  ago: string;
};
type PosRow = { id: string; addr: string; name: string; coin: string; side: string; lev: number; sizeUsd: number; entry: number; pnl: number; ago: string };

/* fictional traders for the illustrative state (hex picked for pleasant avatar hues) */
const A = {
  nightowl: "0xbde280c41f39e0b7d2c55e6a9f1047b3c8d2e61a",
  tidewatch: "0x78c81c9a03be44d1f6e2a7c05b9d31e8f4a2c770",
  quietbid: "0xdc67182fe90a4c3b71d5e8a6f0c2b49d13e7a5f8",
  fundingfarm: "0x6d2fb4e1c7a90358bf2d64e0a1c9f7b35e8d2a46",
  larkspur: "0xa5f4cc3e8b1d7092f6a4e5c1b8d03f97a2e6c4b1",
  deltaneutral: "0x8c617c5d2a9e0f4b13c8e7d6a5f2b09e4c1d3a78",
  you: "0xd59f8a2b6e4c1f0d97a3b5e8c2d4f61a0b9e3c7d",
};

/* fallback prices if the tape is unreachable (illustrative only) */
const PX_FALLBACK: Record<string, number> = { BTC: 82_400, ETH: 3_142.5, SOL: 146.82, HYPE: 38.41, DOGE: 0.16233 };

const OUTCOME: Record<Outcome, [string, string]> = {
  OPEN: ["Holding", "lp-pill-brand"],
  PROFIT: ["Closed in profit", "lp-pill-up"],
  LOSS: ["Closed at loss", "lp-pill-down"],
  LIQUIDATED: ["Liquidated", "lp-pill-liq"],
  DUMPED: ["Dumped", "lp-pill-amber"],
};

/* ---------- formatting ---------- */
function fpx(v: number) {
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(5);
}
const fpx0 = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : fpx(v));
const signUsd = (v: number) => `${v >= 0 ? "+" : "-"}${fmtUsd(Math.abs(v)).replace(/\.\d+$/, "")}`;
const pct = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

/* ---------- data shaping ---------- */

/** a calm, deterministic btc series if the candle feed is unreachable: a dip, then a recovery into now */
function fallbackCandles(base: number): Candle[] {
  let s = 0x2f6b9d1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = 48;
  const hour = 3_600_000;
  const end = Math.floor(Date.now() / hour) * hour;
  const out: Candle[] = [];
  let prev = 1;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 6.5) * 0.0013 + (i > 16 && i < 29 ? -0.0016 : 0) + (i >= 29 ? 0.0014 : 0);
    const o = prev;
    const c = prev * (1 + drift + (rnd() - 0.5) * 0.0042);
    const h = Math.max(o, c) * (1 + rnd() * 0.0019);
    const l = Math.min(o, c) * (1 - rnd() * 0.0019);
    out.push({ t: end - (n - 1 - i) * hour, o, h, l, c });
    prev = c;
  }
  const k = base / out[n - 1].c;
  return out.map((c) => ({ t: c.t, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k }));
}

function nameOf(it: FeedItem) {
  if (it.user?.handle) return `@${it.user.handle}`;
  return it.user?.displayName ?? shortAddr(it.address);
}

function rowFromItem(it: FeedItem): FeedRow {
  const p = it.payload as { side?: string; sizeUsd?: number; leverage?: number; entryPx?: number; realisedPnl?: number; text?: string };
  return {
    id: it.id,
    addr: it.address,
    name: nameOf(it),
    kind: it.type as Kind,
    side: p.side ?? it.position?.side,
    coin: it.coin,
    sizeUsd: p.sizeUsd ?? it.position?.sizeUsd,
    lev: p.leverage ?? it.position?.leverage,
    entry: p.entryPx ?? it.position?.entryPx,
    pnl: typeof p.realisedPnl === "number" ? p.realisedPnl : undefined,
    thesis: it.thesis?.text ?? p.text,
    outcome: it.thesis?.outcome as Outcome | undefined,
    likes: it.thesis?.likes,
    ago: timeAgo(it.time),
  };
}

function model(d: LandingData) {
  const real = d.candles.length >= 12;
  const base = d.btc?.markPx ?? (real ? d.candles[d.candles.length - 1].c : PX_FALLBACK.BTC);
  const candles = real ? d.candles.slice(-48) : fallbackCandles(base);
  const n = candles.length;
  const last = candles[n - 1];
  const mark = d.btc?.markPx ?? last.c;
  const change = d.btc?.change24h ?? (n > 24 ? last.c / candles[n - 25].c - 1 : 0);
  const funding = d.btc?.funding ?? 0.0000125;
  const maxLev = d.btc?.maxLeverage ?? 40;
  const price = (coin: string) => (coin === "BTC" ? mark : d.tape.find((t) => t.coin === coin)?.markPx ?? PX_FALLBACK[coin] ?? 1);

  /* the thesis on the chart: the best long entry in hindsight, somewhere in the middle of the window */
  const lo = Math.floor(n * 0.4);
  const hi = Math.floor(n * 0.75);
  let k = lo;
  for (let i = lo; i <= hi; i++) if (candles[i].l < candles[k].l) k = i;
  const thesisPx = candles[k].c;
  const thesisLow = candles[k].l;
  const thesisAgo = `${Math.max(1, n - 1 - k)}h`;

  /* feed: live if there is enough of it, otherwise a tasteful illustrative set */
  const liveFeed = d.items.length >= 4;
  const feed: FeedRow[] = liveFeed
    ? d.items.slice(0, 6).map(rowFromItem)
    : [
        { id: "s1", addr: A.tidewatch, name: "@tidewatch", kind: "LONG", coin: "ETH", sizeUsd: 96_400, lev: 10, entry: price("ETH") * 1.0011, ago: "1m" },
        { id: "s2", addr: A.quietbid, name: "@quietbid", kind: "SHORT", coin: "SOL", sizeUsd: 48_200, lev: 5, entry: price("SOL") * 1.0042, ago: "6m" },
        { id: "s3", addr: A.deltaneutral, name: "@deltaneutral", kind: "THESIS", side: "SHORT", coin: "ETH", sizeUsd: 120_000, lev: 15, entry: price("ETH") * 1.0068, thesis: "Fading the pump into CPI. Stop above the weekly high, no heroics.", outcome: "OPEN", likes: 46, ago: "18m" },
        { id: "s4", addr: A.fundingfarm, name: "@fundingfarm", kind: "CLOSED", coin: "HYPE", sizeUsd: 62_800, lev: 8, pnl: 2_140, ago: "34m" },
        { id: "s5", addr: A.larkspur, name: "@larkspur", kind: "LIQUIDATED", coin: "DOGE", sizeUsd: 22_900, lev: 40, pnl: -8_920, ago: "52m" },
        { id: "s6", addr: A.nightowl, name: "@nightowl", kind: "THESIS", side: "LONG", coin: "BTC", sizeUsd: 184_200, lev: 20, entry: thesisPx, thesis: "Funding flat for three days, OI rebuilding under the range high. Reclaim it and this squeezes.", outcome: "OPEN", likes: 128, ago: thesisAgo },
      ];

  /* open positions */
  const seen = new Set<string>();
  const livePos: PosRow[] = [];
  for (const it of d.items) {
    const p = it.position;
    if (!p || p.closedAt || seen.has(p.id)) continue;
    seen.add(p.id);
    livePos.push({ id: p.id, addr: it.address, name: nameOf(it), coin: it.coin, side: p.side, lev: p.leverage, sizeUsd: p.sizeUsd, entry: p.entryPx, pnl: p.unrealisedPnl, ago: timeAgo(p.openedAt) });
  }
  const pnlAt = (side: string, size: number, entry: number, now: number) => size * (now / entry - 1) * (side === "LONG" ? 1 : -1);
  const livePositions = livePos.length >= 2;
  const positions: PosRow[] =
    livePositions
      ? livePos.slice(0, 3)
      : [
          { id: "p1", addr: A.nightowl, name: "@nightowl", coin: "BTC", side: "LONG", lev: 20, sizeUsd: 184_200, entry: thesisPx, pnl: pnlAt("LONG", 184_200, thesisPx, mark), ago: thesisAgo },
          { id: "p2", addr: A.deltaneutral, name: "@deltaneutral", coin: "ETH", side: "SHORT", lev: 15, sizeUsd: 120_000, entry: price("ETH") * 1.0068, pnl: pnlAt("SHORT", 120_000, price("ETH") * 1.0068, price("ETH")), ago: "18m" },
          { id: "p3", addr: A.tidewatch, name: "@tidewatch", coin: "ETH", side: "LONG", lev: 10, sizeUsd: 96_400, entry: price("ETH") * 1.0011, pnl: pnlAt("LONG", 96_400, price("ETH") * 1.0011, price("ETH")), ago: "1m" },
        ];

  /* the chart marker only tells the sample story, or a real btc thesis inside the window */
  let marker: { idx: number; name: string; addr: string } | null = liveFeed ? null : { idx: k, name: "@nightowl", addr: A.nightowl };
  if (liveFeed) {
    const t = d.items.find((it) => it.type === "THESIS" && it.coin === "BTC" && new Date(it.time).getTime() >= candles[0].t);
    if (t) {
      const ts = new Date(t.time).getTime();
      const f = candles.findIndex((c) => c.t + 3_600_000 > ts);
      marker = { idx: f < 0 ? n - 1 : f, name: nameOf(t), addr: t.address };
    }
  }

  /* say plainly what is live and what is illustrative */
  const liveMarket = real && !!d.btc;
  const sampleTraders = !liveFeed || !livePositions;
  const note = sampleTraders
    ? liveMarket
      ? "Product preview · market data live from Hyperliquid · traders illustrative"
      : "Product preview · illustrative data"
    : liveMarket
      ? null
      : "Product preview · market data illustrative";

  return { candles, mark, change, funding, maxLev, oi: d.btc?.openInterestUsd ?? null, feed, positions, marker, thesisLow, note };
}

/* ---------- icons (inline, stroke 1.8, rounded) ---------- */
const ICONS: Record<string, ReactNode> = {
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  bell: <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />,
  chevL: <path d="m14 6-6 6 6 6" />,
  chevR: <path d="m10 6 6 6-6 6" />,
  chevD: <path d="m7 10 5 5 5-5" />,
  share: <path d="M12 3v11M7.5 7.5 12 3l4.5 4.5M5 13v5.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  candles: <path d="M8 3.5v3M8 17.5v3M16 3v4M16 15.5V20M6 6.5h4v11H6zM14 7h4v8.5h-4z" />,
  pencil: <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5" />,
  pen: <path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" />,
  layers: <path d="m12 3 9 4.8-9 4.8-9-4.8L12 3zM3 12.2l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8" />,
  book: <path d="M20 4.5h-7M20 8.5h-12M20 12.5h-4M20 16.5h-15M20 20.5h-9" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 4.5l-3.2 15" />,
  chart: <path d="M3.5 20.5h17M6 16.5l4.2-5.2 3.4 3.1L20 6.5M15.5 6.5H20V11" />,
};

function Ico({ n, size = 14, sw = 1.8 }: { n: keyof typeof ICONS; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[n]}
    </svg>
  );
}

/* ---------- section ---------- */
const CAPS: { icon: keyof typeof ICONS; title: string; body: string }[] = [
  { icon: "layers", title: "Every order type", body: "Market, limit, stop, take profit, scale and TWAP." },
  { icon: "candles", title: "Charts that keep up", body: "Indicators, drawings and funding history on every market." },
  { icon: "book", title: "The live book", body: "Grouped by tick. Click a level to fill the ticket." },
  { icon: "pen", title: "Thesis in the ticket", body: "Write the why before you click. It posts to the feed with your order." },
];

export function Terminal({ d }: { d: LandingData }) {
  const m = model(d);
  return (
    <section id="terminal" className="lp-term" aria-labelledby="lp-term-title">
      <div className="lp-term-atmos" aria-hidden>
        <div className="lp-term-atmos-halo" />
        <div className="lp-term-atmos-glow" />
        <div className="lp-grain" />
      </div>
      <div className="lp-container relative">
        <SectionHead
          eyebrow="The terminal"
          id="lp-term-title"
          className="max-w-[1000px]!"
          title={
            <>
              <span className="whitespace-nowrap">Native Hyperliquid</span> execution. <em className="lp-grad not-italic block">With a social layer.</em>
            </>
          }
          lead="A full perps terminal on the Hyperliquid API: real candles, the live book, every order type, and the traders behind the flow."
        />

        <figure className="lp-term-stage">
          <figcaption className="sr-only">
            Preview of the socialLiquid terminal: the BTC perpetual market with hourly candles, a live feed of traders&apos; positions and theses, open positions with unrealised PnL, and an order ticket with a thesis field.
            {m.note && ` ${m.note}.`}
          </figcaption>
          <div className="lp-term-window lp-spot" data-spotlight data-reveal aria-hidden>
            <span className="lp-term-spec" />
            <Chrome />
            <AppBar />
            <div className="lp-term-body">
              <Feed rows={m.feed} />
              <div className="lp-term-main">
                <MarketHead mark={m.mark} change={m.change} funding={m.funding} maxLev={m.maxLev} oi={m.oi} />
                <Toolbar />
                <Chart candles={m.candles} mark={m.mark} marker={m.marker} />
                <Positions rows={m.positions} />
              </div>
              <Ticket mark={m.mark} maxLev={m.maxLev} floor={m.thesisLow} />
            </div>
          </div>
          {/* light around the object: after the window so it can follow its reveal */}
          <div className="lp-term-aura" aria-hidden />
          <Arc />
          <div className="lp-term-floor" aria-hidden>
            <span className="lp-term-floor-line" />
          </div>
        </figure>
        {/* outside the figure so the stage (and the light anchored to it) keeps the window's size */}
        {m.note && (
          <p className="lp-term-sample lp-mono" data-reveal="fade" style={vars({ "--d": "0.5s" })} aria-hidden>
            {m.note}
          </p>
        )}

        <ul className="lp-term-caps" role="list" data-reveal="fade">
          {CAPS.map((c, i) => (
            <li key={c.title} className="lp-term-cap" style={vars({ "--d": `${0.14 + i * 0.08}s`, "--b": `${i * 1.3}s` })}>
              <span className="lp-term-cap-ico" aria-hidden>
                <Ico n={c.icon} size={18} sw={1.7} />
              </span>
              <h3 className="lp-term-cap-title">{c.title}</h3>
              <p className="lp-term-cap-body">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- the arc behind the window: the hero's orbit, echoed ----------
   it is revealed by a circle growing from the apex (see css), so each node
   lights roughly as the wavefront reaches it: [angle, bright, delay s] */
const ARC_NODES: [number, boolean, number][] = [
  [90, true, 0.45],
  [150, false, 1.85],
  [30, false, 1.85],
  [166, true, 2.2],
  [14, true, 2.2],
];
function Arc() {
  return (
    <div className="lp-term-arc" aria-hidden>
      <svg viewBox="0 0 1000 360" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-term-arc-g" x1="0" y1="0" x2="0" y2="360" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#d6f6f2" stopOpacity="0.55" />
            <stop offset="0.35" stopColor="#9fc9d6" stopOpacity="0.22" />
            <stop offset="1" stopColor="#9fc9d6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="lp-term-arc-path" pathLength={1} d="M500 20 A500 340 0 0 0 0 360" />
        <path className="lp-term-arc-path" pathLength={1} d="M500 20 A500 340 0 0 1 1000 360" />
      </svg>
      {ARC_NODES.map(([a, bright, delay]) => {
        const r = (a * Math.PI) / 180;
        return (
          <span
            key={a}
            className={`lp-term-node ${bright ? "" : "lp-term-node-dim"} ${a === 90 ? "lp-term-node-apex" : ""}`}
            style={vars({ left: `${(500 + 500 * Math.cos(r)) / 10}%`, top: `${((360 - 340 * Math.sin(r)) / 360) * 100}%`, "--d": `${delay}s` })}
          />
        );
      })}
    </div>
  );
}

/* ---------- window chrome ---------- */
function Chrome() {
  return (
    <div className="lp-term-chrome">
      <span className="lp-term-lights">
        <i />
        <i />
        <i />
      </span>
      <span className="lp-term-chrome-nav">
        <Ico n="chevL" size={14} />
        <Ico n="chevR" size={14} />
      </span>
      <span className="lp-term-url lp-mono">
        <span className="lp-term-url-lock">
          <Ico n="lock" size={11} sw={2} />
        </span>
        <span>
          socialliquid.xyz<span className="lp-term-url-path">/m/BTC</span>
        </span>
      </span>
      <span className="lp-term-chrome-end">
        <Ico n="share" size={14} />
        <Ico n="plus" size={14} />
      </span>
    </div>
  );
}

function AppBar() {
  return (
    <div className="lp-term-app">
      <span className="lp-term-brand">
        <Mark size={17} id="lp-term-mk" />
        <span>
          social<span className="lp-term-brand-liquid">Liquid</span>
        </span>
      </span>
      <span className="lp-term-nav">
        <span data-on="">Trade</span>
        <span>Tokens</span>
        <span>Leaderboard</span>
      </span>
      <span className="lp-term-search">
        <Ico n="search" size={13} />
        Search markets
        <kbd className="lp-mono">⌘K</kbd>
      </span>
      <span className="lp-term-iconbtn">
        <Ico n="bell" size={14} />
        <i />
      </span>
      <span className="lp-term-acct">
        <Disc a={A.you} size={18} />
        <span className="lp-mono">{shortAddr(A.you)}</span>
        <b className="lp-num">$2,410.55</b>
      </span>
    </div>
  );
}

/* ---------- feed column ---------- */
function Feed({ rows }: { rows: FeedRow[] }) {
  return (
    <div className="lp-term-feed">
      <div className="lp-term-feed-in">
        <div className="lp-term-tabs">
          <span className="lp-term-tab">
            <Ico n="bell" size={12} /> Alerts
          </span>
          <span className="lp-term-tab">Tokens</span>
          <span className="lp-term-tab" data-on="">
            <span className="lp-live" /> Feed
          </span>
          <span className="lp-term-tabs-end">
            <Ico n="sliders" size={13} />
          </span>
        </div>
        <div className="lp-term-feed-list">
          {rows.map((r, i) => (
            <FeedCard key={r.id} r={r} first={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

const KIND: Record<Kind, [string, string]> = {
  LONG: ["Long", "lp-pill-up"],
  SHORT: ["Short", "lp-pill-down"],
  THESIS: ["Thesis", "lp-pill-blue"],
  CLOSED: ["Closed", "lp-pill-neutral"],
  LIQUIDATED: ["Liquidated", "lp-pill-liq"],
};

function FeedCard({ r, first }: { r: FeedRow; first: boolean }) {
  const [label, cls] = KIND[r.kind] ?? ["", "lp-pill-neutral"];
  const closed = r.kind === "CLOSED" || r.kind === "LIQUIDATED";
  const isThesis = !!r.thesis;
  const outcome = r.outcome ? OUTCOME[r.outcome] : null;
  return (
    <div className={`lp-term-fc ${isThesis ? "lp-term-fc-thesis" : ""} ${first ? "lp-term-fc-new" : ""}`}>
      <div className="lp-term-fc-top">
        <Disc a={r.addr} size={24} />
        <span className="lp-term-fc-name">{r.name}</span>
        <span className={`lp-pill ${cls}`}>{label}</span>
        <span className="lp-term-fc-ago lp-mono">{r.ago}</span>
      </div>
      <div className="lp-term-fc-mid lp-num">
        {r.kind === "THESIS" && r.side && <span className={r.side === "LONG" ? "lp-term-up" : "lp-term-down"}>{r.side === "LONG" ? "Long" : "Short"}</span>}
        <b>{r.coin}</b>
        {r.sizeUsd !== undefined && <span>{fmtUsd(r.sizeUsd, { compact: true })}</span>}
        {!closed && r.entry !== undefined && (
          <>
            <span className="lp-term-dim">at</span>
            <span>{fpx(r.entry)}</span>
          </>
        )}
        {r.lev !== undefined && <span className="lp-term-lev">{r.lev}x</span>}
        {closed && r.pnl !== undefined && <span className={`lp-term-fc-pnl ${r.pnl >= 0 ? "lp-term-up" : "lp-term-down"}`}>{signUsd(r.pnl)}</span>}
      </div>
      {isThesis && <p className="lp-term-fc-text">{r.thesis}</p>}
      {isThesis && (
        <div className="lp-term-fc-foot">
          {outcome && <span className={`lp-pill ${outcome[1]}`}>{outcome[0]}</span>}
          {r.likes !== undefined && (
            <span className="lp-term-fc-likes lp-num">
              <Ico n="heart" size={11} sw={2} /> {r.likes}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- market header + toolbar ---------- */
function MarketHead({ mark, change, funding, maxLev, oi }: { mark: number; change: number; funding: number; maxLev: number; oi: number | null }) {
  const up = change >= 0;
  return (
    <div className="lp-term-mkt">
      <div className="lp-term-mkt-id">
        <span className="lp-term-coin">₿</span>
        <b>BTC</b>
        <span className="lp-pill lp-pill-neutral lp-num">BTC-USD</span>
        <span className="lp-pill lp-pill-brand lp-num">{maxLev}x</span>
      </div>
      <div className="lp-term-chips">
        <span className="lp-term-chip">
          <small className="lp-mono">Mark</small>
          <b className="lp-num">
            <CountUp to={mark} from={mark * 0.9985} format="usd" decimals={1} delay={900} duration={1800} />
          </b>
        </span>
        <span className="lp-term-chip">
          <small className="lp-mono">24H</small>
          <b className={`lp-num ${up ? "lp-term-up" : "lp-term-down"}`}>{pct(change)}</b>
        </span>
        <span className="lp-term-chip">
          <small className="lp-mono">Funding</small>
          <b className={`lp-num ${funding < 0 ? "lp-term-down" : "lp-term-mint"}`}>{`${funding >= 0 ? "" : "-"}${Math.abs(funding * 100).toFixed(4)}%`}</b>
        </span>
        {oi !== null && (
          <span className="lp-term-chip lp-term-chip-wide">
            <small className="lp-mono">Open interest</small>
            <b className="lp-num">{usdCompact(oi)}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function Toolbar() {
  return (
    <div className="lp-term-tools">
      <span className="lp-term-tf lp-num">
        <span>5m</span>
        <span>15m</span>
        <span data-on="">1h</span>
        <span>4h</span>
        <span>1D</span>
      </span>
      <i className="lp-term-vsep" />
      <span className="lp-term-tool" data-on="">
        <Ico n="candles" size={14} />
      </span>
      <span className="lp-term-tool lp-term-tool-fx">
        <i>f</i>x
      </span>
      <span className="lp-term-tool lp-term-tool-draw">
        <Ico n="pencil" size={13} />
      </span>
      <span className="lp-term-tools-end">
        <span className="lp-term-tool-text">
          <Ico n="chart" size={13} /> Funding
        </span>
        <span className="lp-term-tool">
          <Ico n="expand" size={13} />
        </span>
      </span>
    </div>
  );
}

/* ---------- the candlestick chart ---------- */
const VW = 1000;
const VH = 300;

/** a smooth path through points (catmull-rom as cubic beziers), as the hero draws its line */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let p = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    p += ` C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return p;
}

function niceStep(raw: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

function Chart({ candles, mark, marker }: { candles: Candle[]; mark: number; marker: { idx: number; name: string; addr: string } | null }) {
  const n = candles.length;
  const slots = n + 3.5; // a little air to the right of "now"
  const slot = VW / slots;
  const bw = slot * 0.6;
  let lo = Math.min(...candles.map((c) => c.l));
  let hi = Math.max(...candles.map((c) => c.h));
  /* relative floor: an absolute epsilon vanishes below float precision at large prices */
  const span0 = Math.max(hi - lo, Math.abs(hi) * 1e-3, 1e-6);
  hi += span0 * 0.24; // room for the legend
  lo -= span0 * 0.26; // room for the thesis flag under the lows
  const y = (p: number) => ((hi - p) / (hi - lo)) * VH;
  const x = (i: number) => slot * (i + 0.5);
  const step = niceStep((hi - lo) / 5);
  const ticks: number[] = [];
  if (step > 0) {
    for (let v = Math.ceil(lo / step) * step, i = 0; v < hi && i < 24; v += step, i++) {
      const yy = y(v);
      if (yy > 16 && yy < VH - 10) ticks.push(v);
    }
  }
  const times = candles
    .map((c, i) => ({ i, d: new Date(c.t) }))
    .filter(({ d }) => d.getUTCHours() % 12 === 0)
    .filter(({ i }) => x(i) / VW > 0.06 && x(i) / VW < 0.94)
    .map(({ i, d }) => ({ i, label: d.getUTCHours() === 0 ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "12:00" }));
  /* ema 20 from the closes: a real indicator, drawn as a lit line */
  const ema: number[] = [];
  const kk = 2 / (20 + 1);
  candles.forEach((c, i) => ema.push(i === 0 ? c.c : c.c * kk + ema[i - 1] * (1 - kk)));
  const emaPath = smooth(ema.map((v, i) => [x(i), y(v)] as [number, number]));
  const last = candles[n - 1];
  const lastY = y(Math.min(hi, Math.max(lo, mark)));
  const lastUp = last.c >= last.o;
  const chg = last.c / last.o - 1;
  const mk = marker ? candles[marker.idx] : null;
  const entryY = mk ? y(mk.c) : 0;
  const showEntryTag = mk && Math.abs(entryY - lastY) > 26;
  /* axis labels step aside for the price tags, as a real terminal does */
  const tagYs = showEntryTag ? [lastY, entryY] : [lastY];
  const labelTicks = ticks.filter((v) => tagYs.every((t) => Math.abs(y(v) - t) > 26));
  const flagLeft = marker ? x(marker.idx) / VW > 0.56 : false;
  const pctX = (i: number) => `${(x(i) / VW) * 100}%`;
  const pctY = (v: number) => `${(v / VH) * 100}%`;

  return (
    <div className="lp-term-chart">
      <div className="lp-term-plot">
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="lp-term-svg">
          <defs>
            <linearGradient id="lp-term-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#b4ffe2" />
              <stop offset="0.4" stopColor="#45e3a6" />
              <stop offset="1" stopColor="#169c57" />
            </linearGradient>
            <linearGradient id="lp-term-ema" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#4de3c1" stopOpacity="0.1" />
              <stop offset="0.6" stopColor="#4de3c1" stopOpacity="0.55" />
              <stop offset="1" stopColor="#c9fff2" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="lp-term-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffb0b1" />
              <stop offset="0.42" stopColor="#ff5a5c" />
              <stop offset="1" stopColor="#b3292b" />
            </linearGradient>
            {/* the ema sweeps in behind the candles (a clip, not a dash: dashes and
                non-scaling strokes disagree on length across browsers) */}
            <clipPath id="lp-term-ema-clip">
              <rect className="lp-term-ema-sweep" x="0" y="-20" width={VW} height={VH + 40} />
            </clipPath>
          </defs>
          {ticks.map((v) => (
            <line key={v} className="lp-term-grid" x1="0" x2={VW} y1={y(v)} y2={y(v)} />
          ))}
          {times.map((t) => (
            <line key={t.i} className="lp-term-grid lp-term-grid-v" x1={x(t.i)} x2={x(t.i)} y1="0" y2={VH} />
          ))}
          {mk && marker && <line className="lp-term-entry" x1={x(marker.idx)} x2={VW} y1={entryY} y2={entryY} />}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const top = y(Math.max(c.o, c.c));
            const h = Math.max(1.4, Math.abs(y(c.o) - y(c.c)));
            const now = i === n - 1;
            return (
              <g key={c.t} className={`lp-term-candle ${up ? "lp-term-candle-up" : "lp-term-candle-down"} ${now ? "lp-term-candle-now" : ""}`} style={vars({ "--i": i, "--o": (0.42 + 0.58 * Math.pow(i / (n - 1), 0.8)).toFixed(3) })}>
                <line className="lp-term-wick" x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} />
                <rect className="lp-term-body-r" x={x(i) - bw / 2} y={top} width={bw} height={h} rx="1.2" fill={`url(#lp-term-${up ? "up" : "down"})`} />
              </g>
            );
          })}
          <g clipPath="url(#lp-term-ema-clip)">
            <path className="lp-term-ema" d={emaPath} />
          </g>
          <line className="lp-term-last" x1="0" x2={VW} y1={lastY} y2={lastY} />
        </svg>

        <div className="lp-term-legend lp-mono lp-num">
          <span className="lp-term-legend-id">
            <i className="lp-live lp-live-up" />
            BTC-USD · 1h · Hyperliquid
          </span>
          <span className="lp-term-legend-ohlc">
            <span>
              O <b>{fpx(last.o)}</b>
            </span>
            <span>
              H <b>{fpx(last.h)}</b>
            </span>
            <span>
              L <b>{fpx(last.l)}</b>
            </span>
            <span>
              C <b className={lastUp ? "lp-term-up" : "lp-term-down"}>{fpx(last.c)}</b>
            </span>
            <b className={lastUp ? "lp-term-up" : "lp-term-down"}>{pct(chg)}</b>
          </span>
          <span className="lp-term-legend-ema">
            <i />
            EMA 20 <b>{fpx(ema[n - 1])}</b>
          </span>
        </div>

        <span className="lp-term-nowglow" style={{ left: pctX(n - 1), top: pctY(y(last.c)) }} />

        {mk && marker && (
          <span className={`lp-term-flag ${flagLeft ? "lp-term-flag-l" : ""}`} style={{ left: pctX(marker.idx), top: pctY(y(mk.l)) }}>
            <span className="lp-term-flag-stem" />
            <span className="lp-term-flag-dot" />
            <span className="lp-term-flag-tag">
              <Disc a={marker.addr} size={14} />
              <span>
                Thesis <span className="lp-term-flag-who">· {marker.name}</span>
              </span>
            </span>
          </span>
        )}
      </div>

      <div className="lp-term-yaxis lp-mono lp-num">
        {labelTicks.map((v) => (
          <span key={v} style={{ top: pctY(y(v)) }}>
            {fpx0(v)}
          </span>
        ))}
        {showEntryTag && mk && (
          <span className="lp-term-tag lp-term-tag-entry" style={{ top: pctY(entryY) }}>
            {fpx0(mk.c)}
          </span>
        )}
        <span className="lp-term-tag lp-term-tag-last" style={{ top: pctY(lastY) }}>
          {fpx0(mark)}
        </span>
      </div>

      <div className="lp-term-xaxis lp-mono">
        {times.map((t) => (
          <span key={t.i} style={{ left: pctX(t.i) }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="lp-term-utc lp-mono">UTC</div>
    </div>
  );
}

/* ---------- positions ---------- */
function Positions({ rows }: { rows: PosRow[] }) {
  const total = rows.reduce((a, r) => a + r.pnl, 0);
  return (
    <div className="lp-term-pos">
      <div className="lp-term-tabs lp-term-tabs-pos">
        <span className="lp-term-tab" data-on="">
          Positions <i className="lp-term-count lp-num">{rows.length}</i>
        </span>
        <span className="lp-term-tab">Trades</span>
        <span className="lp-term-tab">Thesis</span>
        <span className="lp-term-tabs-end lp-num">
          <span className="lp-term-dim">uPnL</span>
          <b className={total >= 0 ? "lp-term-up" : "lp-term-down"}>{signUsd(total)}</b>
        </span>
      </div>
      <div className="lp-term-row lp-term-row-head lp-mono">
        <span>Trader</span>
        <span>Side</span>
        <span className="lp-term-col-size">Size</span>
        <span className="lp-term-col-entry">Entry</span>
        <span className="lp-term-col-pnl">PnL (ROE)</span>
      </div>
      {rows.map((r) => {
        const long = r.side === "LONG";
        const up = r.pnl >= 0;
        const roe = r.pnl / Math.max(1, r.sizeUsd / Math.max(1, r.lev));
        return (
          <div key={r.id} className="lp-term-row">
            <span className="lp-term-who">
              <Disc a={r.addr} size={24} />
              <span>
                <b>{r.name}</b>
                <small className="lp-mono">
                  {r.coin} · {r.ago}
                </small>
              </span>
            </span>
            <span>
              <span className={`lp-pill ${long ? "lp-pill-up" : "lp-pill-down"} lp-num`}>
                {long ? "Long" : "Short"} {r.lev}x
              </span>
            </span>
            <span className="lp-term-col-size lp-num">{fmtUsd(r.sizeUsd, { compact: true })}</span>
            <span className="lp-term-col-entry lp-num lp-term-text2">{fpx(r.entry)}</span>
            <span className={`lp-term-col-pnl lp-term-pnl lp-num ${up ? "lp-term-pnl-up" : "lp-term-pnl-down"}`}>
              <b>{signUsd(r.pnl)}</b>
              <small>{pct(roe, 1)}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- order ticket ---------- */
function Ticket({ mark, maxLev, floor }: { mark: number; maxLev: number; floor: number }) {
  const lev = 10;
  const size = 100;
  const qty = size / mark;
  const liq = mark * (1 - 1 / lev + 1 / (2 * maxLev));
  const at = (v: number) => `${((v - 1) / Math.max(1, maxLev - 1)) * 100}%`;
  /* invalidation just under the swing low on the chart */
  const invalid = `${(Math.floor((Math.min(floor, mark) * 0.997) / 100) / 10).toFixed(1)}k`;
  const ticks = [1, 10, 20, 30, maxLev].filter((v, i, a) => v <= maxLev && a.indexOf(v) === i);
  const text = `Lows swept and bought back inside the hour. Invalid below ${invalid}.`;
  return (
    <div className="lp-term-ticket">
      <div className="lp-term-side">
        <span data-on="">Long</span>
        <span>Short</span>
      </div>
      <div className="lp-term-otype">
        <span data-on="">Market</span>
        <span>Limit</span>
        <span>
          Pro <Ico n="chevD" size={11} sw={2} />
        </span>
      </div>
      <div className="lp-term-field">
        <div className="lp-term-field-head">
          <span>Size</span>
          <span className="lp-mono lp-num">Avail 2,410.55</span>
        </div>
        <div className="lp-term-size">
          <b className="lp-num">$100</b>
          <span className="lp-term-unit lp-mono">USDC</span>
        </div>
        <div className="lp-term-field-sub lp-mono lp-num">≈ {qty.toFixed(5)} BTC</div>
      </div>
      <div className="lp-term-quick lp-num">
        <span>$10</span>
        <span data-on="">$100</span>
        <span>$500</span>
        <span>$1K</span>
      </div>
      <div className="lp-term-field">
        <div className="lp-term-field-head">
          <span>Leverage</span>
          <b className="lp-term-levval lp-num">{lev}x</b>
        </div>
        <div className="lp-term-slider" style={vars({ "--v": at(lev) })}>
          <span className="lp-term-slider-fill" />
          <span className="lp-term-slider-thumb" />
        </div>
        <div className="lp-term-slider-ticks lp-mono lp-num">
          {ticks.map((t) => (
            <span key={t} style={{ left: at(t) }}>
              {t}x
            </span>
          ))}
        </div>
      </div>
      <div className="lp-term-toggle-row">
        <span>Take profit / Stop loss</span>
        <span className="lp-term-toggle" />
      </div>
      <div className="lp-term-why">
        <div className="lp-term-why-head">
          <Ico n="pen" size={12} sw={2} /> Why this trade?
          <span className="lp-mono lp-num">{text.length}/280</span>
        </div>
        <p>
          {text}
          <span className="lp-term-caret" />
        </p>
      </div>
      <div className="lp-term-toggle-row">
        <span>Post thesis to the feed</span>
        <span className="lp-term-toggle" data-on="" />
      </div>
      <div className="lp-term-meta lp-mono lp-num">
        <span>
          Order value <b>$100.00</b>
        </span>
        <span>
          Margin <b>${(size / lev).toFixed(2)}</b>
        </span>
        <span>
          Liq. price <b>≈ {fpx0(liq)}</b>
        </span>
        <span>
          Fees <b>0.045% + <em className="lp-term-mint not-italic">0.05% builder</em></b>
        </span>
      </div>
      <span className="lp-term-cta">
        <span className="lp-term-cta-sheen" />
        Long BTC · $100
      </span>
      <span className="lp-term-note lp-mono">
        <Ico n="lock" size={10} sw={2} /> Signed by your agent wallet
      </span>
    </div>
  );
}
