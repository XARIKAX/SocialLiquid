"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { fmtPx } from "@/lib/format";
import { pushTicketPrice } from "@/hooks/use-account";
import type { MarketSummary } from "@/lib/hl-types";

type Level = { px: number; sz: number; n: number };
type Book = { bids: Level[]; asks: Level[]; time: number };
type Trade = { px: number; sz: number; side: "B" | "A"; time: number; tid: number };

const ROWS = 11;

export function OrderBook({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const sym = market?.base ?? coin;
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [unit, setUnit] = useState<"coin" | "usd">("coin");
  const [group, setGroup] = useState(0); // index into tick options
  const book = useQuery({ queryKey: ["book", coin], queryFn: () => api<Book>(`/api/book?coin=${coin}`), refetchInterval: 1500, enabled: tab === "book" });
  const trades = useQuery({ queryKey: ["recent-trades", coin], queryFn: () => api<{ trades: Trade[] }>(`/api/trades?coin=${coin}`).then((r) => r.trades), refetchInterval: 2000, enabled: tab === "trades" });
  const szDec = market?.szDecimals ?? 3;
  const base = mid ?? market?.markPx ?? 0;
  const ticks = useMemo(() => {
    const raw = Math.pow(10, Math.floor(Math.log10(Math.max(base, 1e-9))) - 4);
    const t0 = base > 1 ? Math.min(raw, 1) : raw;
    return [t0, t0 * 2, t0 * 5, t0 * 10, t0 * 20, t0 * 50, t0 * 100].map((x) => Number(x.toPrecision(2)));
  }, [base]);
  const tick = ticks[Math.min(group, ticks.length - 1)];

  const grouped = useMemo(() => {
    if (!book.data) return null;
    const agg = (levels: Level[], side: "bid" | "ask") => {
      const m = new Map<number, Level>();
      for (const l of levels) {
        const k = side === "bid" ? Math.floor(l.px / tick) * tick : Math.ceil(l.px / tick) * tick;
        const key = Number(k.toPrecision(10));
        const cur = m.get(key) ?? { px: key, sz: 0, n: 0 };
        cur.sz += l.sz;
        cur.n += l.n;
        m.set(key, cur);
      }
      const arr = [...m.values()].sort((a, b) => (side === "bid" ? b.px - a.px : a.px - b.px)).slice(0, ROWS);
      let total = 0;
      return arr.map((l) => ({ ...l, total: (total += l.sz) }));
    };
    const bids = agg(book.data.bids, "bid");
    const asks = agg(book.data.asks, "ask");
    const max = Math.max(bids.at(-1)?.total ?? 0, asks.at(-1)?.total ?? 0, 1e-9);
    const bestBid = book.data.bids[0]?.px ?? 0;
    const bestAsk = book.data.asks[0]?.px ?? 0;
    return { bids, asks, max, spread: bestAsk - bestBid, spreadPct: bestBid ? (bestAsk - bestBid) / bestBid : 0 };
  }, [book.data, tick]);

  const val = (sz: number, px: number) => (unit === "coin" ? sz.toFixed(szDec) : Math.round(sz * px).toLocaleString("en-US"));

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      <div className="flex items-center h-10 border-b border-line px-1">
        <button className={`tab h-8 px-3 ${tab === "book" ? "tab-active" : ""}`} onClick={() => setTab("book")}>Order Book</button>
        <button className={`tab h-8 px-3 ${tab === "trades" ? "tab-active" : ""}`} onClick={() => setTab("trades")}>Trades</button>
      </div>
      {tab === "book" && (
        <>
          <div className="flex items-center justify-between px-2 h-8 text-[11px]">
            <select className="bg-transparent text-fg-2 outline-none num cursor-pointer" value={group} onChange={(e) => setGroup(Number(e.target.value))} aria-label="tick size">
              {ticks.map((t, i) => (
                <option key={i} value={i}>{t}</option>
              ))}
            </select>
            <select className="bg-transparent text-fg-2 outline-none cursor-pointer" value={unit} onChange={(e) => setUnit(e.target.value as "coin" | "usd")} aria-label="size unit">
              <option value="coin">{sym}</option>
              <option value="usd">USD</option>
            </select>
          </div>
          <div className="grid grid-cols-3 px-2 text-[11px] text-dim h-6 items-center">
            <span>Price</span><span className="text-right">Size ({unit === "coin" ? sym : "USD"})</span><span className="text-right">Total</span>
          </div>
          <div className="flex-1 flex flex-col justify-end text-[12px] num">
            {!grouped && <div className="flex-1 skeleton m-2" />}
            {grouped && [...grouped.asks].reverse().map((l) => (
              <button key={`a${l.px}`} className="relative grid grid-cols-3 px-2 h-[22px] items-center hover:bg-panel-2 text-left" onClick={() => pushTicketPrice(l.px)}>
                <span className="absolute inset-y-0 right-0 bg-down/12" style={{ width: `${(l.total / grouped.max) * 100}%` }} />
                <span className="relative text-down">{fmtPx(l.px)}</span>
                <span className="relative text-right text-fg-2">{val(l.sz, l.px)}</span>
                <span className="relative text-right text-fg-2">{val(l.total, l.px)}</span>
              </button>
            ))}
            {grouped && (
              <div className="grid grid-cols-3 px-2 h-7 items-center bg-panel-2/70 text-[11px] border-y border-line">
                <span className="text-muted">Spread</span>
                <span className="text-right">{fmtPx(grouped.spread)}</span>
                <span className="text-right text-muted">{(grouped.spreadPct * 100).toFixed(3)}%</span>
              </div>
            )}
            {grouped && grouped.bids.map((l) => (
              <button key={`b${l.px}`} className="relative grid grid-cols-3 px-2 h-[22px] items-center hover:bg-panel-2 text-left" onClick={() => pushTicketPrice(l.px)}>
                <span className="absolute inset-y-0 right-0 bg-up/12" style={{ width: `${(l.total / grouped.max) * 100}%` }} />
                <span className="relative text-up">{fmtPx(l.px)}</span>
                <span className="relative text-right text-fg-2">{val(l.sz, l.px)}</span>
                <span className="relative text-right text-fg-2">{val(l.total, l.px)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === "trades" && (
        <>
          <div className="grid grid-cols-3 px-2 text-[11px] text-dim h-7 items-center">
            <span>Price</span><span className="text-right">Size ({sym})</span><span className="text-right">Time</span>
          </div>
          <div className="flex-1 overflow-y-auto text-[12px] num">
            {trades.data?.map((t) => (
              <div key={t.tid} className="grid grid-cols-3 px-2 h-[22px] items-center row-hover">
                <span className={t.side === "B" ? "text-up" : "text-down"}>{fmtPx(t.px)}</span>
                <span className="text-right text-fg-2">{t.sz.toFixed(szDec)}</span>
                <span className="text-right text-dim">{new Date(t.time).toLocaleTimeString("en-US", { hour12: false })}</span>
              </div>
            ))}
            {trades.isLoading && <div className="skeleton m-2 h-40" />}
          </div>
        </>
      )}
    </div>
  );
}
