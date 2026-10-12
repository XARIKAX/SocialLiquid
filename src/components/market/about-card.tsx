"use client";
import { useQuery } from "@tanstack/react-query";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { fmtUsd } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { CoinIcon, Icon } from "../ui";

type Candle = { time: number; open: number; close: number };

/** fomo's "About" card, perps flavoured: timeframe changes, longs vs shorts, links */
export function AboutCard({ coin, market, mid, longShort, counts }: { coin: string; market?: MarketSummary; mid?: number; longShort?: { longUsd: number; shortUsd: number }; counts?: { longs: number; shorts: number } }) {
  const q = useQuery({
    queryKey: ["candles", coin, "5m", "about"],
    queryFn: () => api<{ candles: Candle[] }>(`/api/candles?coin=${coin}&interval=5m&bars=300`).then((r) => r.candles),
    refetchInterval: 60_000,
  });
  const now = mid ?? market?.markPx;
  const chg = (minutes: number) => {
    if (!q.data?.length || !now) return null;
    const target = Date.now() / 1000 - minutes * 60;
    const c = [...q.data].reverse().find((x) => x.time <= target) ?? q.data[0];
    return c ? (now - c.open) / c.open : null;
  };
  const frames: [string, number | null][] = [
    ["5M", chg(5)],
    ["1H", chg(60)],
    ["4H", chg(240)],
    ["1D", market ? market.change24h : chg(1440)],
  ];
  const l = longShort?.longUsd ?? 0;
  const s = longShort?.shortUsd ?? 0;
  const tot = l + s;
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2.5">
        <CoinIcon coin={market?.base ?? coin} size={28} />
        <div className="leading-tight">
          <h3 className="font-semibold text-[15px]">About {market?.name ?? coin}</h3>
          <p className="text-xs text-muted">Perpetual on Hyperliquid · up to {market?.maxLeverage ?? "–"}x</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mt-3">
        {frames.map(([label, v]) => (
          <div key={label} className={`card-2 px-2 py-1.5 text-center ${label === "1D" ? "bg-panel-3" : ""}`}>
            <div className="text-[11px] text-muted">{label}</div>
            <div className={`num text-xs font-semibold ${v === null ? "text-dim" : v >= 0 ? "text-up" : "text-down"}`}>{v === null ? "–" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v * 100).toFixed(2)}%`}</div>
          </div>
        ))}
      </div>
      <Bar left={`${fmtUsd(l, { compact: true })} long`} right={`${fmtUsd(s, { compact: true })} short`} ratio={tot ? l / tot : 0.5} />
      <Bar left={`${counts?.longs ?? 0} longs`} right={`${counts?.shorts ?? 0} shorts`} ratio={counts && counts.longs + counts.shorts ? counts.longs / (counts.longs + counts.shorts) : 0.5} />
      <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
        <div className="card-2 px-2.5 py-1.5"><div className="text-dim">24h volume</div><div className="num font-semibold text-xs">{market ? fmtUsd(market.volume24h, { compact: true }) : "–"}</div></div>
        <div className="card-2 px-2.5 py-1.5"><div className="text-dim">Open interest</div><div className="num font-semibold text-xs">{market ? fmtUsd(market.openInterestUsd, { compact: true }) : "–"}</div></div>
        <div className="card-2 px-2.5 py-1.5"><div className="text-dim">Funding / 1h</div><div className={`num font-semibold text-xs ${(market?.funding ?? 0) >= 0 ? "text-up" : "text-down"}`}>{market ? `${(market.funding * 100).toFixed(4)}%` : "–"}</div></div>
      </div>
      <div className="flex gap-2 mt-3">
        <a className="btn btn-sm" href={`https://x.com/search?q=%24${market?.base ?? coin}`} target="_blank" rel="noreferrer"><Icon.x /> Search on X</a>
        <a className="btn btn-sm" href={`${HL_APP_URL_CLIENT}/trade/${encodeURIComponent(market?.kind === "spot" ? (market.token ?? coin) : coin)}`} target="_blank" rel="noreferrer">Hyperliquid <Icon.external /></a>
      </div>
    </section>
  );
}

function Bar({ left, right, ratio }: { left: string; right: string; ratio: number }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs">
        <span className="num"><span className="font-semibold">{left.split(" ")[0]}</span> <span className="text-muted">{left.split(" ").slice(1).join(" ")}</span></span>
        <span className="num"><span className="font-semibold">{right.split(" ")[0]}</span> <span className="text-muted">{right.split(" ").slice(1).join(" ")}</span></span>
      </div>
      <div className="flex gap-1 mt-1.5 h-1.5">
        <span className="rounded-full bg-up" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        <span className="rounded-full bg-down flex-1" />
      </div>
    </div>
  );
}
