"use client";
import "./layout.css";
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { fmtPct } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { CoinIcon, Icon } from "../ui";
import { iconOf } from "@/hooks/use-market";
import { SplitBar, money } from "./layout-bits";

type Candle = { time: number; open: number; close: number };

/** fomo's "About" card, perps flavoured: timeframe changes, longs vs shorts, links (styles: ./layout.css) */
export function AboutCard({ coin, market, mid, longShort, counts }: { coin: string; market?: MarketSummary; mid?: number; longShort?: { longUsd: number; shortUsd: number }; counts?: { longs: number; shorts: number } }) {
  const id = useId();
  const q = useQuery({
    queryKey: ["candles", coin, "5m", "about"],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${encodeURIComponent(coin)}&interval=5m&bars=300`).then((r) => r.candles),
    refetchInterval: 60_000,
  });
  const now = mid ?? market?.markPx;
  // this card re-renders with every tick of the mid: find the candle by scanning back, without copying 300 bars per frame
  const chg = (minutes: number) => {
    const d = q.data;
    if (!d?.length || !now) return null;
    const target = Date.now() / 1000 - minutes * 60;
    let c = d[0];
    for (let i = d.length - 1; i >= 0; i--) {
      if (d[i].time <= target) {
        c = d[i];
        break;
      }
    }
    return c ? (now - c.open) / c.open : null;
  };
  const frames: [string, string, number | null][] = [
    ["5M", "5 minutes", chg(5)],
    ["1H", "1 hour", chg(60)],
    ["4H", "4 hours", chg(240)],
    ["1D", "24 hours", market ? market.change24h : chg(1440)],
  ];
  // not yet known is not "nobody": until the market's first answer the tracked row waits, it does not claim empty
  const known = !!longShort && !!counts;
  const l = longShort?.longUsd ?? 0;
  const s = longShort?.shortUsd ?? 0;
  const tot = l + s;
  const nl = counts?.longs ?? 0;
  const ns = counts?.shorts ?? 0;
  const n = nl + ns;
  const funding = market?.funding ?? 0;
  // spot pairs have no leverage, funding or open interest; builder-dex markets say who deployed them
  const spot = market?.kind === "spot";
  const name = market?.name ?? coin;
  const sym = market?.base ?? coin;
  const sub = !market ? "On Hyperliquid" : spot ? "Spot pair on Hyperliquid" : market.kind === "hip3" ? `${market.category ? `${market.category} perpetual` : "Perpetual"} · ${market.dexName ?? market.dex}` : "Perpetual on Hyperliquid";
  /** a side's colour only when it holds something */
  const tone = (v: number, side: "up" | "down") => (v > 0 ? `tm-lay-${side}` : "tm-lay-zero");
  return (
    <section className="card tm-lay-card tm-lay-about" aria-labelledby={id}>
      <header className="tm-lay-ch">
        <span className="tm-lay-coin" aria-hidden>
          <CoinIcon coin={market ? iconOf(market) : coin} size={30} />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="tm-lay-ch-title">
            About {name}
          </h3>
          <p className="tm-lay-ch-sub">{sub}</p>
        </div>
        {market && (spot ? <span className="tm-lay-ch-end pill pill-neutral">Spot</span> : <span className="tm-lay-ch-end pill pill-brand num" title={`Up to ${market.maxLeverage}x leverage`}>{market.maxLeverage}x</span>)}
      </header>

      <div className="tm-lay-sect">
        <span className="label-caps">Price change</span>
        {/* the chips follow the live price */}
        <span className="label-caps tm-lay-sect-live">
          <i className="tm-lay-live" aria-hidden />
          Live
        </span>
      </div>
      <div className="tm-lay-chgs">
        {frames.map(([label, spoken, v]) => {
          const dir = v === null || v === 0 ? undefined : v > 0 ? "up" : "down";
          return (
            <div key={label} className="tm-lay-chg" data-dir={dir} data-day={label === "1D" || undefined} title={`Change over the last ${spoken}`}>
              <span className="chip-label">{label}</span>
              {v === null && q.isLoading ? <span className="skeleton tm-lay-chg-sk" /> : <b className={dir === "up" ? "tm-lay-up" : dir === "down" ? "tm-lay-down" : "tm-lay-flat"}>{v === null ? "–" : fmtPct(v, 2)}</b>}
            </div>
          );
        })}
      </div>

      <div className="tm-lay-sect">
        <span className="label-caps">Tracked traders</span>
        <span className="label-caps">Open now</span>
      </div>
      {!known ? (
        <div className="tm-lay-tracked" aria-hidden>
          <div className="tm-lay-legs">
            <span className="skeleton tm-lay-legs-sk" />
            <span className="skeleton tm-lay-legs-sk" />
          </div>
          <SplitBar small share={null} label="" />
        </div>
      ) : n === 0 && tot === 0 ? (
        <>
          <SplitBar small share={null} label={`No tracked trader holds ${name} right now`} />
          <p className="tm-lay-none mt-2">No tracked trader holds {name} right now. Their positions show up here the moment they open.</p>
        </>
      ) : (
        <div className="tm-lay-tracked">
          <div className="tm-lay-legs">
            <span>
              <b className={tone(nl, "up")}>{nl}</b> <small>{nl === 1 ? "long" : "longs"} ·</small> <b className={tone(l, "up")}>{money(l)}</b>
            </span>
            <span>
              <b className={tone(s, "down")}>{money(s)}</b> <small>·</small> <b className={tone(ns, "down")}>{ns}</b> <small>{ns === 1 ? "short" : "shorts"}</small>
            </span>
          </div>
          <SplitBar small share={tot ? l / tot : n ? nl / n : 0.5} label={`${nl} long ${nl === 1 ? "position" : "positions"} holding ${money(l)}, ${ns} short ${ns === 1 ? "position" : "positions"} holding ${money(s)}`} />
        </div>
      )}

      <dl className="tm-lay-spec">
        <div>
          <dt>24h volume</dt>
          <dd>{market ? money(market.volume24h) : "–"}</dd>
        </div>
        {spot ? (
          <>
            <div>
              <dt>Quote</dt>
              <dd>USDC</dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{market?.token ?? sym}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Open interest</dt>
              <dd>{market ? money(market.openInterestUsd) : "–"}</dd>
            </div>
            <div>
              <dt>Funding / 1h</dt>
              <dd className={!market ? "" : funding > 0 ? "tm-lay-mint" : funding < 0 ? "tm-lay-down" : ""}>{market ? `${(funding * 100).toFixed(4)}%` : "–"}</dd>
            </div>
          </>
        )}
      </dl>

      <div className="tm-lay-acts">
        <a className="tm-lay-act" href={`https://x.com/search?q=%24${encodeURIComponent(sym)}`} target="_blank" rel="noreferrer">
          <Icon.x /> Search ${sym}
        </a>
        <a className="tm-lay-act" href={`${HL_APP_URL_CLIENT}/trade/${encodeURIComponent(spot ? (market?.token ?? coin) : coin)}`} target="_blank" rel="noreferrer">
          Hyperliquid <Icon.external />
        </a>
      </div>
    </section>
  );
}
