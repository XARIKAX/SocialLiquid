"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { api } from "@/lib/client";
import type { MarketSummary } from "@/lib/hl-types";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { useMids } from "@/hooks/use-market";
import type { ChartMarker } from "./chart";
import { PositionsTable, type MarketPosition, type MarketTrade } from "./positions-table";
import { AboutCard } from "./about-card";
import { TradePanel } from "../trade/trade-panel";
import { Chip, CoinIcon, Icon, Pnl } from "../ui";
import { useFeed } from "../feed/feed-column";
import { Deferred } from "@/hooks/use-in-view";

const Chart = dynamic(() => import("./chart").then((m) => m.Chart), { ssr: false, loading: () => <div className="h-full w-full skeleton rounded-none" /> });

type MarketData = { market: MarketSummary; longShort: { longUsd: number; shortUsd: number; ratio: number }; positions: MarketPosition[]; trades: MarketTrade[] };

export function MarketView({ coin, initial }: { coin: string; initial?: MarketData }) {
  const [thesisOnly, setThesisOnly] = useState(false);
  const [following, setFollowing] = useState(false);
  const { address, signedIn } = useAuth();
  const mids = useMids();
  const mid = mids.data?.[coin] ? Number(mids.data[coin]) : undefined;
  const q = useQuery({
    queryKey: ["market", coin, thesisOnly, following],
    queryFn: () => api<MarketData>(`/api/market/${coin}?thesis=${thesisOnly ? 1 : 0}&following=${following ? 1 : 0}`),
    refetchInterval: 5000,
    initialData: !thesisOnly && !following ? initial : undefined,
  });
  const m = q.data?.market ?? initial?.market;
  const mine = useFeed({ address: signedIn ? address : undefined, coin, minUsd: 0, thesisOnly: false, following: false }, !!signedIn);
  const thesisEvents = useFeed({ coin, minUsd: 0, thesisOnly: true, following: false });
  const myBal = useBalance(signedIn ? address : null);
  const markers = useMemo<ChartMarker[]>(() => {
    const out: ChartMarker[] = [];
    for (const e of mine.data ?? []) {
      if (e.type === "LONG" || e.type === "SHORT") out.push({ time: new Date(e.time).getTime(), side: e.type, label: `${e.type === "LONG" ? "Long" : "Short"} ${fmtUsd(Number(e.payload.sizeUsd ?? 0), { compact: true })}`, kind: "mine" });
      if (e.type === "CLOSED" || e.type === "LIQUIDATED") out.push({ time: new Date(e.time).getTime(), side: "CLOSE", label: e.type === "CLOSED" ? "Closed" : "Liquidated", kind: "mine" });
    }
    for (const e of thesisEvents.data ?? []) {
      out.push({ time: new Date(e.time).getTime(), side: (e.payload.side as "LONG" | "SHORT") ?? "LONG", label: e.user?.handle ?? e.user?.displayName ?? e.address.slice(0, 6), kind: "thesis" });
    }
    return out;
  }, [mine.data, thesisEvents.data]);
  const myPos = myBal.data?.positions.find((p) => p.coin === coin && p.szi !== 0);
  const counts = { longs: (q.data?.positions ?? []).filter((p) => p.side === "LONG").length, shorts: (q.data?.positions ?? []).filter((p) => p.side === "SHORT").length };
  const up = (m?.change24h ?? 0) >= 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3 pb-3">
      <section className="min-w-0 flex flex-col gap-3">
        {/* header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 mr-2">
            <CoinIcon coin={coin} size={44} />
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight">{coin}</h1>
                <span className="pill pill-neutral num">{coin}-USD</span>
                <span className="pill pill-brand num">{m?.maxLeverage ?? "–"}x</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                <span>Perpetual</span>
                <span className="text-dim">·</span>
                <span>Hyperliquid</span>
                <button className="text-dim hover:text-fg p-1.5 -m-1 rounded-md" title="watchlist" aria-label="add to watchlist"><Icon.star /></button>
                <a className="text-dim hover:text-fg p-1.5 -m-1 rounded-md" href={`https://x.com/search?q=%24${coin}`} target="_blank" rel="noreferrer" title="search on x" aria-label="search on x"><Icon.x /></a>
              </div>
            </div>
          </div>
          <div className="flex items-stretch gap-1.5 overflow-x-auto flex-1 min-w-0">
            <Chip label="Mark"><span className={up ? "text-up" : "text-down"}>{fmtPx(mid ?? m?.markPx)}</span></Chip>
            <Chip label="Oracle" className="hidden 2xl:inline-flex">{fmtPx(m?.oraclePx)}</Chip>
            <Chip label="24H change" tone={up ? "up" : "down"}>{m ? `${up ? "▲" : "▼"} ${fmtPct(Math.abs(m.change24h), 2, false)}` : "–"}</Chip>
            <Chip label="24H volume" className="hidden lg:inline-flex">{m ? fmtUsd(m.volume24h, { compact: true }) : "–"}</Chip>
            <Chip label="Open interest">{m ? fmtUsd(m.openInterestUsd, { compact: true }) : "–"}</Chip>
            <Chip label="Funding / 1h" tone={(m?.funding ?? 0) >= 0 ? "up" : "down"}>{m ? `${(m.funding * 100).toFixed(4)}%` : "–"}</Chip>
            <div className="chip min-w-[130px] hidden lg:inline-flex">
              <span className="chip-label">Long / Short</span>
              <span className="flex items-center gap-1.5 mt-1">
                <span className="num text-xs text-up font-semibold">{q.data ? Math.round(q.data.longShort.ratio * 100) : 50}%</span>
                <span className="flex-1 h-1.5 rounded-full bg-down overflow-hidden"><span className="block h-full bg-up" style={{ width: `${(q.data?.longShort.ratio ?? 0.5) * 100}%` }} /></span>
                <span className="num text-xs text-down font-semibold">{q.data ? Math.round((1 - q.data.longShort.ratio) * 100) : 50}%</span>
              </span>
            </div>
          </div>
        </div>

        {/* chart */}
        <div className="card overflow-hidden h-[420px] xl:h-[48vh] min-h-[360px]">
          <Chart coin={coin} markers={markers} lastPx={mid} />
        </div>

        {/* my position strip */}
        {myPos && (
          <div className="card-2 flex items-center gap-4 px-4 py-2.5 text-[13px]">
            <span className="text-muted">Your position</span>
            <span className={`font-semibold ${myPos.szi > 0 ? "text-up" : "text-down"}`}>{myPos.szi > 0 ? "Long" : "Short"} {Math.abs(myPos.szi)} {coin}</span>
            <span className="num text-fg-2">{fmtUsd(myPos.positionValue)}</span>
            <span className="num text-dim">entry {fmtPx(myPos.entryPx)}</span>
            <Pnl value={myPos.unrealizedPnl} pct={myPos.returnOnEquity} arrow className="ml-auto font-semibold" />
          </div>
        )}

        {/* table */}
        <div className="card overflow-hidden">
          <PositionsTable coin={coin} positions={q.data?.positions} trades={q.data?.trades} theses={thesisEvents.data} mid={mid} loading={q.isLoading && !initial} thesisOnly={thesisOnly} following={following} setThesisOnly={setThesisOnly} setFollowing={setFollowing} />
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <TradePanel coin={coin} market={m} mid={mid} />
        <Deferred minHeight={300}>
          <AboutCard coin={coin} market={m} mid={mid} longShort={q.data?.longShort} counts={counts} />
        </Deferred>
        {signedIn && (
          <Deferred minHeight={120}>
            <YourPositions positions={myBal.data?.positions ?? []} mids={mids.data} />
          </Deferred>
        )}
      </aside>
    </div>
  );
}

function YourPositions({ positions, mids }: { positions: { coin: string; szi: number; positionValue: number; unrealizedPnl: number; returnOnEquity: number; leverage: number }[]; mids?: Record<string, string> }) {
  const open = positions.filter((p) => p.szi !== 0);
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[15px]">Your positions <span className="text-dim font-normal num">{open.length}</span></h3>
        <span className="seg">
          <span className="seg-item seg-active flex items-center gap-1">Open <span className="w-1.5 h-1.5 rounded-full bg-brand" /></span>
          <a className="seg-item" href="/me">Closed</a>
        </span>
      </div>
      {open.length === 0 && <p className="text-xs text-dim mt-3">Nothing open. Your Hyperliquid positions show up here live.</p>}
      <div className="mt-2 divide-y divide-line">
        {open.map((p) => {
          const px = mids?.[p.coin] ? Number(mids[p.coin]) : undefined;
          return (
            <a key={p.coin} href={`/m/${p.coin}`} className="flex items-center gap-2.5 py-2.5 row-hover -mx-2 px-2 rounded-lg">
              <CoinIcon coin={p.coin} size={30} />
              <span className="leading-tight min-w-0">
                <span className="block font-semibold">{p.coin}</span>
                <span className="text-[11px] text-dim num">
                  <span className={p.szi > 0 ? "text-up" : "text-down"}>{p.szi > 0 ? "Long" : "Short"}</span> {Math.abs(p.szi)} {p.coin} · {p.leverage}x{px ? ` · ${fmtPx(px)}` : ""}
                </span>
              </span>
              <span className="ml-auto text-right leading-tight">
                <span className="num font-semibold block">{fmtUsd(p.positionValue)}</span>
                <span className={`num text-[11px] ${p.unrealizedPnl >= 0 ? "text-up" : "text-down"}`}>{p.unrealizedPnl >= 0 ? "▲" : "▼"} {Math.abs(p.returnOnEquity * 100).toFixed(2)}%</span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
