"use client";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { fmtPx, fmtUsd } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { Icon, Toggle } from "../ui";
import { DepositBox, useOnboarding } from "./onboarding";

const QUICK = [10, 100, 500, 1000];

type OrderResponse = { order: { status: "filled" | "resting"; avgPx?: number; totalSz?: number; oid?: number }; positionId: string | null; thesis: { id: string } | null };

export function TradePanel({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  return (
    <section className="card p-3">
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-2 gap-1 flex-1 p-1 rounded-[12px] bg-panel-2 border border-line">
          <button className={`h-10 rounded-[9px] text-[15px] font-semibold transition-colors ${side === "LONG" ? "bg-up/15 text-up" : "text-muted hover:text-fg"}`} onClick={() => setSide("LONG")}>Long</button>
          <button className={`h-10 rounded-[9px] text-[15px] font-semibold transition-colors ${side === "SHORT" ? "bg-down/15 text-down" : "text-muted hover:text-fg"}`} onClick={() => setSide("SHORT")}>Short</button>
        </div>
        <span className="btn btn-ghost h-10 w-10 px-0 text-muted" title="settings"><Icon.gear /></span>
      </div>
      <OrderForm coin={coin} market={market} mid={mid} side={side} />
    </section>
  );
}

function OrderForm({ coin, market, mid, side }: { coin: string; market?: MarketSummary; mid?: number; side: "LONG" | "SHORT" }) {
  const { address, signedIn } = useAuth();
  const ob = useOnboarding();
  const [showStep, setShowStep] = useState(false);
  const qc = useQueryClient();
  const bal = useBalance(signedIn ? address : null);
  const [usd, setUsd] = useState("");
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
  const avail = bal.data?.withdrawable ?? 0;
  const tooBig = margin > avail && avail > 0;

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
      if (r.order.status === "filled") setMsg({ ok: true, text: `Filled ${r.order.totalSz} ${coin} at ${fmtPx(r.order.avgPx)}${r.thesis ? " · thesis posted" : ""}` });
      else setMsg({ ok: true, text: `Resting limit order #${r.order.oid}${r.thesis ? " · thesis posted" : ""}` });
      setThesis("");
      setUsd("");
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
      setMsg({ ok: true, text: `Closed ${coin}` });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market", coin] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const ready = ob.stage === "ready";
  const disabled = ready && (busy || usdNum < 10 || (type === "limit" && !Number(limitPx)));
  const onCta = () => {
    if (ready) return submit();
    if (ob.act) return ob.act();
    setShowStep((v) => !v);
  };

  return (
    <div className="mt-3 space-y-3 text-[13px]">
      {/* amount */}
      <div className="card-2 px-4 py-3 flex items-center gap-2">
        <span className={`num text-[28px] font-semibold leading-none ${usdNum ? "text-fg" : "text-dim"}`}>$</span>
        <input
          className="flex-1 min-w-0 bg-transparent outline-none num text-[28px] font-semibold leading-none placeholder:text-dim"
          inputMode="decimal"
          placeholder="0"
          value={usd}
          onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="order size in usd"
        />
        <span className="text-dim text-xs text-right leading-tight shrink-0">
          {usdNum ? <span className="num">≈ {sz.toFixed(market?.szDecimals ?? 4)} {coin}</span> : "Enter amount"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {QUICK.map((qv) => (
          <button key={qv} className={`btn h-9 px-0 num ${usdNum === qv ? "border-brand/60 text-brand bg-brand/10" : ""}`} onClick={() => setUsd(String(qv))}>
            ${qv}
          </button>
        ))}
      </div>

      {/* leverage */}
      <div className="card-2 px-3 py-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Leverage</span>
          <span className="num font-semibold text-fg">{lev}x</span>
        </div>
        <input type="range" min={1} max={maxLev} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="slider mt-2" style={{ ["--pct" as string]: `${((lev - 1) / Math.max(1, maxLev - 1)) * 100}%` }} aria-label="leverage" />
        <div className="flex justify-between text-[10px] text-dim num mt-1">
          {[1, Math.round(maxLev / 4), Math.round(maxLev / 2), Math.round((3 * maxLev) / 4), maxLev].map((v, i) => (
            <button key={i} onClick={() => setLev(v)} className="hover:text-fg">{v}x</button>
          ))}
        </div>
      </div>

      {/* order type + tp/sl */}
      <div className="flex items-center gap-2">
        <span className="seg">
          {(["market", "limit"] as const).map((t) => (
            <button key={t} className={`seg-item capitalize ${type === t ? "seg-active" : ""}`} onClick={() => setType(t)}>{t}</button>
          ))}
        </span>
        <span className="ml-auto"><Toggle on={tpsl} onChange={setTpsl} label="Take profit / Stop loss" /></span>
      </div>
      {type === "limit" && (
        <div className="card-2 flex items-center px-3 h-10">
          <span className="text-muted text-xs mr-2">Limit price</span>
          <input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder={mid ? fmtPx(mid) : ""} />
          <button className="text-brand text-xs ml-2" onClick={() => mid && setLimitPx(String(Number(mid.toPrecision(6))))}>Mid</button>
        </div>
      )}
      {tpsl && (
        <div className="grid grid-cols-2 gap-2">
          <div className="card-2 px-3 py-1.5">
            <div className="text-[11px] text-up">Take profit</div>
            <input className="w-full bg-transparent outline-none num" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="price" />
          </div>
          <div className="card-2 px-3 py-1.5">
            <div className="text-[11px] text-down">Stop loss</div>
            <input className="w-full bg-transparent outline-none num" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="price" />
          </div>
        </div>
      )}

      {/* thesis */}
      <div className="card-2 px-3 py-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-thesis font-medium">Why this trade?</span>
          <span className="num text-dim">{thesis.length}/280</span>
        </div>
        <textarea className="w-full bg-transparent outline-none resize-none h-14 mt-1 text-[13px] placeholder:text-dim leading-snug" maxLength={280} value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="Optional. Goes on the feed bound to this position. Close inside an hour and it's tagged Dumped." />
      </div>

      {/* summary */}
      <dl className="text-xs space-y-1.5 px-1">
        <Row k="Liquidation price" v={liq && usdNum ? fmtPx(liq) : "N/A"} />
        <Row k="Order value" v={usdNum ? fmtUsd(usdNum) : "N/A"} />
        <Row k="Margin required" v={usdNum ? fmtUsd(margin) : "N/A"} warn={tooBig} />
        <Row k="Fees" v={<span><span className="text-brand">◆</span> 0.045% + 0.05% builder{usdNum ? ` · ${fmtUsd(fee)}` : ""}</span>} />
      </dl>

      <button className={`btn w-full h-11 text-[15px] ${ready ? (side === "LONG" ? "btn-up" : "btn-down") : "btn-primary"}`} onClick={onCta} disabled={disabled || ob.busy}>
        {!ready && <Icon.wallet />}
        {ready ? (busy ? "Sending…" : `${side === "LONG" ? "Long" : "Short"} ${coin}${usdNum ? ` · ${fmtUsd(usdNum)}` : ""}`) : ob.cta}
      </button>
      {!ready && <p className="text-[11px] text-dim text-center num">Fee 0.045% taker + 0.05% builder · routes to Hyperliquid</p>}
      {!ready && showStep && ob.Panel && <ob.Panel />}
      {ready && usdNum > 0 && usdNum < 10 && <p className="text-dim text-[11px] text-center">Minimum order is $10</p>}
      {ready && tooBig && <p className="text-warn text-[11px] text-center">Margin exceeds your available {fmtUsd(avail)}. Lower size or raise leverage.</p>}
      {msg && <p className={`text-xs text-center ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}

      {ready && address && <DepositBox address={address} />}

      {myPos && (
        <div className="card-2 px-3 py-2.5 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted">Current position</span>
            <span className={`font-semibold ${myPos.szi > 0 ? "text-up" : "text-down"}`}>{myPos.szi > 0 ? "Long" : "Short"} {Math.abs(myPos.szi)} {coin}</span>
          </div>
          <div className="flex justify-between num"><span className="text-muted">Entry</span><span>{fmtPx(myPos.entryPx)}</span></div>
          <div className="flex justify-between num"><span className="text-muted">Unrealised</span><span className={myPos.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{fmtUsd(myPos.unrealizedPnl, { sign: true })} ({(myPos.returnOnEquity * 100).toFixed(2)}%)</span></div>
          <div className="flex justify-between num"><span className="text-muted">Liq. price</span><span>{myPos.liquidationPx ? fmtPx(myPos.liquidationPx) : "–"}</span></div>
          <button className="btn w-full h-9 mt-1" onClick={close} disabled={busy}>Close position</button>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted underline decoration-dotted decoration-line-2 underline-offset-4">{k}</dt>
      <dd className={`num text-right ${warn ? "text-warn" : "text-fg-2"}`}>{v}</dd>
    </div>
  );
}
