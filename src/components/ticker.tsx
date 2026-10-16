"use client";
import "./chrome.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { marketIdentity, useMarkets, useMids } from "@/hooks/use-market";
import type { MarketSummary } from "@/lib/hl-types";
import { CoinIcon, Icon } from "./ui";

/* =====================================================================
   the footer tape: the majors with live prices that tint on every tick,
   then as many of the next markets (by 24h volume) as the strip has room
   for, a live bead that turns amber when the stream stalls, the market
   count, and the credits. when even the majors do not fit (narrow
   screens) they drift as a slow marquee that pauses under the pointer.
   styles: ./chrome.css (.tm-chrome-tick*, .tm-chrome-tape*, .tm-chrome-tk*).
   ===================================================================== */

const PINNED = ["BTC", "ETH", "SOL", "HYPE"];
/** the most the strip ever lays out after the majors (the rest of a wide screen is clipped, never wrapped into view) */
const MORE = 14;
/** marquee speed, px per second */
const DRIFT = 30;

/** fixed decimals for the magnitude, so a live price never changes width on a round tick */
function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a > 0 && a < 0.01) return v.toPrecision(3);
  const d = a >= 1000 ? 1 : a >= 1 ? 3 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** a price that tints up or down for a moment whenever it changes (the majors only: a whole strip of tints would be noise) */
function TickPx({ v, flash = true }: { v: number; flash?: boolean }) {
  const prev = useRef(v);
  const [tint, setTint] = useState<{ dir: "up" | "down"; n: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = v;
    if (!flash || v === p) return;
    const dir = v > p ? "up" : "down";
    setTint((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
  }, [v, flash]);
  return (
    <span key={tint?.n ?? 0} className="tm-chrome-tk-px tm-chrome-num" data-dir={tint?.dir}>
      {fmtTick(v)}
    </span>
  );
}

type Item = { coin: string; name: string; base: string; icon: string; href: string; px: number | undefined; chg: number | undefined };

/** the path names a market by its id or its slug, percent-encoded or not */
function isAt(path: string | null, it: Item) {
  if (!path) return false;
  let p = path;
  try {
    p = decodeURIComponent(path);
  } catch {}
  p = p.toLowerCase();
  return p === `/m/${it.coin}`.toLowerCase() || p === decodeURIComponent(it.href).toLowerCase();
}

function Tick({ it, current, hidden, flash }: { it: Item; current: boolean; hidden?: boolean; flash?: boolean }) {
  return (
    <Link href={it.href} className="tm-chrome-tk" aria-current={current ? "page" : undefined} tabIndex={hidden ? -1 : undefined}>
      <CoinIcon coin={it.icon} size={14} className="tm-chrome-coin" />
      <span className="tm-chrome-tk-sym">{it.name}</span>
      {it.px ? <TickPx v={it.px} flash={flash} /> : <span className="skeleton tm-chrome-tk-sk" />}
      {it.chg !== undefined && (
        <span className={`tm-chrome-tk-chg tm-chrome-num ${it.chg >= 0 ? "tm-chrome-up" : "tm-chrome-down"}`}>
          {it.chg >= 0 ? "▲" : "▼"} {Math.abs(it.chg * 100).toFixed(2)}%
        </span>
      )}
    </Link>
  );
}

export function Ticker() {
  const markets = useMarkets();
  const mids = useMids();
  const path = usePathname();
  const tapeRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLDivElement>(null);
  const [drift, setDrift] = useState<number | null>(null);

  // marquee only when one set of the majors does not fit
  useEffect(() => {
    const tape = tapeRef.current;
    const set = setRef.current;
    if (!tape || !set) return;
    const check = () => {
      const need = set.scrollWidth;
      setDrift(need > tape.clientWidth + 1 ? Math.max(16, Math.round(need / DRIFT)) : null);
    };
    const ro = new ResizeObserver(check);
    ro.observe(tape);
    ro.observe(set);
    check();
    return () => ro.disconnect();
  }, []);

  // is the price stream alive? (prices poll every few seconds; amber once they stop arriving.
  // polling pauses in a background tab, so time spent hidden never counts against it)
  const updated = mids.dataUpdatedAt;
  const shownAt = useRef(0);
  const [state, setState] = useState<"connecting" | "live" | "stale">("connecting");
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const since = Math.max(updated, shownAt.current);
      setState(!updated ? "connecting" : Date.now() - since > 15_000 ? "stale" : "live");
    };
    const onVis = () => {
      if (document.visibilityState === "visible") shownAt.current = Date.now();
      check();
    };
    check();
    const iv = window.setInterval(check, 5_000);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [updated]);

  const item = (coin: string, m?: MarketSummary): Item => {
    const mid = mids.data?.[coin];
    return { coin, ...marketIdentity(coin, m), px: mid ? Number(mid) : m?.markPx, chg: m?.change24h };
  };
  const pinned = PINNED.map((coin) => item(coin, markets.data?.find((x) => x.coin === coin)));
  // the next markets by 24h volume fill whatever width is left; what does not fit is clipped, not squeezed
  const more = drift
    ? []
    : (markets.data ?? [])
        .filter((m) => !PINNED.includes(m.coin))
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, MORE)
        .map((m) => item(m.coin, m));

  const renderSet = (copy: boolean) => (
    <div className="tm-chrome-tape-set" ref={copy ? undefined : setRef} aria-hidden={copy || undefined}>
      {pinned.map((it) => (
        <Tick key={it.coin} it={it} current={isAt(path, it)} hidden={copy} />
      ))}
    </div>
  );

  return (
    <footer className="tm-chrome-tick" aria-label="Markets ticker">
      <div ref={tapeRef} className="tm-chrome-tape" data-marquee={drift ? "" : undefined} style={drift ? ({ "--tm-chrome-dur": `${drift}s` } as React.CSSProperties) : undefined}>
        <div className="tm-chrome-tape-track">
          {renderSet(false)}
          {drift && renderSet(true)}
        </div>
        {more.length > 0 && (
          // decorative overflow: the majors stay the keyboard's stops, every market is one search away
          <div className="tm-chrome-tape-more" aria-hidden>
            {more.map((it) => (
              <Tick key={it.coin} it={it} current={isAt(path, it)} hidden flash={false} />
            ))}
          </div>
        )}
      </div>
      <div className="tm-chrome-tick-end">
        <span className="tm-chrome-tick-live" data-state={state} title={state === "live" ? "Prices are streaming" : state === "stale" ? "Prices have not updated for a while" : "Connecting to prices"}>
          <span className="tm-chrome-live" data-off={state !== "live" || undefined} data-state={state} aria-hidden />
          {state === "live" ? "Live" : state === "stale" ? "Delayed" : "Connecting"}
        </span>
        <span className="tm-chrome-tick-sep" aria-hidden />
        <span className="tm-chrome-tick-count tm-chrome-num">
          <b>{markets.data?.length ?? "–"}</b> markets
        </span>
        <span className="tm-chrome-tick-sep" aria-hidden />
        <a href="https://hyperliquid.xyz" target="_blank" rel="noreferrer" className="tm-chrome-tick-link">
          <CoinIcon coin="HYPE" size={13} className="tm-chrome-hl" />
          Built on Hyperliquid
        </a>
        <a href="https://x.com" target="_blank" rel="noreferrer" className="tm-chrome-tick-link" aria-label="socialLiquid on X" title="socialLiquid on X">
          <Icon.x />
        </a>
      </div>
    </footer>
  );
}
