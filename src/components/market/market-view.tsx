"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { api } from "@/lib/client";
import type { MarketSummary } from "@/lib/hl-types";
import { fmtUsd } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { useMids } from "@/hooks/use-market";
import { useOpenOrders } from "@/hooks/use-account";
import type { ChartMarker, PriceLine } from "./chart";
import type { MarketPosition, MarketTrade } from "./positions-table";
import { AboutCard } from "./about-card";
import { FlowCard, TradersToFollow } from "./side-cards";
import { MarketHeader } from "./market-header";
import { OrderBook } from "./order-book";
import { Ticket } from "../trade/ticket";
import { BottomPanel } from "../trade/bottom-panel";
import { useFeed } from "../feed/feed-column";
import { Deferred } from "@/hooks/use-in-view";

const Chart = dynamic(() => import("./chart").then((m) => m.Chart), { ssr: false, loading: () => null });

type MarketData = { market: MarketSummary; longShort: { longUsd: number; shortUsd: number; ratio: number }; positions: MarketPosition[]; trades: MarketTrade[]; flow24h?: { longUsd: number; shortUsd: number; count: number }; closes?: number[] };

/** server-rendered price shape shown until the real chart paints; it is the page's largest element on phones */
function ChartPlaceholder({ closes }: { closes?: number[] }) {
  if (!closes || closes.length < 2) return <div className="h-full w-full skeleton rounded-none" />;
  const w = 800;
  const h = 300;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pts = closes.map((v, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(20 + (1 - (v - min) / Math.max(1e-9, max - min)) * (h - 60)).toFixed(1)}`);
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "#22d36b" : "#ff4d4f";
  return (
    <div className="h-full w-full relative bg-panel">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-x-0 top-10 bottom-0 w-full h-[calc(100%-2.5rem)]" aria-hidden>
        <defs><linearGradient id="ph" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={`M${pts.join(" L")} L${w},${h} L0,${h} Z`} fill="url(#ph)" />
        <path d={`M${pts.join(" L")}`} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute left-3 top-12 text-[11px] text-dim">Loading chart…</div>
    </div>
  );
}

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
  const orders = useOpenOrders();
  const markers = useMemo<ChartMarker[]>(() => {
    const out: ChartMarker[] = [];
    for (const e of mine.data ?? []) {
      if (e.type === "LONG" || e.type === "SHORT") out.push({ time: new Date(e.time).getTime(), side: e.type, label: `${e.type === "LONG" ? "Long" : "Short"} ${fmtUsd(Number(e.payload.sizeUsd ?? 0), { compact: true })}`, kind: "mine" });
      if (e.type === "CLOSED" || e.type === "LIQUIDATED") out.push({ time: new Date(e.time).getTime(), side: "CLOSE", label: e.type === "CLOSED" ? "Closed" : "Liquidated", kind: "mine" });
    }
    for (const e of thesisEvents.data ?? []) out.push({ time: new Date(e.time).getTime(), side: (e.payload.side as "LONG" | "SHORT") ?? "LONG", label: e.user?.handle ?? e.user?.displayName ?? e.address.slice(0, 6), kind: "thesis" });
    return out;
  }, [mine.data, thesisEvents.data]);
  const myPos = myBal.data?.positions.find((p) => p.coin === coin && p.szi !== 0);
  const lines = useMemo<PriceLine[]>(() => {
    const out: PriceLine[] = [];
    if (myPos) {
      out.push({ px: myPos.entryPx, color: myPos.szi > 0 ? "#22d36b" : "#ff4d4f", title: `Entry ${myPos.szi > 0 ? "long" : "short"}` });
      if (myPos.liquidationPx) out.push({ px: myPos.liquidationPx, color: "#f5b236", title: "Liq", dashed: true });
    }
    for (const o of orders.data ?? []) if (o.coin === coin) out.push({ px: o.isTrigger ? o.triggerPx : o.limitPx, color: o.side === "B" ? "rgba(34,211,107,0.7)" : "rgba(255,77,79,0.7)", title: `${o.type} ${o.sz}`, dashed: true });
    return out;
  }, [myPos, orders.data, coin]);
  const counts = { longs: (q.data?.positions ?? []).filter((p) => p.side === "LONG").length, shorts: (q.data?.positions ?? []).filter((p) => p.side === "SHORT").length };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_332px] gap-3 pb-3">
      <section className="min-w-0 flex flex-col gap-3">
        <div className="card px-3 py-2">
          <MarketHeader coin={coin} market={m} mid={mid} longShort={q.data?.longShort} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
          <div className="card overflow-hidden h-[420px] lg:h-[460px] xl:h-[52vh] lg:min-h-[400px] relative">
            <div className="absolute inset-0"><ChartPlaceholder closes={initial?.closes} /></div>
            <div className="absolute inset-0"><Chart coin={coin} markers={markers} lastPx={mid} lines={lines} /></div>
          </div>
          <Deferred minHeight={400} className="h-[400px] lg:h-[460px] xl:h-[52vh] lg:min-h-[400px]">
            <div className="card overflow-hidden h-full">
              <OrderBook coin={coin} market={m} mid={mid} />
            </div>
          </Deferred>
        </div>
        <div className="card overflow-hidden">
          <BottomPanel coin={coin} positions={q.data?.positions} trades={q.data?.trades} theses={thesisEvents.data} mid={mid} loading={q.isLoading && !initial} thesisOnly={thesisOnly} following={following} setThesisOnly={setThesisOnly} setFollowing={setFollowing} />
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <Ticket coin={coin} market={m} mid={mid} />
        <Deferred minHeight={140}>
          <FlowCard coin={coin} flow={q.data?.flow24h} />
        </Deferred>
        <Deferred minHeight={260}>
          <TradersToFollow />
        </Deferred>
        <Deferred minHeight={300}>
          <AboutCard coin={coin} market={m} mid={mid} longShort={q.data?.longShort} counts={counts} />
        </Deferred>
      </aside>
    </div>
  );
}
