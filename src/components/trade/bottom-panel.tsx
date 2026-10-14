"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { livePnl, useMarkets, useMids } from "@/hooks/use-market";
import { fmtQty, spotRows } from "@/lib/spot";
import { openFunds } from "./funds";
import { openConvert } from "./convert";
import { clearFinishedChases, stopChase, useChases } from "@/lib/chase";
import { useAccountFills, useFundingPayments, useMyTheses, useOpenOrders, useOrderHistory, useTwaps, type OpenOrder } from "@/hooks/use-account";
import { api } from "@/lib/client";
import { fmtDuration, fmtPx, fmtUsd, timeAgo } from "@/lib/format";
import type { FeedItem } from "@/lib/queries";
import { CoinIcon, Empty, Icon, Toggle } from "../ui";
import { PositionsTable, type MarketHolder, type MarketPosition, type MarketTrade } from "../market/positions-table";
import { useConnectModal } from "../connect-modal";

type Tab = "traders" | "thesis" | "balances" | "positions" | "orders" | "twap" | "chase" | "trades" | "funding" | "history";
const TABS: [Tab, string][] = [
  ["traders", "Traders"],
  ["thesis", "Thesis"],
  ["balances", "Balances"],
  ["positions", "Positions"],
  ["orders", "Open Orders"],
  ["twap", "TWAP"],
  ["chase", "Chase"],
  ["trades", "Trade History"],
  ["funding", "Funding History"],
  ["history", "Order History"],
];

export function BottomPanel(props: {
  coin: string;
  label?: string;
  positions?: MarketPosition[];
  trades?: MarketTrade[];
  theses?: FeedItem[];
  holders?: MarketHolder[];
  token?: string;
  mid?: number;
  loading: boolean;
  thesisOnly: boolean;
  following: boolean;
  setThesisOnly: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("traders");
  const [onlyCoin, setOnlyCoin] = useState(false);
  // hyperliquid's Type / Side / Market filters on the history tabs
  const [filter, setFilter] = useState<RowFilter>({ type: "all", side: "all", market: "all" });
  const { signedIn, address } = useAuth();
  const connect = useConnectModal();
  const openOrders = useOpenOrders();
  const fills = useAccountFills();
  const hist = useOrderHistory();
  const twaps = useTwaps();
  const chases = useChases();
  const myBal = useBalance(signedIn ? address : null);
  const markets = useMarkets();
  const own = !["traders", "thesis"].includes(tab);
  const filterable = tab === "orders" || tab === "trades" || tab === "history";
  const coinsInView = [...new Set((tab === "orders" ? openOrders.data : tab === "trades" ? fills.data : hist.data)?.map((r) => r.coin) ?? [])];
  const counts: Partial<Record<Tab, number>> = {
    balances: myBal.data ? 1 + (myBal.data.spot?.filter((b) => b.total > 0 && b.coin !== "USDC").length ?? 0) : 0,
    positions: myBal.data?.positions.filter((p) => p.szi !== 0).length ?? 0,
    orders: openOrders.data?.length ?? 0,
    twap: twaps.data?.filter((t) => t.status === "activated").length ?? 0,
    chase: chases.filter((c) => c.status === "running").length,
  };
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5 px-2 h-11 border-b border-line overflow-x-auto">
        {TABS.map(([t, l]) => (
          <button key={t} className={`tab h-8 px-2.5 shrink-0 ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {l}
            {!!counts[t] && <span className="num text-[10px] text-brand ml-1">({counts[t]})</span>}
          </button>
        ))}
        {own && (
          <span className="ml-auto pr-2 shrink-0 flex items-center gap-2">
            {filterable && (
              <>
                {tab !== "trades" && (
                  <select className="input h-7 text-[11px] py-0 pr-6" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as RowFilter["type"] })} aria-label="type filter">
                    <option value="all">Type</option>
                    <option value="limit">Limit</option>
                    <option value="market">Market</option>
                    <option value="trigger">Stop / TP</option>
                  </select>
                )}
                <select className="input h-7 text-[11px] py-0 pr-6" value={filter.side} onChange={(e) => setFilter({ ...filter, side: e.target.value as RowFilter["side"] })} aria-label="side filter">
                  <option value="all">Side</option>
                  <option value="B">Buy / Long</option>
                  <option value="A">Sell / Short</option>
                </select>
                <select className="input h-7 text-[11px] py-0 pr-6" value={filter.market} onChange={(e) => { setFilter({ ...filter, market: e.target.value }); if (e.target.value !== "all") setOnlyCoin(false); }} aria-label="market filter">
                  <option value="all">Market</option>
                  {coinsInView.map((c) => <option key={c} value={c}>{markets.data?.find((m) => m.coin === c)?.name ?? c}</option>)}
                </select>
              </>
            )}
            <Toggle on={onlyCoin} onChange={setOnlyCoin} label={`Only ${props.label ?? props.coin}`} />
          </span>
        )}
      </div>
      {tab === "traders" || tab === "thesis" ? (
        <PositionsTable coin={props.coin} label={props.label} positions={props.positions} trades={props.trades} theses={props.theses} holders={props.holders} token={props.token} mid={props.mid} loading={props.loading} thesisOnly={props.thesisOnly} following={props.following} setThesisOnly={props.setThesisOnly} setFollowing={props.setFollowing} initialTab={tab === "thesis" ? "thesis" : "positions"} key={tab} />
      ) : !signedIn ? (
        <div className="py-10 text-center">
          <p className="text-muted text-sm">Connect a wallet to see your {TABS.find(([t]) => t === tab)?.[1].toLowerCase()}.</p>
          <button className="btn btn-primary mt-3" onClick={connect.open}><Icon.wallet /> Connect</button>
        </div>
      ) : tab === "balances" ? (
        <Balances />
      ) : tab === "positions" ? (
        <OwnPositions coin={props.coin} onlyCoin={onlyCoin} />
      ) : tab === "orders" ? (
        <OpenOrders coin={props.coin} onlyCoin={onlyCoin} filter={filter} />
      ) : tab === "twap" ? (
        <Twaps coin={props.coin} onlyCoin={onlyCoin} />
      ) : tab === "chase" ? (
        <Chases coin={props.coin} onlyCoin={onlyCoin} />
      ) : tab === "trades" ? (
        <TradeHistory coin={props.coin} onlyCoin={onlyCoin} filter={filter} />
      ) : tab === "funding" ? (
        <FundingHistory coin={props.coin} onlyCoin={onlyCoin} />
      ) : (
        <OrderHistory coin={props.coin} onlyCoin={onlyCoin} filter={filter} />
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`font-medium px-3 py-2 whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${right ? "text-right" : "text-left"} ${className}`}>{children}</td>;
}
function Table({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px] num min-w-[900px]">
        <thead className="text-[11px] text-dim font-sans"><tr className="border-b border-line">{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <div className="text-xs text-dim px-4 py-6">Nothing yet</div>}
    </div>
  );
}
function csv(rows: Record<string, unknown>[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const body = [keys.join(","), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  a.download = `${name}.csv`;
  a.click();
}
function Export({ rows, name }: { rows: Record<string, unknown>[]; name: string }) {
  return <button className="text-xs text-brand hover:underline px-4 py-2" onClick={() => csv(rows, name)}>Export as CSV</button>;
}

/* ---------- balances ---------- */
function Balances() {
  const { address } = useAuth();
  const bal = useBalance(address);
  const mids = useMids();
  const b = bal.data;
  const upnl = b?.positions.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
  const spot = spotRows(b?.spot, mids.data);
  return (
    <Table head={<><Th>Asset</Th><Th right>Total Balance</Th><Th right>Available Balance</Th><Th right>Margin Used</Th><Th right>Unrealised PnL</Th><Th right>Contract</Th></>}>
      <tr className="border-b border-line/60">
        <Td><span className="flex items-center gap-2 font-sans font-medium"><span className="w-5 h-5 rounded-full bg-[#2775ca] text-white text-[10px] inline-flex items-center justify-center font-bold">$</span>USDC</span></Td>
        <Td right>{b ? fmtUsd(b.accountValue) : "…"}</Td>
        <Td right>{b ? fmtUsd(b.withdrawable) : "…"}</Td>
        <Td right>{b ? fmtUsd(b.marginUsed) : "…"}</Td>
        <Td right className={upnl >= 0 ? "text-up" : "text-down"}>{b ? fmtUsd(upnl, { sign: true }) : "…"}</Td>
        <Td right className="text-muted">Perps</Td>
      </tr>
      {spot.map((r) => (
        <tr key={r.coin} className="border-b border-line/60" data-testid={`spot-row-${r.name}`}>
          <Td><span className="flex items-center gap-2 font-sans font-medium"><CoinIcon coin={r.name} size={20} />{r.name}{r.name !== r.coin && <span className="text-dim font-normal text-[11px]">{r.coin}</span>}</span></Td>
          <Td right><span className="block">{fmtQty(r.total)} {r.name}</span>{r.usd !== null && <span className="block text-[11px] text-dim">≈ {fmtUsd(r.usd)}</span>}</Td>
          <Td right>{fmtQty(r.available)} {r.name}</Td>
          <Td right className="text-dim">—</Td>
          <Td right className="text-dim">—</Td>
          <Td right className="text-muted">
            Spot
            {r.name !== "USDC" && (
              <span className="block text-[11px]">
                <button className="text-brand hover:underline" onClick={() => openConvert(r.coin)}>Sell for USDC</button>
                {" · "}
                <button className="text-brand hover:underline" onClick={() => openFunds("withdraw")}>Withdraw</button>
              </span>
            )}
          </Td>
        </tr>
      ))}
      {b && b.spot && spot.length === 0 && (
        <tr>
          <td className="px-4 py-2 text-dim text-xs" colSpan={6}>No spot balances. Native deposits (SOL, BTC, ETH) land here; USDC deposits land in perps above.</td>
        </tr>
      )}
    </Table>
  );
}

/* ---------- own positions ---------- */
function OwnPositions({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const { address } = useAuth();
  const bal = useBalance(address);
  const mids = useMids();
  const qc = useQueryClient();
  const orders = useOpenOrders();
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ coin: string; tp: string; sl: string } | null>(null);
  // a thesis can be posted on a position that is already open, not only with the order that opened it
  const theses = useMyTheses(!!address);
  const [compose, setCompose] = useState<{ coin: string; text: string; err: string | null } | null>(null);
  const latestThesis = (c: string) => (theses.data ?? []).find((t) => t.coin === c) ?? null;
  const postThesis = async () => {
    if (!compose || !compose.text.trim()) return;
    setBusy(`thesis:${compose.coin}`);
    try {
      await api("/api/thesis", { method: "POST", json: { coin: compose.coin, text: compose.text.trim() } });
      qc.invalidateQueries({ queryKey: ["my-theses"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market"] });
      setCompose(null);
    } catch (e) {
      setCompose({ ...compose, err: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const list = (bal.data?.positions ?? []).filter((p) => p.szi !== 0 && (!onlyCoin || p.coin === coin));
  const close = async (c: string) => {
    setBusy(c);
    try {
      await api("/api/trade/close", { method: "POST", json: { coin: c } });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(null);
    }
  };
  const saveTpsl = async () => {
    if (!edit) return;
    setBusy(edit.coin);
    try {
      await api("/api/trade/tpsl", { method: "POST", json: { coin: edit.coin, tp: Number(edit.tp) || undefined, sl: Number(edit.sl) || undefined } });
      qc.invalidateQueries({ queryKey: ["account"] });
      setEdit(null);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Table head={<><Th>Coin</Th><Th right>Size</Th><Th right>Position Value</Th><Th right>Entry Price</Th><Th right>Mark Price</Th><Th right>PnL (ROE %)</Th><Th right>Liq. Price</Th><Th right>Margin</Th><Th right>TP/SL</Th><Th>Thesis</Th><Th right>Close</Th></>} empty={!bal.isLoading && list.length === 0}>
        {list.map((p) => {
          const mid = mids.data?.[p.coin] ? Number(mids.data[p.coin]) : undefined;
          const pnl = livePnl({ side: p.szi > 0 ? "LONG" : "SHORT", size: Math.abs(p.szi), entryPx: p.entryPx }, mid) ?? p.unrealizedPnl;
          const roe = p.positionValue ? (pnl * p.leverage) / p.positionValue : 0;
          const tpsl = (orders.data ?? []).filter((o) => o.coin === p.coin && o.isTrigger && o.reduceOnly);
          const tp = tpsl.find((o) => o.type.toLowerCase().includes("take"));
          const sl = tpsl.find((o) => o.type.toLowerCase().includes("stop"));
          return (
            <tr key={p.coin} className="border-b border-line/60 row-hover">
              <Td><span className="flex items-center gap-2 font-sans"><CoinIcon coin={p.coin} size={18} /><span className="font-semibold">{p.coin}</span><span className="pill pill-neutral">{p.leverage}x</span></span></Td>
              <Td right className={p.szi > 0 ? "text-up" : "text-down"}>{p.szi} {p.coin}</Td>
              <Td right>{fmtUsd(p.positionValue)}</Td>
              <Td right>{fmtPx(p.entryPx)}</Td>
              <Td right>{fmtPx(mid)}</Td>
              <Td right className={pnl >= 0 ? "text-up" : "text-down"}>{fmtUsd(pnl, { sign: true })} ({(roe * 100).toFixed(2)}%)</Td>
              <Td right>{p.liquidationPx ? fmtPx(p.liquidationPx) : "–"}</Td>
              <Td right>{fmtUsd(p.positionValue / p.leverage)}</Td>
              <Td right>
                <button className="hover:text-fg text-fg-2" onClick={() => setEdit({ coin: p.coin, tp: tp ? String(tp.triggerPx) : "", sl: sl ? String(sl.triggerPx) : "" })}>
                  {tp || sl ? `${tp ? fmtPx(tp.triggerPx) : "–"} / ${sl ? fmtPx(sl.triggerPx) : "–"}` : "– / –"} <span className="text-brand">✎</span>
                </button>
              </Td>
              <Td>
                {(() => {
                  const t = latestThesis(p.coin);
                  return (
                    <span className="flex items-center gap-2 max-w-[20rem]" data-testid={`thesis-cell-${p.coin}`}>
                      {t ? <span className="text-fg-2 font-sans truncate" title={t.text}>{t.text}</span> : <span className="text-dim font-sans">No thesis yet</span>}
                      <button className="text-thesis font-sans font-medium hover:underline whitespace-nowrap" onClick={() => setCompose({ coin: p.coin, text: "", err: null })} data-testid={`thesis-add-${p.coin}`}>{t ? "Add" : "Post thesis"}</button>
                    </span>
                  );
                })()}
              </Td>
              <Td right><button className="btn btn-sm" onClick={() => close(p.coin)} disabled={busy === p.coin}>Market</button></Td>
            </tr>
          );
        })}
      </Table>
      {compose && (
        <div className="m-3 card-2 p-3 text-xs" data-testid="thesis-compose">
          <div className="flex items-center justify-between">
            <span className="font-semibold font-sans"><span className="text-thesis">Thesis</span> on your open {compose.coin} position</span>
            <span className="num text-dim">{compose.text.length}/280</span>
          </div>
          <textarea className="w-full bg-transparent outline-none resize-none h-16 mt-2 text-[13px] placeholder:text-dim leading-snug font-sans" maxLength={280} autoFocus value={compose.text} onChange={(e) => setCompose({ ...compose, text: e.target.value, err: null })} placeholder="Why are you in this trade? Posted to the feed, bound to this position, settled when it closes." aria-label="thesis text" />
          <div className="flex items-center gap-2 mt-2">
            <button className="btn btn-primary btn-sm" onClick={postThesis} disabled={busy === `thesis:${compose.coin}` || !compose.text.trim()} data-testid="thesis-post">{busy === `thesis:${compose.coin}` ? "Posting…" : "Post thesis"}</button>
            <button className="btn btn-sm" onClick={() => setCompose(null)}>Cancel</button>
            {compose.err && <span className="text-down">{compose.err}</span>}
          </div>
        </div>
      )}
      {edit && (
        <div className="m-3 card-2 p-3 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-semibold font-sans">TP/SL for {edit.coin}</span>
          <input className="input w-32 h-8" placeholder="TP price" value={edit.tp} onChange={(e) => setEdit({ ...edit, tp: e.target.value })} />
          <input className="input w-32 h-8" placeholder="SL price" value={edit.sl} onChange={(e) => setEdit({ ...edit, sl: e.target.value })} />
          <button className="btn btn-primary btn-sm" onClick={saveTpsl} disabled={busy === edit.coin || (!edit.tp && !edit.sl)}>Confirm</button>
          <button className="btn btn-sm" onClick={() => setEdit(null)}>Cancel</button>
          <span className="text-dim">Market triggers on the whole position, reduce only.</span>
        </div>
      )}
    </>
  );
}

/* ---------- open orders ---------- */
type RowFilter = { type: "all" | "limit" | "market" | "trigger"; side: "all" | "B" | "A"; market: string };
const typeMatch = (f: RowFilter, o: { type: string; isTrigger?: boolean }) => f.type === "all" || (f.type === "trigger" ? !!o.isTrigger || /stop|take profit/i.test(o.type) : f.type === "market" ? /market/i.test(o.type) && !/stop|take profit/i.test(o.type) : /limit/i.test(o.type) && !/stop|take profit/i.test(o.type));
const rowMatch = (f: RowFilter, r: { coin: string; side: "B" | "A" }) => (f.side === "all" || r.side === f.side) && (f.market === "all" || r.coin === f.market);

function OpenOrders({ coin, onlyCoin, filter }: { coin: string; onlyCoin: boolean; filter: RowFilter }) {
  const q = useOpenOrders();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const list = (q.data ?? []).filter((o) => (!onlyCoin || o.coin === coin) && rowMatch(filter, o) && typeMatch(filter, o));
  const cancel = async (items: OpenOrder[]) => {
    if (!items.length) return;
    setBusy(true);
    try {
      await api("/api/trade/cancel", { method: "POST", json: { cancels: items.map((o) => ({ coin: o.coin, oid: o.oid })) } });
      qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Table head={<><Th>Time</Th><Th>Type</Th><Th>Coin</Th><Th>Direction</Th><Th right>Size</Th><Th right>Original Size</Th><Th right>Order Value</Th><Th right>Price</Th><Th>Reduce Only</Th><Th>Trigger Conditions</Th><Th right><button className="text-brand hover:underline" onClick={() => cancel(list)} disabled={busy || !list.length}>Cancel All</button></Th></>} empty={!q.isLoading && list.length === 0}>
        {list.map((o) => (
          <tr key={o.oid} className="border-b border-line/60 row-hover">
            <Td className="text-dim">{new Date(o.time).toLocaleString("en-US", { hour12: false })}</Td>
            <Td className="font-sans">{o.type}{o.isPositionTpsl ? " (pos)" : ""}</Td>
            <Td><span className="flex items-center gap-1.5 font-sans font-semibold"><CoinIcon coin={o.coin} size={16} />{o.coin}</span></Td>
            <Td className={o.side === "B" ? "text-up" : "text-down"}>{o.side === "B" ? "Long" : "Short"}</Td>
            <Td right>{o.sz} {o.coin}</Td>
            <Td right className="text-muted">{o.origSz} {o.coin}</Td>
            <Td right>{fmtUsd(o.sz * (o.isTrigger && o.type.endsWith("Market") ? o.triggerPx : o.limitPx))}</Td>
            <Td right>{o.isTrigger && o.type.endsWith("Market") ? "Market" : fmtPx(o.limitPx)}</Td>
            <Td className="font-sans">{o.reduceOnly ? "Yes" : "No"}</Td>
            <Td className="font-sans text-fg-2">{o.isTrigger ? o.triggerCondition : "N/A"}</Td>
            <Td right><button className="text-fg-2 hover:text-down" onClick={() => cancel([o])} disabled={busy}>Cancel</button></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/* ---------- twap ---------- */
function Twaps({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const q = useTwaps();
  const qc = useQueryClient();
  const list = (q.data ?? []).filter((t) => !onlyCoin || t.coin === coin);
  const terminate = async (c: string, id: number) => {
    await api("/api/trade/twap-cancel", { method: "POST", json: { coin: c, twapId: id } });
    qc.invalidateQueries({ queryKey: ["account"] });
  };
  return (
    <Table head={<><Th>Coin</Th><Th>Side</Th><Th right>Size</Th><Th right>Executed</Th><Th right>Average Price</Th><Th right>Running Time / Total</Th><Th>Reduce Only</Th><Th>Status</Th><Th right>Terminate</Th></>} empty={!q.isLoading && list.length === 0}>
      {list.map((t, i) => (
        <tr key={`${t.twapId}-${i}`} className="border-b border-line/60 row-hover">
          <Td><span className="flex items-center gap-1.5 font-sans font-semibold"><CoinIcon coin={t.coin} size={16} />{t.coin}</span></Td>
          <Td className={t.side === "B" ? "text-up" : "text-down"}>{t.side === "B" ? "Long" : "Short"}</Td>
          <Td right>{t.sz} {t.coin}</Td>
          <Td right>{t.executedSz} {t.coin} <span className="text-dim">({t.sz ? Math.round((t.executedSz / t.sz) * 100) : 0}%)</span></Td>
          <Td right>{t.executedSz ? fmtPx(t.executedNtl / t.executedSz) : "–"}</Td>
          <Td right>{fmtDuration(Math.min(Date.now() - t.time, t.minutes * 60_000))} / {t.minutes}m</Td>
          <Td className="font-sans">{t.reduceOnly ? "Yes" : "No"}</Td>
          <Td className="font-sans capitalize">{t.status}{t.error ? ` · ${t.error}` : ""}</Td>
          <Td right>{t.status === "activated" && t.twapId !== null ? <button className="text-fg-2 hover:text-down" onClick={() => terminate(t.coin, t.twapId!)}>Terminate</button> : "–"}</Td>
        </tr>
      ))}
    </Table>
  );
}

/* ---------- chase orders ---------- */
function Chases({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const all = useChases();
  const list = all.filter((c) => !onlyCoin || c.coin === coin);
  return (
    <>
      <Table head={<><Th>Coin</Th><Th>Side</Th><Th right>Size</Th><Th right>Remaining</Th><Th right>Resting At</Th><Th right>Re-prices</Th><Th right>Running / Limit</Th><Th>Status</Th><Th right>Stop</Th></>} empty={list.length === 0}>
        {list.map((c) => (
          <tr key={c.id} className="border-b border-line/60 row-hover" data-testid={`chase-${c.id}`}>
            <Td><span className="flex items-center gap-1.5 font-sans font-semibold">{c.label}</span></Td>
            <Td className={c.side === "LONG" ? "text-up" : "text-down"}>{c.side === "LONG" ? "Buy" : "Sell"}</Td>
            <Td right>{c.sz}</Td>
            <Td right>{c.status === "running" ? c.remaining : c.status === "filled" ? 0 : c.remaining}</Td>
            <Td right>{c.px !== null ? fmtPx(c.px) : "–"}</Td>
            <Td right>{c.reprices}</Td>
            <Td right>{fmtDuration(Math.min(Date.now() - c.startedAt, c.maxMs))} / {Math.round(c.maxMs / 60_000)}m</Td>
            <Td className="font-sans capitalize">{c.status}{c.error ? ` · ${c.error}` : ""}</Td>
            <Td right>{c.status === "running" ? <button className="text-fg-2 hover:text-down" onClick={() => stopChase(c.id)}>Stop</button> : "–"}</Td>
          </tr>
        ))}
      </Table>
      {list.some((c) => c.status !== "running") && <button className="text-xs text-dim hover:text-fg px-4 py-2" onClick={clearFinishedChases}>Clear finished</button>}
    </>
  );
}

/* ---------- trade history ---------- */
function TradeHistory({ coin, onlyCoin, filter }: { coin: string; onlyCoin: boolean; filter: RowFilter }) {
  const q = useAccountFills();
  const list = (q.data ?? []).filter((f) => (!onlyCoin || f.coin === coin) && rowMatch(filter, f));
  return (
    <>
      <Table head={<><Th>Time</Th><Th>Coin</Th><Th>Direction</Th><Th right>Price</Th><Th right>Size</Th><Th right>Trade Value</Th><Th right>Fee</Th><Th right>Builder</Th><Th right>Closed PnL</Th></>} empty={!q.isLoading && list.length === 0}>
        {list.map((f) => (
          <tr key={f.tid} className="border-b border-line/60 row-hover">
            <Td className="text-dim">{new Date(f.time).toLocaleString("en-US", { hour12: false })}</Td>
            <Td><span className="flex items-center gap-1.5 font-sans font-semibold"><CoinIcon coin={f.coin} size={16} />{f.coin}</span></Td>
            <Td className={`font-sans ${/long/i.test(f.dir) && !/short >/i.test(f.dir) ? "text-up" : "text-down"}`}>{f.liquidation ? "Liquidation" : f.dir}</Td>
            <Td right>{fmtPx(f.px)}</Td>
            <Td right>{f.sz} {f.coin}</Td>
            <Td right>{fmtUsd(f.px * f.sz)}</Td>
            <Td right className="text-muted">{fmtUsd(f.fee)}</Td>
            <Td right className="text-muted">{fmtUsd(f.builderFee)}</Td>
            <Td right className={f.closedPnl > 0 ? "text-up" : f.closedPnl < 0 ? "text-down" : "text-dim"}>{f.closedPnl ? fmtUsd(f.closedPnl, { sign: true }) : "–"}</Td>
          </tr>
        ))}
      </Table>
      <Export rows={list as unknown as Record<string, unknown>[]} name="trade-history" />
    </>
  );
}

/* ---------- funding history ---------- */
function FundingHistory({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const q = useFundingPayments();
  const list = (q.data ?? []).filter((f) => !onlyCoin || f.coin === coin);
  return (
    <>
      <Table head={<><Th>Time</Th><Th>Coin</Th><Th right>Size</Th><Th>Position Side</Th><Th right>Payment</Th><Th right>Rate</Th></>} empty={!q.isLoading && list.length === 0}>
        {list.map((f, i) => (
          <tr key={i} className="border-b border-line/60 row-hover">
            <Td className="text-dim">{new Date(f.time).toLocaleString("en-US", { hour12: false })}</Td>
            <Td><span className="flex items-center gap-1.5 font-sans font-semibold"><CoinIcon coin={f.coin} size={16} />{f.coin}</span></Td>
            <Td right>{Math.abs(f.szi)} {f.coin}</Td>
            <Td className={`font-sans ${f.szi > 0 ? "text-up" : "text-down"}`}>{f.szi > 0 ? "Long" : "Short"}</Td>
            <Td right className={f.usdc >= 0 ? "text-up" : "text-down"}>{fmtUsd(f.usdc, { sign: true })}</Td>
            <Td right className="text-muted">{(f.rate * 100).toFixed(4)}%</Td>
          </tr>
        ))}
      </Table>
      <Export rows={list as unknown as Record<string, unknown>[]} name="funding-history" />
    </>
  );
}

/* ---------- order history ---------- */
function OrderHistory({ coin, onlyCoin, filter }: { coin: string; onlyCoin: boolean; filter: RowFilter }) {
  const q = useOrderHistory();
  const list = (q.data ?? []).filter((o) => (!onlyCoin || o.coin === coin) && rowMatch(filter, o) && typeMatch(filter, o));
  return (
    <>
      <Table head={<><Th>Time</Th><Th>Type</Th><Th>Coin</Th><Th>Direction</Th><Th right>Size</Th><Th right>Filled Size</Th><Th right>Order Value</Th><Th right>Price</Th><Th>Reduce Only</Th><Th right>Trigger</Th><Th>Status</Th><Th right>Order ID</Th></>} empty={!q.isLoading && list.length === 0}>
        {list.map((o, i) => (
          <tr key={`${o.oid}-${i}`} className="border-b border-line/60 row-hover">
            <Td className="text-dim">{new Date(o.time).toLocaleString("en-US", { hour12: false })}</Td>
            <Td className="font-sans">{o.type}</Td>
            <Td><span className="flex items-center gap-1.5 font-sans font-semibold"><CoinIcon coin={o.coin} size={16} />{o.coin}</span></Td>
            <Td className={o.side === "B" ? "text-up" : "text-down"}>{o.side === "B" ? "Long" : "Short"}</Td>
            <Td right>{o.origSz} {o.coin}</Td>
            <Td right>{Number((o.origSz - o.sz).toFixed(8))} {o.coin}</Td>
            <Td right>{fmtUsd(o.origSz * (o.isTrigger ? o.triggerPx : o.limitPx))}</Td>
            <Td right>{fmtPx(o.limitPx)}</Td>
            <Td className="font-sans">{o.reduceOnly ? "Yes" : "No"}</Td>
            <Td right>{o.isTrigger ? fmtPx(o.triggerPx) : "N/A"}</Td>
            <Td className={`font-sans capitalize ${o.status === "filled" ? "text-up" : o.status === "canceled" || o.status === "open" ? "text-fg-2" : "text-down"}`}>{o.status.replace(/([A-Z])/g, " $1").toLowerCase()}</Td>
            <Td right className="text-dim">{o.oid}</Td>
          </tr>
        ))}
      </Table>
      <Export rows={list as unknown as Record<string, unknown>[]} name="order-history" />
    </>
  );
}

export { timeAgo, Empty };
