import type { ReactNode } from "react";
import { fmtPx } from "@/lib/format";
import { CountUp } from "./motion";
import { TrendArrow, vars } from "./parts";
import type { LandingData } from "./types";

type Mkt = LandingData["tape"][number];

/* ---------- coin discs: a few known skins; everything else takes a tone from its name,
   drawn from a palette that never reads as up-green or down-red ---------- */
const SKINS: Record<string, [string, string, string]> = {
  BTC: ["#ffd9a0", "#f7931a", "#a3570a"],
  ETH: ["#dfe6ff", "#8aa6ff", "#3a4cae"],
  HYPE: ["#dcfff6", "#62ecca", "#167a68"],
  SOL: ["#eadcff", "#a184ff", "#2a8f84"],
  BNB: ["#fff0c2", "#f0b93a", "#8a6110"],
  DOGE: ["#fff1cf", "#d9b66a", "#7c5f22"],
  SUI: ["#e0f3ff", "#6cb8f5", "#21558c"],
  XRP: ["#eef2f6", "#a7b4c2", "#46525f"],
};
// [hue, saturation]: teal, sky, blue, periwinkle, violet, orchid, amber, slate
const TONES: [number, number][] = [[168, 58], [196, 70], [214, 72], [228, 78], [258, 62], [292, 42], [38, 78], [206, 18]];
function tone(s: string) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
function skin(coin: string): [string, string, string] {
  const s = SKINS[coin];
  if (s) return s;
  const [h, sat] = tone(coin);
  return [`hsl(${h} ${sat}% 88%)`, `hsl(${h} ${sat}% 62%)`, `hsl(${(h + 18) % 360} ${Math.round(sat * 0.85)}% 27%)`];
}

function Coin({ coin }: { coin: string }) {
  const [c0, c1, c2] = skin(coin);
  return (
    <span className="lp-tape-coin" style={vars({ "--c0": c0, "--c1": c1, "--c2": c2 })}>
      {coin.replace(/^k(?=[A-Z])/, "").charAt(0)}
    </span>
  );
}

const pct = (v: number) => `${Math.abs(v * 100).toFixed(2)}%`;
const flat = (v: number) => Math.abs(v) < 0.00005;

function Item({ m }: { m: Mkt }) {
  const up = m.change24h >= 0;
  const dir = flat(m.change24h) ? "flat" : up ? "up" : "down";
  return (
    <li className="lp-tape-item">
      <Coin coin={m.coin} />
      <span className="lp-tape-sym">{m.coin}</span>
      {m.maxLeverage > 0 && <span className={`lp-tape-lev lp-mono ${m.maxLeverage >= 20 ? "lp-tape-lev-hi" : ""}`}>{m.maxLeverage}x</span>}
      <span className="lp-tape-px lp-num">{fmtPx(m.markPx)}</span>
      <span className={`lp-tape-chg lp-tape-${dir} lp-num`}>
        {dir !== "flat" && <TrendArrow up={up} size={11} />}
        {pct(m.change24h)}
      </span>
      <span className="lp-tape-sep" />
    </li>
  );
}

/* shown when hyperliquid is unreachable: the product, in one line */
const PHRASES = ["Perps only", "Non-custodial", "Builder code 0.05%", "Receipts forever", "Every fill on-chain", "Hold or dump, in public"];

function Phrase({ p }: { p: string }) {
  return (
    <li className="lp-tape-item lp-tape-phrase lp-mono">
      {p}
      <span className="lp-tape-sep lp-tape-sep-glyph" />
    </li>
  );
}

/* ---------- stats ---------- */
const UNITS: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"], [1, ""]];
/** 2.34 + "M": three significant figures, and a value that rounds up to 1000 moves to the next unit */
function scale(v: number): [number, string, number] {
  const fit = (k: number): [number, string, number] => {
    const n = v / UNITS[k][0];
    const dp = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
    return [Number(n.toFixed(dp)), UNITS[k][1], dp];
  };
  const found = UNITS.findIndex(([d]) => Math.abs(v) >= d);
  const k = found < 0 ? UNITS.length - 1 : found;
  const r = fit(k);
  return k > 0 && Math.abs(r[0]) >= 1000 ? fit(k - 1) : r;
}
/** count from the first number with the same digit count, so a centred figure never jumps sideways */
const floorOf = (n: number) => (n >= 1 ? 10 ** Math.floor(Math.log10(n)) : 0);

const ICONS: Record<string, ReactNode> = {
  markets: <path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z" />,
  volume: <path d="M5 20V12M10 20V6M15 20v-9M20 20V9" />,
  oi: <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" />,
  lev: <path d="M4.5 17a8 8 0 1 1 15 0M12 13l4-5M12 13h.01" />,
};

/** sr: what a screen reader hears; the drawn figure (split units, counting digits) is hidden from it */
function Stat({ i, icon, label, note, sr, children }: { i: number; icon: string; label: string; note: string; sr: string; children: ReactNode }) {
  return (
    <div className="lp-tape-stat" data-reveal style={vars({ "--d": `${0.08 + i * 0.09}s`, "--i": i })}>
      <dt className="lp-tape-label lp-mono">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {ICONS[icon]}
        </svg>
        {label}
      </dt>
      <dd className="lp-tape-fig lp-num">
        <span className="sr-only">{sr}</span>
        <span className="lp-tape-fig-in" aria-hidden>
          {children}
        </span>
      </dd>
      <dd className="lp-tape-note">{note}</dd>
    </div>
  );
}

const Dash = () => <span className="lp-tape-dash">—</span>;

function Money({ v, delay }: { v: number; delay: number }) {
  if (!(v > 0)) return <Dash />;
  const [n, u, dp] = scale(v);
  return (
    <>
      <span className="lp-tape-cur">$</span>
      <CountUp to={n} from={floorOf(n)} format="fixed" decimals={dp} delay={delay} duration={1700} />
      {u && <span className="lp-tape-unit">{u}</span>}
    </>
  );
}
const moneySr = (v: number) => {
  if (!(v > 0)) return "not available";
  const [n, u, dp] = scale(v);
  return `$${n.toFixed(dp)}${u}`;
};

export function Tape({ d }: { d: LandingData }) {
  const live = d.tape.length > 0;
  const s = d.stats;
  const net = `Hyperliquid${d.testnet ? " testnet" : ""}`;
  const at = new Date().toISOString().slice(11, 16);
  // ~4.4s of travel per market keeps the pace calm (about 60px/s) whatever the count
  const t = `${Math.round(Math.max(48, (live ? d.tape.length : PHRASES.length * 2) * 4.4))}s`;
  const row = live ? d.tape.map((m) => <Item key={m.coin} m={m} />) : [...PHRASES, ...PHRASES].map((p, i) => <Phrase key={i} p={p} />);
  // notes carry a live fact where the data has one: btc's share of the day, and which market sets the ceiling
  const btcShare = d.btc && s.volume24h > 0 ? Math.round((d.btc.volume24h / s.volume24h) * 100) : 0;
  const ceiling = d.tape.find((m) => m.coin === "BTC" && m.maxLeverage === s.maxLeverage) ?? d.tape.find((m) => m.maxLeverage === s.maxLeverage);

  return (
    <section id="markets" aria-label="Live markets" className="lp-tape">
      <h2 className="sr-only">Live markets on {net}</h2>
      <div className="lp-tape-veil" aria-hidden />
      <div className="lp-tape-atmos" aria-hidden>
        <div className="lp-tape-pool" />
        <div className="lp-grain" />
      </div>

      {/* the tape */}
      <div className="lp-tape-band" data-reveal="fade">
        <span className="lp-tape-rule lp-tape-rule-top" aria-hidden />
        {/* now and then a comet runs the top hairline: the hero's orbit light, carried down */}
        <span className="lp-tape-comet" aria-hidden>
          <span className="lp-tape-comet-arm" />
        </span>
        <span className="lp-tape-rule lp-tape-rule-bottom" aria-hidden />
        <div className="lp-tape-viewport" aria-hidden tabIndex={-1}>
          <div className="lp-tape-track" style={vars({ "--t": t })}>
            <ul className="lp-tape-list">{row}</ul>
            <ul className="lp-tape-list">{row}</ul>
          </div>
        </div>
        {live && (
          <ul className="sr-only" aria-label={`Top ${d.tape.length} perp markets by 24h volume`}>
            {d.tape.map((m) => (
              <li key={m.coin}>
                {m.coin}: {fmtPx(m.markPx)}, {flat(m.change24h) ? "flat" : m.change24h > 0 ? "up" : "down"} {pct(m.change24h)} in 24 hours
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* the numbers */}
      <div className="lp-container">
        <p className="lp-tape-caption lp-mono" data-reveal="fade">
          {s.markets > 0 ? (
            <>
              <span className="lp-live" />
              <span>Live from {net}</span>
              <span className="lp-tape-caption-dot" aria-hidden />
              <span className="lp-tape-caption-time">Snapshot {at} UTC</span>
            </>
          ) : (
            <>
              <span className="lp-tape-idle" aria-hidden />
              <span>{net} feed reconnecting</span>
              <span className="lp-tape-caption-dot" aria-hidden />
              <span className="lp-tape-caption-time">Figures return on the next load</span>
            </>
          )}
        </p>
        <dl className="lp-tape-stats">
          <Stat i={0} icon="markets" label="Perp markets" note="listed on Hyperliquid" sr={s.markets > 0 ? String(s.markets) : "not available"}>
            {s.markets > 0 ? <CountUp to={s.markets} from={floorOf(s.markets)} format="int" delay={120} duration={1500} /> : <Dash />}
          </Stat>
          <Stat i={1} icon="volume" label="24h volume" note={btcShare >= 1 && btcShare < 100 ? `BTC is ${btcShare}% of it` : "across every perp"} sr={moneySr(s.volume24h)}>
            <Money v={s.volume24h} delay={210} />
          </Stat>
          <Stat i={2} icon="oi" label="Open interest" note="notional, marked live" sr={moneySr(s.openInterest)}>
            <Money v={s.openInterest} delay={300} />
          </Stat>
          <Stat i={3} icon="lev" label="Max leverage" note={ceiling ? `the ceiling, on ${ceiling.coin}` : "set per market"} sr={s.maxLeverage > 0 ? `${s.maxLeverage}x` : "not available"}>
            {s.maxLeverage > 0 ? (
              <>
                <CountUp to={s.maxLeverage} from={floorOf(s.maxLeverage)} format="int" delay={390} duration={1500} />
                <span className="lp-tape-unit">x</span>
              </>
            ) : (
              <Dash />
            )}
          </Stat>
        </dl>
      </div>
    </section>
  );
}
