import Link from "next/link";
import { CountUp } from "./motion";
import { Arrow, Disc, Mark, TrendArrow, vars } from "./parts";
import type { LandingData } from "./types";

/* =====================================================================
   the closing call to action: the bookend to the hero. the hero's light
   comes down from above; here it rises. a horizon of light at the foot of
   the page, the brand core sitting on it, and three orbits carrying
   traders around it, slowly, in opposite directions.
   ===================================================================== */

/**
 * stats.traders counts wallets that signed in (source USER), never the leaderboard addresses
 * we mirror. below this a head count reads as thin rather than social, so the lead
 * invites them in early instead of printing it.
 */
const MIN_HEADCOUNT = 10;

export function Cta({ d }: { d: LandingData }) {
  const n = d.stats.traders;
  return (
    <section id="join" className="lp-cta" aria-labelledby="lp-cta-title">
      <Sky traders={d.traders} />
      <div className="lp-cta-copy lp-container">
        <span data-reveal className="lp-eyebrow lp-eyebrow-center">
          Your move
        </span>
        <h2 id="lp-cta-title" className="lp-h2 lp-cta-title">
          <span data-reveal className="lp-lit" style={vars({ "--d": "0.08s" })}>
            Put your name
          </span>{" "}
          <em data-reveal className="lp-grad not-italic" style={vars({ "--d": "0.2s" })}>
            on the trade.
          </em>
        </h2>
        <p data-reveal className="lp-lead lp-cta-lead" style={vars({ "--d": "0.32s" })}>
          {n >= MIN_HEADCOUNT ? (
            <>
              Join <CountUp to={n} format="int" duration={1800} delay={400} className="lp-cta-count lp-num" /> traders already on socialLiquid.
            </>
          ) : (
            "Make a name before everyone else does."
          )}{" "}
          Your first receipt is one trade away.
        </p>
        <div data-reveal className="lp-cta-ctas" style={vars({ "--d": "0.44s" })}>
          <Link href="/trade" className="lp-btn lp-btn-primary">
            Start trading <Arrow />
          </Link>
          <Link href="/leaderboard" className="lp-btn lp-btn-ghost">
            See the leaderboard
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- geometry ---------- */

/** orbits, inner → outer. radii live in css (they change per breakpoint); here only the look. */
const RINGS = [
  { k: 1, grad: "lp-cta-g1", d: 0.1 },
  { k: 2, grad: "lp-cta-g2", d: 0.32 },
  { k: 3, grad: "lp-cta-g3", d: 0.54 },
] as const;

/**
 * fixed nodes on the rings: [ring, angle (deg, -90 = top), bright, light-up delay].
 * nodes close to the horizon (more than 60deg off the crown) are "low" and step aside on phones,
 * where the fade would leave them as grey specks.
 */
const NODES: [number, number, boolean, number][] = [
  [1, -90, true, 0.9],
  [1, -131, false, 1.6],
  [1, -49, false, 1.6],
  [1, -163, true, 2.2],
  [1, -17, true, 2.2],
  [2, -112, true, 1.5],
  [2, -68, false, 1.5],
  [2, -151, false, 2.1],
  [2, -29, false, 2.1],
  [3, -99, false, 1.6],
  [3, -58, true, 1.9],
  [3, -138, true, 2.2],
  [3, -21, false, 2.5],
  [3, -170, false, 2.7],
];

/**
 * stars in the upper sky, kept clear of the copy column: [x%, y%, size px, delay s, period s, phone].
 * on phones the copy spans the full width, so only the ones marked phone stay.
 */
const STARS: [number, number, number, number, number, boolean][] = [
  [6, 16, 1.5, 0, 7, true],
  [14, 41, 1, 2.2, 9, false],
  [21, 8, 1, 4.1, 8, false],
  [27, 27, 1.5, 1.3, 10, false],
  [9, 63, 1, 3.4, 8.5, true],
  [33, 6, 1, 5.6, 9.5, false],
  [73, 9, 1, 1.7, 8, false],
  [79, 23, 1.5, 0.8, 9, false],
  [87, 44, 1, 2.9, 7.5, false],
  [93, 14, 1.5, 4.6, 10, true],
  [91, 66, 1, 5.2, 9, true],
  [66, 4, 1.5, 3.1, 8.5, false],
  [4, 74, 1, 6.1, 9.5, true],
  [96, 57, 1, 2.4, 8, true],
];

/** dust rising off the horizon: [x offset px, delay s, period s, drift px] */
const MOTES: [number, number, number, number][] = [
  [-250, 0, 10, -12],
  [-160, 3.1, 12, 8],
  [-74, 6.4, 9.5, -6],
  [-22, 1.6, 11, 10],
  [58, 4.2, 10.5, -8],
  [132, 0.9, 12.5, 6],
  [214, 5.5, 9, -10],
  [292, 2.6, 11.5, 12],
];

type Pnl = { t: string; tone: "up" | "down" | "brand" | "amber"; delay: number; still?: boolean };
/**
 * the few satellites that surface a receipt now and then. key = `${ring}-${slot}`.
 * `still` ones stay up when motion is reduced. the orbits then come to rest (cta.css sets the
 * rest angle per breakpoint) with these two clear of the copy, the nav and the top fade.
 */
const PNL: Record<string, Pnl> = {
  "2-0": { t: "+$4.2K", tone: "up", delay: 0, still: true },
  "3-2": { t: "Dumped", tone: "amber", delay: -6 },
  "2-3": { t: "−$310", tone: "down", delay: -11 },
  "2-5": { t: "+$12.8K", tone: "up", delay: -15 },
  "3-6": { t: "Holding", tone: "brand", delay: -3, still: true },
  "3-4": { t: "+$918", tone: "up", delay: -8.5 },
};
/** satellites that wear a live dot */
const LIVE = new Set(["2-2", "3-0", "3-7"]);

/**
 * hues for the illustrative avatars. Disc runs its gradient from h to h+60, so h is kept
 * in 140–184: every disc then lands between mint and periwinkle, never violet.
 */
const HUES = [164, 178, 146, 184, 156, 172, 140, 182, 160, 176, 150, 168, 144, 180, 154, 170];

/**
 * a deterministic, obviously-fake address whose Disc lands on a chosen hue.
 * decorative only: fills the orbits when there are fewer than 16 real traders.
 */
function pseudo(i: number) {
  const head = HUES[i % HUES.length] + 360 * (4100 + i * 1777); // 6 hex digits, ≡ hue (mod 360)
  let s = head.toString(16).padStart(6, "0");
  let x = (Math.imul(i + 1, 2654435761) >>> 0) || 1;
  while (s.length < 40) {
    x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
    s += x.toString(16).padStart(8, "0");
  }
  return `0x${s.slice(0, 40)}`;
}

const PER_RING = 8;

function satellites(traders: LandingData["traders"]) {
  const real = traders.map((t) => t.address).filter((a) => /^0x[0-9a-fA-F]{6,}/.test(a));
  const slots = Array.from({ length: PER_RING * 2 }, (_, i) => {
    const ring = i % 2 === 0 ? 2 : 3;
    const slot = Math.floor(i / 2);
    // ring 2 starts just past 12 o'clock, ring 3 is offset half a step
    const ang = slot * (360 / PER_RING) + (ring === 2 ? -84 : -61.5);
    const key = `${ring}-${slot}`;
    return { i, ring, slot, ang, key, pnl: PNL[key], live: LIVE.has(key) };
  });
  // real traders only ever take the quiet seats: the sample receipts and live dots stay on
  // illustrative avatars, never on someone's actual address (extra traders simply sit out)
  const quiet = slots.filter((s) => !(s.pnl || s.live));
  const addr = new Map(quiet.map((s, j) => [s.key, real[j] ?? pseudo(s.i)]));
  return slots.map((s) => ({ ...s, a: addr.get(s.key) ?? pseudo(s.i) }));
}

/** tiny glyphs for the receipts: an arrow for a result, a beat for a live thesis, a clock for a dump */
function PnlIcon({ tone }: { tone: Pnl["tone"] }) {
  if (tone === "up" || tone === "down") return <TrendArrow up={tone === "up"} size={10} />;
  if (tone === "brand") return <span className="lp-cta-pnl-beat" />;
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

const cos = (deg: number) => Math.cos((deg * Math.PI) / 180).toFixed(4);
const sin = (deg: number) => Math.sin((deg * Math.PI) / 180).toFixed(4);

/* ---------- the stage ---------- */

function Sky({ traders }: { traders: LandingData["traders"] }) {
  const sats = satellites(traders);
  return (
    <div className="lp-cta-sky" data-reveal="fade" aria-hidden>
      <div className="lp-cta-beam" />
      <div className="lp-cta-stars">
        {STARS.map(([x, y, s, delay, t, phone], i) => (
          <span key={i} className={phone ? undefined : "lp-cta-star-wide"} style={vars({ left: `${x}%`, top: `${y}%`, width: s, height: s, "--d": `${delay}s`, "--t": `${t}s` })} />
        ))}
      </div>

      {/* under the orbits: it quiets the atmosphere at the hand-over; the orbits carry their own fade */}
      <div className="lp-cta-haze" />

      <div className="lp-cta-anchor">
        <div className="lp-cta-system">
          <div className="lp-cta-origin">
            {RINGS.map((r) => (
              <svg key={r.k} className={`lp-cta-ring lp-cta-ring-${r.k}`} viewBox="0 0 200 200" style={vars({ "--d": `${r.d}s` })}>
                {r.k === 1 && (
                  <defs>
                    <linearGradient id="lp-cta-g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#c8fff1" stopOpacity="0.62" />
                      <stop offset="0.35" stopColor="#7fe9d2" stopOpacity="0.26" />
                      <stop offset="0.75" stopColor="#4de3c1" stopOpacity="0.06" />
                      <stop offset="1" stopColor="#4de3c1" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="lp-cta-g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#d6eef3" stopOpacity="0.4" />
                      <stop offset="0.4" stopColor="#9fc9d6" stopOpacity="0.16" />
                      <stop offset="0.8" stopColor="#9fc9d6" stopOpacity="0.03" />
                      <stop offset="1" stopColor="#9fc9d6" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="lp-cta-g3" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#c3d3ff" stopOpacity="0.34" />
                      <stop offset="0.4" stopColor="#8eaaff" stopOpacity="0.13" />
                      <stop offset="0.8" stopColor="#6b93ff" stopOpacity="0.02" />
                      <stop offset="1" stopColor="#6b93ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                )}
                {/* two quarter arcs, drawn outward from the top */}
                <path pathLength={1} stroke={`url(#${r.grad})`} d="M100 0 A100 100 0 0 0 0 100" />
                <path pathLength={1} stroke={`url(#${r.grad})`} d="M100 0 A100 100 0 0 1 200 100" />
              </svg>
            ))}

            {NODES.map(([k, a, bright, delay]) => (
              <span
                key={`${k}:${a}`}
                className={`lp-cta-node${bright ? "" : " lp-cta-node-dim"}${k === 1 && a === -90 ? " lp-cta-node-crown" : ""}${Math.abs(a + 90) > 60 ? " lp-cta-node-low" : ""}`}
                style={vars({ "--r": `var(--r${k})`, "--x": cos(a), "--y": sin(a), "--d": `${delay}s` })}
              />
            ))}

            <div className="lp-cta-comet">
              <div className="lp-cta-comet-arm" />
            </div>

            <div className="lp-cta-sats">
              {[2, 3].map((k) => (
                <div key={k} className={`lp-cta-orbit lp-cta-orbit-${k}`}>
                  {sats
                    .filter((s) => s.ring === k)
                    .map((s) => (
                      <span
                        key={s.key}
                        className={`lp-cta-sat ${s.slot % 2 ? "lp-cta-sat-alt" : ""}`}
                        style={vars({ "--x": cos(s.ang), "--y": sin(s.ang) })}
                      >
                        <span className="lp-cta-upright">
                          <span className="lp-cta-bezel">
                            <Disc a={s.a} size={30} className="lp-cta-disc" />
                            {s.live && <span className="lp-live lp-cta-sat-live" style={vars({ "--ping-d": `${-s.slot * 1.3}s` })} />}
                            {s.pnl && (
                              <span className={`lp-pill lp-pill-${s.pnl.tone} lp-num lp-cta-pnl${s.pnl.still ? " lp-cta-pnl-still" : ""}`} style={vars({ "--pd": `${s.pnl.delay}s` })}>
                                <PnlIcon tone={s.pnl.tone} />
                                {s.pnl.t}
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="lp-cta-ceiling" />
      {/* the horizon: rises into place as one piece */}
      <div className="lp-cta-horizon">
        <div className="lp-cta-bloom" />
        {/* the core's pulse rings sit behind the planet, so they rise out of it */}
        <div className="lp-cta-waves">
          <span />
          <span style={vars({ "--d": "-3.5s" })} />
        </div>
        <div className="lp-cta-disk lp-cta-halo" />
        <div className="lp-cta-disk lp-cta-planet" />
        {/* a second, fainter line just inside the rim: the atmosphere seen edge-on */}
        <div className="lp-cta-disk lp-cta-echo" />
        <div className="lp-cta-disk lp-cta-rim" />
        <div className="lp-cta-disk lp-cta-crown-core" />
        <div className="lp-cta-crown" />
      </div>

      <div className="lp-cta-motes">
        {MOTES.map(([x, delay, t, drift], i) => (
          <span key={i} style={vars({ left: `${x}px`, "--d": `${delay}s`, "--t": `${t}s`, "--x": `${drift}px` })} />
        ))}
      </div>

      <div className="lp-cta-core">
        <span className="lp-cta-core-halo" />
        <span className="lp-cta-orb">
          <Mark size={42} id="lp-cta-mark" />
        </span>
      </div>

      <div className="lp-cta-floor" />
      <div className="lp-grain" />
    </div>
  );
}
