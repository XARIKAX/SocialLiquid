import type { ReactNode } from "react";
import type { FeedItem } from "@/lib/queries";
import { fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { FeedPause } from "./features-pause";
import { CountUp } from "./motion";
import { Check, Disc, Mark, SectionHead, vars } from "./parts";

/** signed whole dollars, like every other pnl on the page: +$12,805 */
const wholeUsd = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
import type { LandingData } from "./types";

/* =====================================================================
   the social layer: a bento of four living product moments.
   feed (mirrored from chain) · thesis (bound to the trade) ·
   leaderboard (from fills) · receipts (the outcome, forever).
   ===================================================================== */

export function Features({ d }: { d: LandingData }) {
  /* sample prices follow the live market, so the mocks never sit next to a very different tape */
  const mark = d.btc?.markPx && d.btc.markPx > 0 ? d.btc.markPx : undefined;
  const px = (coin: string) => {
    const v = d.tape.find((t) => t.coin === coin)?.markPx;
    return v && v > 0 ? v : undefined;
  };
  return (
    <section id="receipts" className="lp-feat" aria-labelledby="lp-feat-title">
      <div className="lp-feat-atmos" aria-hidden>
        <div className="lp-feat-halo" />
        <div className="lp-grain" />
      </div>
      <div className="lp-container relative">
        <SectionHead
          id="lp-feat-title"
          eyebrow="The social layer"
          title={
            <>
              Every move, <em className="lp-grad not-italic">on the record.</em>
            </>
          }
          lead={<span className="lp-feat-lead">A perps terminal built social-first. Positions mirrored straight from chain, every thesis bound to its trade, every outcome stamped for good.</span>}
        />
        <div className="lp-feat-bento">
          <FeedCard items={d.items} mark={mark} px={px} />
          <ThesisCard mark={mark} />
          <BoardCard />
          <ReceiptCard />
        </div>
      </div>
    </section>
  );
}

/* ---------- card shell ---------- */
type Tone = "teal" | "blue" | "mint" | "amber";

function Card({ kind, tone, icon, label, title, body, delay, extra, children }: { kind: string; tone: Tone; icon: ReactNode; label: string; title: ReactNode; body: ReactNode; delay: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <article data-reveal data-spotlight className={`lp-feat-card lp-feat-c-${kind} lp-glass lp-spot`} style={vars({ "--d": delay })}>
      <div className="lp-feat-aura" aria-hidden />
      <div className="lp-feat-copy">
        <span className="lp-feat-label lp-mono">
          <span className={`lp-feat-ico lp-feat-ico-${tone}`} aria-hidden>
            {icon}
          </span>
          {label}
        </span>
        <h3 className="lp-feat-h3 lp-lit">{title}</h3>
        <p className="lp-feat-body">{body}</p>
        {extra}
      </div>
      {children}
    </article>
  );
}

const Ico = ({ children }: { children: ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/* ---------- A. the feed ---------- */
type Kind = "LONG" | "SHORT" | "THESIS" | "CLOSED" | "LIQUIDATED";
type Row = { id: string; a: string; h: string; k: Kind; coin: string; usd?: number; px?: number; lev?: number; pnl?: number; text?: string; ago: string };

const PILL: Record<Kind, [string, string]> = {
  LONG: ["Long", "lp-pill-up"],
  SHORT: ["Short", "lp-pill-down"],
  THESIS: ["Thesis", "lp-pill-blue"],
  CLOSED: ["Closed", "lp-pill-neutral"],
  LIQUIDATED: ["Liquidated", "lp-pill-liq"],
};

/* illustrative traders (fictional handles). listed oldest first: the log scrolls up, the newest arrives at the bottom.
   exactly six rows: the hold-and-advance keyframes step one row in six */
const SAMPLE_FEED: Row[] = [
  { id: "s1", a: "0xc2ba36f1d07e9a4b", h: "@lastcall", k: "LIQUIDATED", coin: "HYPE", usd: 38_520, lev: 25, pnl: -4_912, ago: "4m" },
  { id: "s2", a: "0xd73400a9c1e85f2d", h: "@meanrev", k: "CLOSED", coin: "ETH", usd: 96_400, lev: 10, pnl: 12_805, ago: "3m" },
  { id: "s3", a: "0x111eec6c17c28d28", h: "@0xkoi", k: "SHORT", coin: "SOL", usd: 62_800, px: 171.32, lev: 10, ago: "2m" },
  { id: "s4", a: "0xcf3d0e47b2a91c06", h: "@thetafarmer", k: "THESIS", coin: "ETH", lev: 15, text: "shorts paying 0.03%/h into the weekly open. squeeze first, questions later.", ago: "58s" },
  { id: "s5", a: "0xac17248e5d03b7f9", h: "@basisboy", k: "LONG", coin: "SUI", usd: 21_350, px: 3.4127, lev: 5, ago: "31s" },
  { id: "s6", a: "0x6279f4b0c35e18da", h: "@sendit", k: "LONG", coin: "BTC", usd: 184_200, px: 82_410, lev: 20, ago: "now" },
];
/* the entry each sample row sat at relative to the mark (a short filled a touch above, a long a touch below) */
const SAMPLE_OFF: Record<string, number> = { s3: 1.0034, s5: 0.9991, s6: 0.9997 };
const SAMPLE_ROWS = 6;
/* round a derived sample price to a believable tick */
const tick = (v: number) => {
  const dp = v >= 1000 ? 0 : v >= 100 ? 2 : v >= 10 ? 3 : 4;
  return Math.round(v * 10 ** dp) / 10 ** dp;
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function fromItem(it: FeedItem): Row {
  const p = it.payload as { sizeUsd?: unknown; entryPx?: unknown; leverage?: unknown; realisedPnl?: unknown; text?: unknown };
  const handle = it.user?.handle ? `@${it.user.handle}` : (it.user?.displayName ?? shortAddr(it.address));
  return {
    id: it.id,
    a: it.address,
    h: handle,
    k: it.type as Kind,
    coin: it.coin,
    usd: n(p.sizeUsd) ?? it.position?.sizeUsd,
    px: n(p.entryPx) ?? it.position?.entryPx,
    lev: n(p.leverage) ?? it.position?.leverage,
    pnl: n(p.realisedPnl) ?? it.position?.realisedPnl ?? undefined,
    text: it.thesis?.text ?? (typeof p.text === "string" ? p.text : undefined),
    ago: timeAgo(it.time),
  };
}

function FeedCard({ items, mark, px }: { items: FeedItem[]; mark?: number; px: (coin: string) => number | undefined }) {
  const live = items.length >= SAMPLE_ROWS;
  // newest last, so fresh rows rise in from below
  const rows = live
    ? items.slice(0, SAMPLE_ROWS).map(fromItem).reverse()
    : SAMPLE_FEED.map((r) => {
        const m = r.coin === "BTC" ? mark : px(r.coin);
        return m && r.px !== undefined ? { ...r, px: tick(m * (SAMPLE_OFF[r.id] ?? 1)) } : r;
      });
  const loop = [...rows, ...rows];
  return (
    <Card
      kind="feed"
      tone="teal"
      delay="0s"
      label="Live feed"
      icon={
        <Ico>
          <path d="M3 12h3.6l2.6-6.5 4.6 13 2.6-6.5H21" />
        </Ico>
      }
      title="Longs, shorts and liquidations, straight from chain."
      body="We mirror positions from Hyperliquid for its top traders and everyone who signs up. Nothing is self-reported."
    >
      <div className="lp-feat-viz lp-feat-feedviz">
        <div className="lp-feat-panel">
          <div className="lp-feat-panel-head">
            {live ? (
              <span className="lp-feat-panel-title" aria-hidden>
                <span className="lp-live" /> Streaming
                <span className="lp-feat-panel-src lp-mono">Hyperliquid L1</span>
              </span>
            ) : (
              <span className="lp-feat-panel-title" aria-hidden>
                <span className="lp-feat-sample-dot" /> Sample feed
                <span className="lp-feat-panel-src lp-mono">Illustrative</span>
              </span>
            )}
            <span className="lp-feat-panel-tools">
              <span className="lp-feat-seg" aria-hidden>
                <span data-on="">All</span>
                <span>Theses</span>
                <span>Following</span>
              </span>
              <FeedPause />
            </span>
          </div>
          <div className="lp-feat-window" aria-hidden>
            <div className="lp-feat-track" style={vars({ "--t": `${rows.length * 6.4}s` })}>
              {loop.map((r, i) => (
                <FeedRow key={`${r.id}-${i}`} r={r} fresh={i % rows.length === rows.length - 1} dup={i >= rows.length} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const COIN_HUE: Record<string, string> = { BTC: "#f7931a", ETH: "#8c9bff", SOL: "#a77bff", HYPE: "#4de3c1", SUI: "#5aa8ff" };

function Coin({ c }: { c: string }) {
  const hue = COIN_HUE[c] ?? "#9fb3c0";
  return (
    <span className="lp-feat-coin" style={vars({ "--c": hue })}>
      <i>{c.slice(0, 1)}</i>
      {c}
    </span>
  );
}

function FeedRow({ r, fresh, dup }: { r: Row; fresh: boolean; dup: boolean }) {
  const [label, cls] = PILL[r.k] ?? ["Event", "lp-pill-neutral"];
  const closed = r.k === "CLOSED" || r.k === "LIQUIDATED";
  return (
    <div className={`lp-feat-row ${fresh ? "lp-feat-row-new" : ""}`} data-dup={dup ? "" : undefined}>
      <span className="lp-feat-row-av">
        <Disc a={r.a} size={32} />
      </span>
      <div className="min-w-0">
        <div className="lp-feat-row-top">
          <span className="lp-feat-handle">{r.h}</span>
          <span className={`lp-pill ${cls}`}>{label}</span>
        </div>
        <div className="lp-feat-row-sub lp-num">
          <Coin c={r.coin} />
          {r.k === "THESIS" && r.text ? (
            <span className="lp-feat-row-quote">“{r.text}”</span>
          ) : (
            <>
              {r.usd !== undefined && <span className="lp-feat-usd">{fmtUsd(r.usd, { compact: true })}</span>}
              {!closed && r.px !== undefined && (
                <>
                  <span className="lp-feat-at">at</span>
                  <span className="lp-feat-px">{fmtPx(r.px)}</span>
                </>
              )}
              {r.lev !== undefined && <span className="lp-feat-lev">{r.lev}x</span>}
            </>
          )}
        </div>
      </div>
      <div className="lp-feat-row-side lp-num">
        {fresh ? (
          <span className="lp-feat-ago lp-feat-ago-now lp-mono">
            <span className="lp-live" /> {r.ago}
          </span>
        ) : (
          <span className="lp-feat-ago lp-mono">{r.ago}</span>
        )}
        {closed && r.pnl !== undefined ? (
          <span className={`lp-feat-pnl-v ${r.pnl >= 0 ? "lp-feat-up" : "lp-feat-down"}`}>
            <span className="lp-feat-pnl-full">{wholeUsd(r.pnl)}</span>
            <span className="lp-feat-pnl-short">{fmtUsd(r.pnl, { sign: true, compact: true })}</span>
          </span>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

/* ---------- B. the thesis ---------- */
/* illustrative btc path since entry: a scare toward the invalidation, then the reclaim.
   drawn in these units; the labels are rescaled to the live mark (the shape is scale-free) */
const ENTRY = 81_920;
const INVALID = 81_400;
const PX = [81_920, 81_884, 81_802, 81_846, 81_712, 81_628, 81_566, 81_652, 81_736, 81_694, 81_842, 81_968, 81_912, 82_084, 82_196, 82_142, 82_296, 82_352, 82_428];
const PX_NOW = PX[PX.length - 1];
/* a fictional trader of its own: @nightowl's btc long already lives in the terminal below */
const POSTER = { a: "0x4b08d6e39a1c57f2", h: "@slowhands", rank: 6 };
const int = (v: number) => Math.round(v).toLocaleString("en-US");

/** catmull-rom through points, as cubic beziers */
function smooth(pts: [number, number][]) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += ` C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function ThesisCard({ mark }: { mark?: number }) {
  const k = mark ? mark / PX_NOW : 1;
  const entry = int(ENTRY * k);
  const invalid = `${((INVALID * k) / 1000).toFixed(1)}k`;
  const target = `${Math.round((83_000 * k) / 1000)}k`;
  const thesis = `swept the lows and the bids held. first stop ${target}, invalid below ${invalid}.`;
  const W = 400;
  const H = 96;
  const lo = 81_180;
  const hi = 82_560;
  const right = 30;
  const sx = (i: number) => (i / (PX.length - 1)) * (W - right);
  const sy = (v: number) => (1 - (v - lo) / (hi - lo)) * H;
  const pts = PX.map((v, i) => [sx(i), sy(v)] as [number, number]);
  const line = smooth(pts);
  const last = pts[pts.length - 1];
  const pct = (y: number) => `${((y / H) * 100).toFixed(2)}%`;
  const used = thesis.length;
  const C = 2 * Math.PI * 7;
  return (
    <Card
      kind="thesis"
      tone="blue"
      delay="0.12s"
      label="Thesis"
      icon={
        <Ico>
          <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />
          <path d="M8 10h8M8 13.2h5" />
        </Ico>
      }
      title="Say why. Bound to the position."
      body="Up to 280 characters with your trade. The thesis carries a live PnL badge and follows the position until it closes."
    >
      <div className="lp-feat-viz" aria-hidden>
        <div className="lp-feat-post">
          <div className="lp-feat-post-head">
            <Disc a={POSTER.a} size={36} />
            <div className="min-w-0">
              <div className="lp-feat-post-who">
                <b>{POSTER.h}</b>
                <span className="lp-feat-rank lp-mono">#{POSTER.rank}</span>
                <span className="lp-feat-post-time lp-mono">· 3h</span>
              </div>
              <div className="lp-feat-post-pos lp-num">
                <span className="lp-feat-up">BTC long</span> · 20x · entry {entry}
              </div>
            </div>
            <span className="lp-pill lp-pill-blue ml-auto">Thesis</span>
          </div>

          <p className="lp-feat-quote">{thesis}</p>

          <div className="lp-feat-pos">
            <div className="lp-feat-pos-top">
              <div className="lp-feat-pnl">
                <span className="lp-feat-pnl-halo" />
                <span className="lp-live lp-live-up" />
                <b className="lp-num">
                  <CountUp to={12.4} from={0} format="pct" decimals={1} prefix="+" delay={500} duration={1800} />
                </b>
              </div>
              <div className="lp-feat-pnl-usd lp-num">
                <b>+$2,284.10</b>
                <small className="lp-mono">Unrealised</small>
              </div>
              <div className="lp-feat-pos-px lp-num">
                <small className="lp-mono">Mark</small>
                <b>{int(PX_NOW * k)}</b>
              </div>
            </div>
            <div className="lp-feat-plot">
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="lp-feat-plot-line" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="#2aa98f" stopOpacity="0.5" />
                    <stop offset="0.6" stopColor="#4de3c1" />
                    <stop offset="1" stopColor="#d2fff4" />
                  </linearGradient>
                  <linearGradient id="lp-feat-plot-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#4de3c1" stopOpacity="0.2" />
                    <stop offset="1" stopColor="#4de3c1" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="lp-feat-plot-risk" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#ff4d4f" stopOpacity="0.16" />
                    <stop offset="1" stopColor="#ff4d4f" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="lp-feat-plot-drop" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#97fce4" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#97fce4" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <rect x="0" y={sy(INVALID)} width={W} height={H - sy(INVALID)} fill="url(#lp-feat-plot-risk)" />
                <line className="lp-feat-plot-inv" x1="0" x2={W} y1={sy(INVALID)} y2={sy(INVALID)} />
                <line className="lp-feat-plot-entry" x1="0" x2={W} y1={sy(ENTRY)} y2={sy(ENTRY)} />
                <path d={`${line} L${last[0].toFixed(1)},${H} L0,${H} Z`} fill="url(#lp-feat-plot-area)" />
                <path className="lp-feat-plot-line" d={line} />
                <line className="lp-feat-plot-mark" x1={last[0]} x2={W} y1={last[1]} y2={last[1]} />
                <rect x={last[0] - 0.5} y={last[1]} width="1" height={H - last[1]} fill="url(#lp-feat-plot-drop)" />
              </svg>
              <span className="lp-feat-plot-tag lp-mono lp-num" style={{ top: pct(sy(ENTRY)) }}>
                Entry {entry}
              </span>
              <span className="lp-feat-plot-tag lp-feat-plot-tag-inv lp-mono lp-num" style={{ top: pct(sy(INVALID)) }}>
                Invalid &lt; {invalid}
              </span>
              <span className="lp-feat-plot-now" style={{ left: `${((last[0] / W) * 100).toFixed(2)}%`, top: pct(last[1]) }} />
            </div>
          </div>

          <div className="lp-feat-held">
            <div className="lp-feat-held-top lp-mono">
              <span>
                Held <b className="lp-num">3h 12m</b>
              </span>
              <span className="lp-feat-held-ok">
                <Check size={11} /> Past the 1h mark
              </span>
            </div>
            <div className="lp-feat-meter">
              <span className="lp-feat-meter-fill" />
              <span className="lp-feat-meter-mark" style={vars({ left: "31%" })} />
            </div>
          </div>

          <div className="lp-feat-post-foot lp-mono lp-num">
            <span className="lp-feat-likes">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 20.3s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.6 2.5c0 5.6-7.6 10.2-7.6 10.2z" />
              </svg>
              214
            </span>
            <span className="lp-feat-count">
              <svg width="18" height="18" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7" className="lp-feat-count-track" />
                <circle cx="9" cy="9" r="7" className="lp-feat-count-fill" strokeDasharray={`${((used / 280) * C).toFixed(2)} ${C.toFixed(2)}`} />
              </svg>
              {used}/280
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------- C. the leaderboard ---------- */
/* illustrative standings (fictional handles) */
const BOARD = [
  { a: "0xe9c7d8a1f04b62ce", h: "@nightowl", pnl: 48_210, wr: 71, n: 38 },
  { a: "0xcf3d0e47b2a91c06", h: "@thetafarmer", pnl: 31_904, wr: 64, n: 52 },
  { a: "0x111eec6c17c28d28", h: "@0xkoi", pnl: 22_415, wr: 58, n: 24 },
  { a: "0xd73400a9c1e85f2d", h: "@meanrev", pnl: 17_880, wr: 55, n: 61 },
];

function BoardCard() {
  return (
    <Card
      kind="board"
      tone="mint"
      delay="0.08s"
      label="Leaderboard"
      icon={
        <Ico>
          <path d="M3.5 20h17M5.5 20v-6h4v6M10 20V8.5h4V20M14.5 20v-9h4v9" />
        </Ico>
      }
      title={<>Ranked by realised&nbsp;PnL. Not&nbsp;screenshots.</>}
      body={
        <>
          7d PnL, win rate and thesis accuracy, computed from <span className="whitespace-nowrap">on-chain</span> fills. Five closed trades to rank.
        </>
      }
    >
      <div className="lp-feat-viz" aria-hidden>
        <div className="lp-feat-board">
          <div className="lp-feat-board-head lp-mono">
            <span>
              Sample<span className="lp-feat-board-cap"> standings</span>
            </span>
            <span className="lp-feat-seg lp-feat-seg-sm">
              <span data-on="">7d PnL</span>
              <span>Win rate</span>
              <span>Accuracy</span>
            </span>
          </div>
          {BOARD.map((t, i) => (
            <div key={t.h} className={`lp-feat-lb ${i === 0 ? "lp-feat-lb-top" : ""}`} style={vars({ "--w": t.wr / 100, "--i": i })}>
              <span className="lp-feat-lb-rank lp-num">{i + 1}</span>
              <Disc a={t.a} size={30} />
              <div className="lp-feat-lb-mid">
                <div className="lp-feat-lb-line">
                  <b>{t.h}</b>
                  <span className="lp-feat-lb-pnl lp-num">
                    <CountUp to={t.pnl} format="usd0" prefix="+" delay={350 + i * 120} duration={1600} />
                  </span>
                </div>
                <div className="lp-feat-lb-line lp-feat-lb-sub lp-mono lp-num">
                  <span className="lp-feat-bar">
                    <span />
                  </span>
                  <span className="lp-feat-lb-wr">
                    {t.wr}% <small>win</small>
                  </span>
                </div>
              </div>
            </div>
          ))}
          {/* the gate: five closes before you're on the board */}
          <div className="lp-feat-lb lp-feat-lb-you">
            <span className="lp-feat-lb-rank lp-num">–</span>
            <span className="lp-feat-you-disc" />
            <div className="lp-feat-lb-mid">
              <div className="lp-feat-lb-line">
                <b>You</b>
                <span className="lp-feat-lb-gate lp-mono lp-num">3 of 5 closes</span>
              </div>
              <div className="lp-feat-lb-line lp-feat-lb-sub lp-mono lp-num">
                <span className="lp-feat-pips">
                  {[0, 1, 2, 3, 4].map((k) => (
                    <i key={k} data-on={k < 3 ? "" : undefined} style={vars({ "--k": k })} />
                  ))}
                </span>
                <span className="lp-feat-lb-wr lp-feat-lb-unranked">Unranked</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------- D. receipts ---------- */
const OUTCOMES: [string, string, string][] = [
  ["Holding", "lp-pill-brand", "Still in it"],
  ["Closed in profit", "lp-pill-up", "Called it"],
  ["Closed at loss", "lp-pill-down", "Took the L"],
  ["Liquidated", "lp-pill-liq", "The engine took it"],
  ["Dumped < 1h", "lp-pill-amber", "Out inside the hour"],
];

/** deterministic barcode widths */
const BARS = (() => {
  const out: [number, number][] = [];
  let x = 0;
  let s = 4821;
  while (x < 196) {
    s = (s * 9301 + 49297) % 233280;
    const w = 1 + (s % 3);
    out.push([x, w]);
    x += w + 1 + (s % 4 === 0 ? 2 : 1);
  }
  return out;
})();

function ReceiptCard() {
  return (
    <Card
      kind="receipt"
      tone="amber"
      delay="0.2s"
      label="Receipts"
      icon={
        <Ico>
          <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
          <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
        </Ico>
      }
      title="Close inside an hour and it says so. Forever."
      body="When the position closes, its thesis gets an outcome straight from the fills: profit, loss, liquidation, or the one nobody wants on their profile."
      extra={
        <div className="lp-feat-outs">
          <span className="lp-feat-outs-label lp-mono">Five outcomes · one record</span>
          <ul className="lp-feat-outs-list">
            {OUTCOMES.map(([t, cls, note], i) => (
              <li key={t} className={`lp-feat-out-row ${i === OUTCOMES.length - 1 ? "lp-feat-out-hot" : ""}`}>
                <span className={`lp-pill lp-feat-out ${cls}`}>
                  <i aria-hidden />
                  {t}
                </span>
                <span className="lp-feat-out-note">{note}</span>
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <div className="lp-feat-viz lp-feat-ticketviz" aria-hidden>
        <div className="lp-feat-ticket">
          <div className="lp-feat-ticket-shape">
            <div className="lp-feat-paper lp-mono">
              <div className="lp-feat-paper-brand">
                <Mark size={14} id="lp-feat-mk" />
                <span>socialLiquid</span>
                <small>Receipt</small>
              </div>
              <div className="lp-feat-perf" />
              <div className="lp-feat-tl">
                <span>Thesis</span>
                <b>#4821</b>
              </div>
              <div className="lp-feat-tl">
                <span>Trader</span>
                <b>@lastcall</b>
              </div>
              <p className="lp-feat-paper-quote">“not selling this one.”</p>
              <div className="lp-feat-perf" />
              <div className="lp-feat-tl">
                <span>BTC-USD</span>
                <b>Long 20x</b>
              </div>
              <div className="lp-feat-tl">
                <span>Opened</span>
                <b className="lp-num">14:02 UTC</b>
              </div>
              <div className="lp-feat-tl">
                <span>Closed</span>
                <b className="lp-num">14:41 UTC</b>
              </div>
              <div className="lp-feat-tl">
                <span>Held</span>
                <b className="lp-num">39m</b>
              </div>
              <div className="lp-feat-perf" />
              <div className="lp-feat-tl lp-feat-tl-big">
                <span>PnL</span>
                <b className="lp-num lp-feat-down">-$212.40</b>
              </div>
              <div className="lp-feat-stampzone">
                <span className="lp-feat-stampzone-label">Outcome</span>
                <div className="lp-feat-stamp">
                  <div className="lp-feat-stamp-ink">
                    <b>Dumped &lt; 1h</b>
                    <small>Held 39m · #4821</small>
                  </div>
                </div>
              </div>
              <svg className="lp-feat-barcode" viewBox="0 0 196 26" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="lp-feat-bc" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#eef6f9" stopOpacity="0.62" />
                    <stop offset="1" stopColor="#b9c9d1" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
                {BARS.map(([x, w]) => (
                  <rect key={x} x={x} y="0" width={w} height="26" />
                ))}
              </svg>
              <div className="lp-feat-paper-id lp-num">0x9f2c…41d7 · fill 18,224,019</div>
            </div>
          </div>
          <div className="lp-feat-gloss" />
        </div>
      </div>
    </Card>
  );
}
