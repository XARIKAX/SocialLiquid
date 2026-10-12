"use client";
import "./layout.css";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { api } from "@/lib/client";
import type { MarketSummary } from "@/lib/hl-types";
import { fmtPx, fmtUsd } from "@/lib/format";
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
import { BookDock, BookFoldButton, PaneSplit, useBookFold, usePaneInit } from "./layout-split";
import { SideDefer, SideMap } from "./layout-side";
import { Ticket } from "../trade/ticket";
import { BottomPanel } from "../trade/bottom-panel";
import { useFeed } from "../feed/feed-column";
import { Deferred } from "@/hooks/use-in-view";

const Chart = dynamic(() => import("./chart").then((m) => m.Chart), { ssr: false, loading: () => null });

type MarketData = { market: MarketSummary; longShort: { longUsd: number; shortUsd: number; ratio: number }; positions: MarketPosition[]; trades: MarketTrade[]; flow24h?: { longUsd: number; shortUsd: number; count: number }; closes?: number[] };

/* ---------- the chart placeholder ---------- */
const PW = 1000;
const PH = 300;

/** a smooth path through points (catmull-rom as cubic beziers), as the landing mock draws its lines */
function smooth(pts: [number, number][]) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.16;
    d += ` C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * server-rendered in the chart's own shape until the real chart paints over it (it is the page's
 * largest element on phones): the toolbar and foot as quiet bands, the last three days of closes as
 * a lit area, the price now as a breathing pin with its level dashed to the axis, a sweep of light.
 */
function ChartPlaceholder({ coin, closes }: { coin: string; closes?: number[] }) {
  const shape = useMemo(() => {
    if (!closes || closes.length < 2) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = Math.max(max - min, Math.abs(max) * 1e-4, 1e-9);
    const pts = closes.map((v, i) => [(i / (closes.length - 1)) * PW, 12 + (1 - (v - min) / span) * (PH - 24)] as [number, number]);
    const line = smooth(pts);
    return { line, area: `${line} L${PW},${PH} L0,${PH} Z`, y: (pts[pts.length - 1][1] / PH) * 100, last: closes[closes.length - 1] };
  }, [closes]);
  return (
    <div className="tm-lay-ph" aria-hidden>
      <div className="tm-lay-ph-bar">
        <i />
        <i />
        <i />
        <i data-on="" />
        <i />
        <i />
        <b />
        <i />
        <i />
      </div>
      <div className="tm-lay-ph-plot">
        <span className="tm-lay-ph-legend">
          <i className="tm-lay-ph-dot" />
          {coin}-USD
          <span>· loading chart</span>
        </span>
        <div className="tm-lay-ph-axis">
          {[20, 40, 60, 80].map((t) => (
            <i key={t} style={{ top: `${t}%` }} />
          ))}
        </div>
        {shape && (
          <div className="tm-lay-ph-line">
            <svg viewBox={`0 0 ${PW} ${PH}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="tm-lay-ph-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" style={{ stopColor: "rgb(var(--tm-lay-mint))", stopOpacity: 0.2 }} />
                  <stop offset="0.7" style={{ stopColor: "rgb(var(--tm-lay-mint))", stopOpacity: 0.04 }} />
                  <stop offset="1" style={{ stopColor: "rgb(var(--tm-lay-mint))", stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="tm-lay-ph-stroke" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" style={{ stopColor: "rgb(var(--tm-lay-mint))", stopOpacity: 0.25 }} />
                  <stop offset="0.6" style={{ stopColor: "rgb(var(--tm-lay-mint))", stopOpacity: 0.75 }} />
                  <stop offset="1" style={{ stopColor: "rgb(var(--tm-lay-mint-2))", stopOpacity: 1 }} />
                </linearGradient>
              </defs>
              <path d={shape.area} fill="url(#tm-lay-ph-fill)" />
              <path d={shape.line} className="tm-lay-ph-stroke" stroke="url(#tm-lay-ph-stroke)" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="tm-lay-ph-level" style={{ top: `${shape.y}%` }} />
            <span className="tm-lay-ph-now" style={{ top: `${shape.y}%` }} />
            <span className="tm-lay-ph-tag" style={{ top: `${shape.y}%` }}>
              {fmtPx(shape.last)}
            </span>
          </div>
        )}
      </div>
      <div className="tm-lay-ph-foot">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="tm-lay-ph-sweep" />
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
  /* while a new filter's first page loads (its key has no data yet) the header and the side cards keep the
     last market data for this coin, instead of flashing empty or falling back to the page-load numbers.
     the panel below still gets the query as it is: its own loading and empty states are its business. */
  const held = useRef<{ coin: string; data: MarketData } | null>(null);
  if (q.data) held.current = { coin, data: q.data };
  const shown = q.data ?? (held.current?.coin === coin ? held.current.data : undefined);
  const m = shown?.market ?? initial?.market;
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
    for (const e of thesisEvents.data ?? []) {
      const entry = Number(e.payload.entryPx);
      out.push({
        time: new Date(e.time).getTime(),
        side: (e.payload.side as "LONG" | "SHORT") ?? "LONG",
        label: e.user?.handle ?? e.user?.displayName ?? e.address.slice(0, 6),
        kind: "thesis",
        // the pin wears the trader's avatar, sits at their entry and shows the thesis on hover
        address: e.address,
        handle: e.user?.handle ?? e.user?.displayName ?? null,
        avatarUrl: e.user?.avatarUrl ?? null,
        px: Number.isFinite(entry) && entry > 0 ? entry : undefined,
        text: e.thesis?.text ?? (typeof e.payload.text === "string" ? e.payload.text : undefined),
      });
    }
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
  const counts = shown ? { longs: shown.positions.filter((p) => p.side === "LONG").length, shorts: shown.positions.filter((p) => p.side === "SHORT").length } : undefined;

  /* layout: remembered pane sizes before paint, the book's fold, the seams, the ticket column and its map */
  usePaneInit();
  const [bookFolded] = useBookFold();
  const deskRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => ["Order ticket", "Position flow", "Traders to follow", `About ${coin}`], [coin]);

  return (
    <div className="tm-lay-cq">
      <div className="tm-lay">
        <div className="tm-lay-col">
          <div className="card px-3 py-2 tm-lay-head">
            <MarketHeader coin={coin} market={m} mid={mid} longShort={shown?.longShort} />
          </div>
          <div className="tm-lay-desk" id="tm-lay-desk" ref={deskRef}>
            <div className="card tm-lay-chart">
              <div className="absolute inset-0">
                <ChartPlaceholder coin={coin} closes={initial?.closes} />
              </div>
              <div className="absolute inset-0">
                <Chart coin={coin} markers={markers} lastPx={mid} lines={lines} />
              </div>
            </div>
            <div className="tm-lay-book" id="tm-lay-book" data-tm-lay-book="">
              {/* folded, the book unmounts (no live book updates for a pane nobody sees) and a dock stands in */}
              {!bookFolded && (
                <Deferred minHeight={0} className="h-full">
                  <div className="card overflow-hidden h-full">
                    <OrderBook coin={coin} market={m} mid={mid} />
                  </div>
                </Deferred>
              )}
              <BookDock controls="tm-lay-book" />
            </div>
            <PaneSplit kind="book" deskRef={deskRef} controls="tm-lay-book" />
            <BookFoldButton controls="tm-lay-book" />
            <PaneSplit kind="row" deskRef={deskRef} controls="tm-lay-desk" />
          </div>
        </div>

        {/* the ticket column. on the desk it is sticky and scrolls on its own (.tm-lay-side-in), with a map in its gutter */}
        <aside className="tm-lay-side" aria-label={`Trade ${coin} and market details`}>
          <div className="tm-lay-side-in" ref={sideRef}>
            <div className="tm-lay-ticket" data-tm-lay-mark="ticket">
              <Ticket coin={coin} market={m} mid={mid} />
            </div>
            <div className="tm-lay-cards">
              <SideDefer scrollRef={sideRef} mark="flow" minHeight={168} idle>
                <FlowCard coin={coin} flow={shown?.flow24h} />
              </SideDefer>
              <SideDefer scrollRef={sideRef} mark="traders" minHeight={312} idle>
                <TradersToFollow />
              </SideDefer>
              <SideDefer scrollRef={sideRef} mark="about" minHeight={364}>
                <AboutCard coin={coin} market={m} mid={mid} longShort={shown?.longShort} counts={counts} />
              </SideDefer>
            </div>
          </div>
          <SideMap scrollRef={sideRef} labels={sections} />
        </aside>

        <div className="card tm-lay-bottom">
          <BottomPanel coin={coin} positions={q.data?.positions} trades={q.data?.trades} theses={thesisEvents.data} mid={mid} loading={q.isLoading && !initial} thesisOnly={thesisOnly} following={following} setThesisOnly={setThesisOnly} setFollowing={setFollowing} />
        </div>
      </div>
    </div>
  );
}
