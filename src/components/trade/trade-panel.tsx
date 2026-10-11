"use client";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { fmtPx, fmtUsd } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { Pnl } from "../ui";
import { DepositBox, OnboardingGate } from "./onboarding";

const QUICK = [10, 100, 500, 1000];

type OrderResponse = { order: { status: "filled" | "resting"; avgPx?: number; totalSz?: number; oid?: number }; positionId: string | null; thesis: { id: string } | null };

export function TradePanel({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  return (
    <div className="flex flex-col h-full">
      <div className="h-9 flex items-center px-3 border-b border-line text-xs text-muted">
        trade <span className="text-fg font-semibold ml-1">{coin}</span>
        <span className="ml-auto num">{mid ? fmtPx(mid) : "…"}</span>
      </div>
      <OnboardingGate>
        <OrderForm coin={coin} market={market} mid={mid} />
      </OnboardingGate>
    </div>
  );
}

function OrderForm({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const { address } = useAuth();
  const qc = useQueryClient();
  const bal = useBalance(address);
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [usd, setUsd] = useState("100");
  const [lev, setLev] = useState(5);
  const [type, setType] = useState<"market" | "limit">("market");
  const [limitPx, setLimitPx] = useState("");
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [thesis, setThesis] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const maxLev = market?.maxLeverage ?? 50;
  useEffect(() => setLev((l) => Math.min(l, maxLev)), [maxLev]);
  useEffect(() => setMsg(null), [coin]);

  const usdNum = Number(usd) || 0;
  const px = type === "limit" && Number(limitPx) ? Number(limitPx) : mid ?? market?.markPx ?? 0;
  const sz = px ? usdNum / px : 0;
  const margin = lev ? usdNum / lev : 0;
  const liq = useMemo(() => (px && lev ? px * (1 - (side === "LONG" ? 1 : -1) * 0.9 / lev) : null), [px, lev, side]);
  const myPos = bal.data?.positions.find((p) => p.coin === coin && p.szi !== 0);
  const fee = usdNum * 0.00045 + (usdNum * 50) / 100_000;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<OrderResponse>("/api/trade/order", {
        method: "POST",
        json: {
          coin,
          side,
          usd: usdNum,
          leverage: lev,
          type,
          limitPx: type === "limit" ? Number(limitPx) : undefined,
          tp: tpsl && Number(tp) ? Number(tp) : undefined,
          sl: tpsl && Number(sl) ? Number(sl) : undefined,
          thesis: thesis.trim() || undefined,
        },
      });
      if (r.order.status === "filled") setMsg({ ok: true, text: `filled ${r.order.totalSz} ${coin} @ ${fmtPx(r.order.avgPx)}${r.thesis ? " · thesis posted" : ""}` });
      else setMsg({ ok: true, text: `resting limit order #${r.order.oid}${r.thesis ? " · thesis posted" : ""}` });
      setThesis("");
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market", coin] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!myPos) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/trade/close", { method: "POST", json: { coin } });
      setMsg({ ok: true, text: `closed ${coin}` });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market", coin] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col text-xs">
      {address && <DepositBox address={address} />}
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-1 p-0.5 rounded bg-panel-2">
          <button className={`h-8 rounded font-semibold ${side === "LONG" ? "bg-up text-black" : "text-muted hover:text-fg"}`} onClick={() => setSide("LONG")}>long</button>
          <button className={`h-8 rounded font-semibold ${side === "SHORT" ? "bg-down text-white" : "text-muted hover:text-fg"}`} onClick={() => setSide("SHORT")}>short</button>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          {(["market", "limit"] as const).map((t) => (
            <button key={t} className={`px-2 h-6 rounded ${type === t ? "bg-panel-2 text-fg" : "text-muted"}`} onClick={() => setType(t)}>{t}</button>
          ))}
          <button className={`ml-auto px-2 h-6 rounded ${tpsl ? "text-accent" : "text-muted"}`} onClick={() => setTpsl((v) => !v)}>tp / sl</button>
        </div>

        {type === "limit" && (
          <label className="block">
            <span className="text-muted">limit price</span>
            <input className="input num mt-1" inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder={mid ? fmtPx(mid) : ""} />
          </label>
        )}

        <label className="block">
          <span className="text-muted flex justify-between">
            <span>size (usd)</span>
            <span className="num text-dim">≈ {sz ? sz.toFixed(market?.szDecimals ?? 4) : "0"} {coin}</span>
          </span>
          <div className="relative mt-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-dim">$</span>
            <input className="input num pl-5" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          <div className="grid grid-cols-4 gap-1 mt-1">
            {QUICK.map((q) => (
              <button key={q} className={`btn h-6 px-0 text-[11px] ${usdNum === q ? "border-accent/60 text-accent" : ""}`} onClick={() => setUsd(String(q))}>${q}</button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="text-muted flex justify-between">
            <span>leverage</span>
            <span className="num text-fg">{lev}x</span>
          </span>
          <input type="range" min={1} max={maxLev} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="w-full mt-1" />
          <div className="flex justify-between text-[10px] text-dim num"><span>1x</span><span>{maxLev}x</span></div>
        </label>

        {tpsl && (
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="text-up">take profit</span>
              <input className="input num mt-1" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="price" />
            </label>
            <label>
              <span className="text-down">stop loss</span>
              <input className="input num mt-1" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="price" />
            </label>
          </div>
        )}

        <div className="text-[11px] text-muted space-y-0.5 num">
          <div className="flex justify-between"><span>margin</span><span>{fmtUsd(margin)}</span></div>
          <div className="flex justify-between"><span>est. liq price</span><span>{liq ? fmtPx(liq) : "–"}</span></div>
          <div className="flex justify-between"><span>fees (incl. 0.05% builder)</span><span>{fmtUsd(fee)}</span></div>
        </div>

        <label className="block">
          <span className="text-muted flex justify-between">
            <span>why this trade? <span className="text-dim">optional</span></span>
            <span className="num text-dim">{thesis.length}/280</span>
          </span>
          <textarea className="input mt-1 h-16 py-1.5 resize-none" maxLength={280} value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="your thesis goes on the feed, bound to this position. close within 1h and it's tagged dumped." />
        </label>

        <button className={`btn w-full h-9 text-sm ${side === "LONG" ? "btn-up" : "btn-down"}`} onClick={submit} disabled={busy || usdNum < 10 || (type === "limit" && !Number(limitPx))}>
          {busy ? "sending…" : `${side === "LONG" ? "long" : "short"} ${coin} ${usdNum ? fmtUsd(usdNum) : ""}`}
        </button>
        {usdNum > 0 && usdNum < 10 && <p className="text-dim text-[11px]">minimum order is $10</p>}
        {msg && <p className={`text-[11px] ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </div>

      {myPos && (
        <div className="mx-3 mb-3 p-2 rounded card space-y-1">
          <div className="flex justify-between">
            <span className="text-muted">your position</span>
            <span className={myPos.szi > 0 ? "text-up" : "text-down"}>{myPos.szi > 0 ? "long" : "short"} {Math.abs(myPos.szi)} {coin}</span>
          </div>
          <div className="flex justify-between num"><span className="text-muted">entry</span><span>{fmtPx(myPos.entryPx)}</span></div>
          <div className="flex justify-between num"><span className="text-muted">value</span><span>{fmtUsd(myPos.positionValue)}</span></div>
          <div className="flex justify-between num"><span className="text-muted">pnl</span><Pnl value={myPos.unrealizedPnl} pct={myPos.returnOnEquity} /></div>
          <div className="flex justify-between num"><span className="text-muted">liq</span><span>{myPos.liquidationPx ? fmtPx(myPos.liquidationPx) : "–"}</span></div>
          <button className="btn w-full h-7 mt-1" onClick={close} disabled={busy}>close position</button>
        </div>
      )}
    </div>
  );
}
