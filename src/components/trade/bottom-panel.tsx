"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { livePnl, useMids } from "@/hooks/use-market";
import { fmtQty, spotRows } from "@/lib/spot";
import { openFunds } from "./funds";
import { openConvert } from "./convert";
import { useAccountFills, useFundingPayments, useOpenOrders, useOrderHistory, useTwaps, type OpenOrder } from "@/hooks/use-account";
import { api } from "@/lib/client";
import { fmtDuration, fmtPx, fmtUsd, timeAgo } from "@/lib/format";
import type { FeedItem } from "@/lib/queries";
import { CoinIcon, Empty, Icon, Toggle } from "../ui";
import { PositionsTable, type MarketPosition, type MarketTrade } from "../market/positions-table";
import { useConnectModal } from "../connect-modal";

type Tab = "traders" | "thesis" | "balances" | "positions" | "orders" | "twap" | "trades" | "funding" | "history";
const TABS: [Tab, string][] = [
  ["traders", "Traders"],
  ["thesis", "Thesis"],
  ["balances", "Balances"],
  ["positions", "Positions"],
  ["orders", "Open Orders"],
  ["twap", "TWAP"],
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
  mid?: number;
  loading: boolean;
  thesisOnly: boolean;
  following: boolean;
  setThesisOnly: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("traders");
  const [onlyCoin, setOnlyCoin] = useState(false);
  const { signedIn } = useAuth();
  const connect = useConnectModal();
  const openOrders = useOpenOrders();
  const own = !["traders", "thesis"].includes(tab);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5 px-2 h-11 border-b border-line overflow-x-auto">
        {TABS.map(([t, l]) => (
          <button key={t} className={`tab h-8 px-2.5 shrink-0 ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {l}
            {t === "orders" && !!openOrders.data?.length && <span className="num text-[10px] text-brand">{openOrders.data.length}</span>}
          </button>
        ))}
        {own && (
          <span className="ml-auto pr-2 shrink-0">
            <Toggle on={onlyCoin} onChange={setOnlyCoin} label={`Only ${props.label ?? props.coin}`} />
          </span>
        )}
      </div>
      {tab === "traders" || tab === "thesis" ? (
        <PositionsTable coin={props.coin} label={props.label} positions={props.positions} trades={props.trades} theses={props.theses} mid={props.mid} loading={props.loading} thesisOnly={props.thesisOnly} following={props.following} setThesisOnly={props.setThesisOnly} setFollowing={props.setFollowing} initialTab={tab === "thesis" ? "thesis" : "positions"} key={tab} />
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
        <OpenOrders coin={props.coin} onlyCoin={onlyCoin} />
      ) : tab === "twap" ? (
        <Twaps coin={props.coin} onlyCoin={onlyCoin} />
      ) : tab === "trades" ? (
        <TradeHistory coin={props.coin} onlyCoin={onlyCoin} />
      ) : tab === "funding" ? (
        <FundingHistory coin={props.coin} onlyCoin={onlyCoin} />
      ) : (
        <OrderHistory coin={props.coin} onlyCoin={onlyCoin} />
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
      <Table head={<><Th>Coin</Th><Th right>Size</Th><Th right>Position Value</Th><Th right>Entry Price</Th><Th right>Mark Price</Th><Th right>PnL (ROE %)</Th><Th right>Liq. Price</Th><Th right>Margin</Th><Th right>TP/SL</Th><Th right>Close</Th></>} empty={!bal.isLoading && list.length === 0}>
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
              <Td right><button className="btn btn-sm" onClick={() => close(p.coin)} disabled={busy === p.coin}>Market</button></Td>
            </tr>
          );
        })}
      </Table>
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
function OpenOrders({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const q = useOpenOrders();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const list = (q.data ?? []).filter((o) => !onlyCoin || o.coin === coin);
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

/* ---------- trade history ---------- */
function TradeHistory({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const q = useAccountFills();
  const list = (q.data ?? []).filter((f) => !onlyCoin || f.coin === coin);
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
function OrderHistory({ coin, onlyCoin }: { coin: string; onlyCoin: boolean }) {
  const q = useOrderHistory();
  const list = (q.data ?? []).filter((o) => !onlyCoin || o.coin === coin);
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
