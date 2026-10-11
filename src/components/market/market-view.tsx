"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { MarketSummary } from "@/lib/hl-types";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { useMids } from "@/hooks/use-market";
import { Chart, type ChartMarker } from "./chart";
import { PositionsTable, type MarketPosition } from "./positions-table";
import { TradePanel } from "../trade/trade-panel";
import { Stat } from "../ui";
import { useFeed } from "../feed/feed-column";

type MarketData = { market: MarketSummary; longShort: { longUsd: number; shortUsd: number; ratio: number }; positions: MarketPosition[] };

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
      if (e.type === "LONG" || e.type === "SHORT") out.push({ time: new Date(e.time).getTime(), side: e.type, label: `${e.type.toLowerCase()} ${fmtUsd(Number(e.payload.sizeUsd ?? 0), { compact: true })}`, kind: "mine" });
      if (e.type === "CLOSED" || e.type === "LIQUIDATED") out.push({ time: new Date(e.time).getTime(), side: "CLOSE", label: e.type.toLowerCase(), kind: "mine" });
    }
    for (const e of thesisEvents.data ?? []) {
      out.push({ time: new Date(e.time).getTime(), side: (e.payload.side as "LONG" | "SHORT") ?? "LONG", label: e.user?.handle ?? e.address.slice(0, 6), kind: "thesis" });
    }
    return out;
  }, [mine.data, thesisEvents.data]);
  const myPos = myBal.data?.positions.find((p) => p.coin === coin && p.szi !== 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] min-h-full">
      <section className="min-w-0 flex flex-col border-r border-line">
        <header className="flex items-center gap-5 px-3 h-14 border-b border-line overflow-x-auto">
          <div className="flex items-baseline gap-2 shrink-0">
            <h1 className="text-base font-semibold">{coin}</h1>
            <span className="text-[10px] text-dim">perp · {m?.maxLeverage ?? "–"}x</span>
          </div>
          <Stat label="mark">
            <span className={`text-sm ${(m?.change24h ?? 0) >= 0 ? "text-up" : "text-down"}`}>{fmtPx(mid ?? m?.markPx)}</span>
          </Stat>
          <Stat label="24h"><span className={(m?.change24h ?? 0) >= 0 ? "text-up" : "text-down"}>{m ? fmtPct(m.change24h) : "–"}</span></Stat>
          <Stat label="24h vol" className="hidden sm:flex">{m ? fmtUsd(m.volume24h, { compact: true }) : "–"}</Stat>
          <Stat label="open interest" className="hidden sm:flex">{m ? fmtUsd(m.openInterestUsd, { compact: true }) : "–"}</Stat>
          <Stat label="funding / 1h" className="hidden md:flex"><span className={(m?.funding ?? 0) >= 0 ? "text-up" : "text-down"}>{m ? fmtPct(m.funding, 4) : "–"}</span></Stat>
          <Stat label="long / short" className="hidden md:flex">
            {q.data ? (
              <span className="flex items-center gap-1.5">
                <span className="text-up">{Math.round(q.data.longShort.ratio * 100)}%</span>
                <span className="inline-block w-16 h-1.5 rounded bg-down overflow-hidden"><span className="block h-full bg-up" style={{ width: `${q.data.longShort.ratio * 100}%` }} /></span>
                <span className="text-down">{Math.round((1 - q.data.longShort.ratio) * 100)}%</span>
              </span>
            ) : "–"}
          </Stat>
          {myPos && (
            <Stat label="my position" className="ml-auto shrink-0">
              <span className={myPos.szi > 0 ? "text-up" : "text-down"}>{myPos.szi > 0 ? "long" : "short"} {fmtUsd(myPos.positionValue, { compact: true })}</span>
            </Stat>
          )}
        </header>
        <div className="h-[380px] lg:h-[46vh] border-b border-line">
          <Chart coin={coin} markers={markers} lastPx={mid} />
        </div>
        <PositionsTable positions={q.data?.positions} mid={mid} loading={q.isLoading && !initial} thesisOnly={thesisOnly} following={following} setThesisOnly={setThesisOnly} setFollowing={setFollowing} />
      </section>
      <aside className="border-t lg:border-t-0 border-line bg-panel">
        <TradePanel coin={coin} market={m} mid={mid} />
      </aside>
    </div>
  );
}
