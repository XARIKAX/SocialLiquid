import Link from "next/link";
import type { FeedItem } from "@/lib/queries";
import { fmtPct, fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { Icon } from "../icons";

type Props = {
  stats: { markets: number; volume24h: number; traders: number };
  btc: { markPx: number; change24h: number; volume24h: number; openInterestUsd: number; funding: number; maxLeverage: number } | null;
  candles: number[];
  items: FeedItem[];
  traders: { address: string; displayName: string | null }[];
};

export function Landing(p: Props) {
  return (
    <div className="theme-dark bg-bg text-fg">
      <Nav />
      <Hero stats={p.stats} />
      <Preview {...p} />
      <Features />
      <HowItWorks />
      <Orbit traders={p.traders} count={p.stats.traders} />
      <Footer />
    </div>
  );
}

/* ---------- nav ---------- */
function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-20 h-16 flex items-center px-5 md:px-8">
      <Link href="/" className="inline-flex items-center gap-1.5 font-semibold tracking-[-0.03em] text-[19px]">
        <span className="text-brand"><Icon.drop /></span>
        <span>social<span className="text-brand">Liquid</span></span>
      </Link>
      <nav className="ml-auto flex items-center gap-1.5">
        <a href="#how" className="btn btn-ghost h-9 hidden sm:inline-flex">How it works</a>
        <a href="https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes" target="_blank" rel="noreferrer" className="btn btn-ghost h-9 hidden sm:inline-flex">Builder codes</a>
        <Link href="/trade" className="btn h-9 glass">Launch app</Link>
      </nav>
    </header>
  );
}

/* ---------- hero ---------- */
function Hero({ stats }: { stats: Props["stats"] }) {
  return (
    <section className="relative min-h-[100svh] hero-bg overflow-hidden flex flex-col">
      <div className="stars" />
      <div className="stars-2" />
      <div className="horizon" />
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-5 pt-24 pb-28">
        <span className="glass inline-flex items-center gap-2 rounded-full px-3 h-8 text-xs text-fg-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand live-dot" />
          Built on Hyperliquid · no custody · every trade on-chain
        </span>
        <h1 className="wordmark mt-7">
          social<span className="wordmark-liquid">Liquid</span>
        </h1>
        <p className="mt-6 text-[clamp(22px,3.1vw,38px)] font-medium tracking-[-0.03em] text-fg">the social layer for Hyperliquid.</p>
        <p className="mt-3 max-w-[640px] text-[clamp(15px,1.4vw,19px)] text-muted text-balance leading-snug">
          Follow the best traders on Hyperliquid, see every position as it opens, and trade alongside them. Post a thesis, put the position behind it, and let everyone watch you hold or dump.
        </p>
        <div className="mt-9 flex items-center gap-3 flex-wrap justify-center">
          <Link href="/trade" className="btn btn-primary h-12 px-7 text-[15px] rounded-xl">Start trading</Link>
          <Link href="/trade" className="btn h-12 px-7 text-[15px] rounded-xl glass">Watch the feed</Link>
        </div>
        <dl className="mt-10 flex items-center gap-x-8 gap-y-2 flex-wrap justify-center text-xs text-muted num">
          <Stat v={String(stats.markets)} k="perp markets" />
          <Stat v={fmtUsd(stats.volume24h, { compact: true })} k="24h volume" />
          <Stat v={stats.traders.toLocaleString("en-US")} k="traders tracked" />
          <Stat v="0.05%" k="builder fee / side" />
        </dl>
      </div>
      <div className="relative z-10 pb-16 text-center text-[11px] tracking-[0.22em] uppercase text-brand font-semibold">The social layer for Hyperliquid</div>
    </section>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{k}</dt>
      <dd className="text-fg font-semibold text-sm">{v}</dd>
      <span className="font-sans">{k}</span>
    </div>
  );
}

/* ---------- product preview, built from live data ---------- */
function Preview({ btc, candles, items }: Props) {
  const up = (btc?.change24h ?? 0) >= 0;
  return (
    <section className="relative px-4 md:px-8 -mt-8 pb-10">
      <div className="absolute inset-x-0 top-1/3 h-[60%] bg-[radial-gradient(60%_60%_at_50%_50%,rgb(77_227_193/0.10),transparent_70%)] pointer-events-none" />
      <div className="relative mx-auto max-w-[1180px] window rounded-2xl overflow-hidden bg-panel border border-line">
        <div className="h-10 flex items-center gap-2 px-4 border-b border-line bg-panel-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <span className="mx-auto card-2 h-6 px-3 inline-flex items-center text-[11px] text-muted num">socialliquid.xyz/m/BTC</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[260px_minmax(0,1fr)_240px] text-[12px]">
          {/* feed */}
          <div className="hidden md:block border-r border-line">
            <div className="flex items-center gap-0.5 px-2 h-10 border-b border-line text-[11px]">
              <span className="tab h-7 px-2 text-muted"><Icon.bell /> Alerts</span>
              <span className="tab h-7 px-2 text-muted">Tokens</span>
              <span className="tab h-7 px-2 tab-active">Feed</span>
            </div>
            {items.slice(0, 6).map((it) => (
              <MiniCard key={it.id} it={it} />
            ))}
            {items.length === 0 && <div className="p-4 text-dim text-xs">Live positions from tracked traders land here.</div>}
          </div>
          {/* chart */}
          <div className="min-w-0">
            <div className="flex items-center gap-3 px-4 h-14 border-b border-line">
              <span className="w-8 h-8 rounded-full bg-[#f7931a] text-black font-bold inline-flex items-center justify-center text-sm">₿</span>
              <span className="font-semibold text-[15px]">BTC</span>
              <span className="pill pill-neutral num">BTC-USD</span>
              <span className="pill pill-brand num">{btc?.maxLeverage ?? 40}x</span>
              <span className="ml-auto flex items-center gap-1.5 overflow-hidden">
                <span className="chip min-w-0"><span className="chip-label">Mark</span><span className={`chip-value ${up ? "text-up" : "text-down"}`}>{btc ? fmtPx(btc.markPx) : "–"}</span></span>
                <span className="chip min-w-0 hidden lg:inline-flex"><span className="chip-label">24H</span><span className={`chip-value ${up ? "text-up" : "text-down"}`}>{btc ? fmtPct(btc.change24h) : "–"}</span></span>
                <span className="chip min-w-0 hidden lg:inline-flex"><span className="chip-label">Funding</span><span className="chip-value text-up">{btc ? `${(btc.funding * 100).toFixed(4)}%` : "–"}</span></span>
              </span>
            </div>
            <div className="h-[260px] relative">
              <Spark values={candles} up={up} />
              <div className="absolute left-4 top-3 text-[11px] num text-muted">BTC-USD · 1h · socialLiquid</div>
            </div>
            <div className="border-t border-line">
              <div className="flex items-center gap-1 px-2 h-9 border-b border-line text-[11px]">
                <span className="tab h-7 px-2 tab-active">Positions</span>
                <span className="tab h-7 px-2 text-muted">Trades</span>
                <span className="tab h-7 px-2 text-muted">Thesis</span>
              </div>
              {items
                .filter((i) => i.position && !i.position.closedAt)
                .slice(0, 3)
                .map((i) => (
                  <div key={i.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 h-11 border-b border-line/60">
                    <span className="flex items-center gap-2 min-w-0"><Dot a={i.address} /><span className="truncate font-medium">{i.user?.handle ?? i.user?.displayName ?? shortAddr(i.address)}</span></span>
                    <span className="num"><span className={i.position!.side === "LONG" ? "text-up" : "text-down"}>{i.position!.side === "LONG" ? "Long" : "Short"}</span> <span className="text-muted">{i.position!.leverage}x</span></span>
                    <span className="num font-medium">{fmtUsd(i.position!.sizeUsd, { compact: true })}</span>
                  </div>
                ))}
            </div>
          </div>
          {/* ticket */}
          <div className="hidden md:block border-l border-line p-3 space-y-2">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-panel-2 border border-line">
              <span className="h-8 rounded-lg bg-up/15 text-up font-semibold inline-flex items-center justify-center">Long</span>
              <span className="h-8 rounded-lg text-muted inline-flex items-center justify-center">Short</span>
            </div>
            <div className="card-2 px-3 py-2.5 flex items-center justify-between"><span className="num text-[22px] font-semibold">$100</span><span className="text-dim text-[10px]">≈ 0.0009 BTC</span></div>
            <div className="grid grid-cols-4 gap-1">{["$10", "$100", "$500", "$1K"].map((q) => <span key={q} className="btn h-7 px-0 text-[11px] num">{q}</span>)}</div>
            <div className="card-2 px-3 py-2"><div className="flex justify-between text-[11px]"><span className="text-muted">Leverage</span><span className="num font-semibold">5x</span></div><div className="h-1 rounded-full bg-line-2 mt-2"><div className="h-full w-[12%] rounded-full bg-brand" /></div></div>
            <div className="card-2 px-3 py-2 text-[11px]"><div className="text-thesis font-medium">Why this trade?</div><div className="text-dim mt-0.5">funding flat, reclaiming the range high…</div></div>
            <span className="btn btn-up w-full h-9">Long BTC · $100</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniCard({ it }: { it: FeedItem }) {
  const p = it.payload as { side?: string; sizeUsd?: number; leverage?: number; entryPx?: number; realisedPnl?: number };
  const tag: Record<string, [string, string]> = { LONG: ["Long", "pill-up"], SHORT: ["Short", "pill-down"], THESIS: ["Thesis", "pill-thesis"], CLOSED: ["Closed", "pill-neutral"], LIQUIDATED: ["Liquidated", "pill-liq"] };
  const [label, cls] = tag[it.type] ?? ["", "pill-neutral"];
  const closed = it.type === "CLOSED" || it.type === "LIQUIDATED";
  return (
    <div className="px-3 py-2.5 border-b border-line/70">
      <div className="flex items-center gap-2">
        <Dot a={it.address} size={22} />
        <span className="font-semibold truncate">{it.user?.handle ?? it.user?.displayName ?? shortAddr(it.address)}</span>
        <span className={`pill ${cls}`}>{label}</span>
        <span className="ml-auto text-dim num text-[10px]">{timeAgo(it.time)}</span>
      </div>
      <div className="pl-[30px] mt-1 flex items-center gap-1.5 num">
        <span className="font-semibold">{it.coin}</span>
        {p.sizeUsd !== undefined && <span>{fmtUsd(p.sizeUsd, { compact: true })}</span>}
        {p.entryPx !== undefined && <><span className="text-dim">at</span><span className="text-fg-2">{fmtPx(p.entryPx)}</span></>}
        {p.leverage !== undefined && <span className="pill pill-neutral">{p.leverage}x</span>}
        {closed && p.realisedPnl !== undefined && <span className={`ml-auto font-semibold ${p.realisedPnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(p.realisedPnl, { sign: true })}</span>}
      </div>
      {it.thesis && <p className="pl-[30px] mt-1 text-fg-2 line-clamp-2">{it.thesis.text}</p>}
    </div>
  );
}

function Dot({ a, size = 20 }: { a: string; size?: number }) {
  const h1 = parseInt(a.slice(2, 8), 16) % 360;
  const h2 = (h1 + 60) % 360;
  return <span className="rounded-full shrink-0 inline-block" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h1} 72% 62%), hsl(${h2} 70% 42%))` }} />;
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="absolute inset-0 flex items-center justify-center text-dim text-xs">chart</div>;
  const w = 800;
  const h = 260;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sx = (i: number) => (i / (values.length - 1)) * w;
  const sy = (v: number) => 24 + (1 - (v - min) / Math.max(1e-9, max - min)) * (h - 60);
  const d = values.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const color = up ? "#22d36b" : "#ff4d4f";
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
      <defs>
        <linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
        <pattern id="grid" width="80" height="52" patternUnits="userSpaceOnUse"><path d="M80 0H0V52" fill="none" stroke="#131317" strokeWidth="1" /></pattern>
      </defs>
      <rect width={w} height={h} fill="url(#grid)" />
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#lg)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={w} y1={sy(last)} y2={sy(last)} stroke="#4de3c1" strokeDasharray="4 4" strokeOpacity="0.7" />
    </svg>
  );
}

/* ---------- features ---------- */
function Features() {
  return (
    <section id="receipts" className="px-5 md:px-8 py-24 max-w-[1180px] mx-auto">
      <h2 className="h-display">never miss a move</h2>
      <p className="mt-3 text-[clamp(17px,1.6vw,22px)] text-muted">the only social-first perps terminal</p>
      <div className="grid md:grid-cols-3 gap-4 mt-12">
        <Feature label="Feed" title="every long, short and liquidation, the second it hits chain" body="We mirror positions straight from Hyperliquid for the top 200 traders and anyone who signs up. Nothing is self-reported." />
        <Feature label="Thesis" title="say why, bound to the position" body="Post up to 280 characters with your trade. The thesis carries a live PnL badge and follows the position until it closes." />
        <Feature label="Leaderboard" title="ranked by realised PnL from fills, not screenshots" body="7d PnL, win rate and thesis accuracy, computed from on-chain fills. Five closed trades to rank." />
      </div>
      <div className="card mt-4 p-6 md:p-8 grid md:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <div className="feature-label">Receipts</div>
          <h3 className="text-[clamp(22px,2.4vw,30px)] font-medium tracking-[-0.03em] leading-tight mt-2">close inside an hour and it says so, forever</h3>
          <p className="text-muted mt-2 max-w-[560px]">Every thesis gets an outcome the moment the position closes. Hold, profit, loss, liquidation, or the one nobody wants on their profile.</p>
        </div>
        <div className="flex flex-wrap gap-2 md:max-w-[320px] md:justify-end">
          <span className="pill pill-brand h-7 px-2.5 text-xs">Holding</span>
          <span className="pill pill-up h-7 px-2.5 text-xs">Closed in profit</span>
          <span className="pill pill-down h-7 px-2.5 text-xs">Closed at loss</span>
          <span className="pill pill-liq h-7 px-2.5 text-xs">Liquidated</span>
          <span className="pill pill-warn h-7 px-2.5 text-xs">Dumped &lt; 1h</span>
        </div>
      </div>
    </section>
  );
}

function Feature({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="card p-6 md:p-7 min-h-[240px] flex flex-col">
      <div className="feature-label">{label}</div>
      <h3 className="text-[clamp(22px,2.2vw,28px)] font-medium tracking-[-0.03em] leading-tight mt-3 text-balance">{title}</h3>
      <p className="text-muted mt-auto pt-6 leading-snug">{body}</p>
    </div>
  );
}

/* ---------- how it works ---------- */
function HowItWorks() {
  const steps = [
    ["Connect", "Any EVM wallet. Hyperliquid signs with the same key. Connecting only reads your address."],
    ["Approve once", "Two signatures: an API wallet so you never sign per click, and a 0.1% max builder fee so our code rides your fills."],
    ["Trade and post", "Market or limit, up to the market's max leverage, TP and SL. Add a thesis if you dare. Deposit USDC from Arbitrum."],
  ];
  return (
    <section id="how" className="px-5 md:px-8 pb-24 max-w-[1180px] mx-auto">
      <div className="card p-6 md:p-10 grid lg:grid-cols-[320px_1fr] gap-10">
        <div>
          <div className="feature-label">How it works</div>
          <h2 className="text-[clamp(28px,3vw,40px)] font-medium tracking-[-0.035em] leading-tight mt-3">no custody. no contracts. just your receipts.</h2>
          <p className="text-muted mt-3">Orders route to Hyperliquid with our builder code. We never hold your main key, and there is no token, pool or custom contract anywhere in the stack.</p>
          <Link href="/trade" className="btn btn-primary h-11 px-6 mt-6">Launch app</Link>
        </div>
        <ol className="grid sm:grid-cols-3 gap-3">
          {steps.map(([t, b], i) => (
            <li key={t} className="card-2 p-5">
              <span className="w-7 h-7 rounded-full bg-brand/15 text-brand num text-xs font-semibold inline-flex items-center justify-center">{i + 1}</span>
              <h3 className="font-semibold text-[15px] mt-4">{t}</h3>
              <p className="text-muted text-[13px] mt-1.5 leading-snug">{b}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- orbit cta ---------- */
function Orbit({ traders, count }: { traders: { address: string; displayName: string | null }[]; count: number }) {
  const ring1 = traders.slice(0, 5);
  const ring2 = traders.slice(5, 11);
  return (
    <section className="relative overflow-hidden px-5 py-28 md:py-40 bg-[radial-gradient(70%_80%_at_50%_50%,#121634_0%,#0a0b16_55%,#050507_100%)]">
      <div className="stars opacity-40" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-[min(92vw,760px)] aspect-square">
          <div className="ring w-[52%] h-[52%]" />
          <div className="ring w-[78%] h-[78%]" />
          <div className="ring w-[100%] h-[100%]" />
          <div className="orbit" style={{ ["--dur" as string]: "70s" }}>
            {ring1.map((t, i) => (
              <span key={t.address} className="orbit-item" style={{ ["--a" as string]: `${(i / Math.max(1, ring1.length)) * 360}deg`, ["--r" as string]: "calc(min(92vw, 760px) * 0.39)" }}>
                <Dot a={t.address} size={34} />
              </span>
            ))}
          </div>
          <div className="orbit orbit-r" style={{ ["--dur" as string]: "110s" }}>
            {ring2.map((t, i) => (
              <span key={t.address} className="orbit-item" style={{ ["--a" as string]: `${(i / Math.max(1, ring2.length)) * 360 + 20}deg`, ["--r" as string]: "calc(min(92vw, 760px) * 0.5)" }}>
                <Dot a={t.address} size={44} />
              </span>
            ))}
          </div>
          <span className="absolute left-1/2 bottom-[-22px] -translate-x-1/2 w-11 h-11 rounded-full bg-brand text-black inline-flex items-center justify-center shadow-[0_0_40px_rgb(77_227_193/0.6)]"><Icon.drop /></span>
        </div>
      </div>
      <div className="relative z-10 text-center max-w-[720px] mx-auto">
        <h2 className="text-[clamp(34px,5vw,60px)] font-medium tracking-[-0.04em] leading-[1.02]">follow the best.<br />trade alongside them.</h2>
        <p className="mt-5 text-[clamp(15px,1.5vw,20px)] text-muted">join {count.toLocaleString("en-US")} {count === 1 ? "trader" : "traders"} making their name on socialLiquid</p>
        <div className="mt-8 flex items-center gap-3 justify-center flex-wrap">
          <Link href="/trade" className="btn btn-primary h-12 px-7 text-[15px] rounded-xl">Start trading</Link>
          <Link href="/leaderboard" className="btn h-12 px-7 text-[15px] rounded-xl glass">See the leaderboard</Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- footer ---------- */
function Footer() {
  const cols: [string, [string, string][]][] = [
    ["About", [["How it works", "#how"], ["Receipts", "#receipts"], ["Builder codes", "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes"]]],
    ["Social", [["X / Twitter", "https://x.com"], ["Hyperliquid", "https://app.hyperliquid.xyz"]]],
    ["Legal", [["Privacy", "#"], ["Terms", "#"]]],
  ];
  return (
    <footer className="px-5 md:px-8 py-16 border-t border-line">
      <div className="max-w-[1180px] mx-auto grid md:grid-cols-[1fr_auto] gap-10">
        <div>
          <div className="inline-flex items-center gap-1.5 font-semibold tracking-[-0.03em] text-[26px]"><span className="text-brand"><Icon.drop /></span><span>social<span className="text-brand">Liquid</span></span></div>
          <p className="text-muted mt-1">the social layer for Hyperliquid.</p>
          <p className="text-dim text-xs mt-6">© 2026 socialLiquid. Not an exchange. All trades execute on Hyperliquid.</p>
        </div>
        <div className="grid grid-cols-3 gap-10">
          {cols.map(([h, links]) => (
            <div key={h}>
              <div className="text-[11px] tracking-[0.18em] uppercase text-dim mb-3">{h}</div>
              <ul className="space-y-2 text-[13px]">
                {links.map(([l, href]) => (
                  <li key={l}>
                    <a href={href} className="text-fg-2 hover:text-fg" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
