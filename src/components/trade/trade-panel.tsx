"use client";
import "./ticket.css";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { fmtPx, fmtUsd } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { Icon, Switch } from "../ui";
import { DepositBox, useOnboarding } from "./onboarding";
import { TkIcon } from "./funds";

const QUICK = [10, 100, 500, 1000];

type OrderResponse = { order: { status: "filled" | "resting"; avgPx?: number; totalSz?: number; oid?: number }; positionId: string | null; thesis: { id: string } | null };

export function TradePanel({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  return (
    <section className="card tm-tk" data-tone={side === "LONG" ? "long" : "short"} aria-label={`Trade ${coin}`}>
      <span className="tm-tk-spec" aria-hidden />
      <div className="flex items-center gap-2">
        <div className="tm-tk-side flex-1" role="radiogroup" aria-label="Side" data-side={side}>
          <span className="tm-tk-side-thumb" aria-hidden />
          {(["LONG", "SHORT"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={side === s} data-v={s} className="tm-tk-side-btn" onClick={() => setSide(s)}>
              {s === "LONG" ? "Long" : "Short"}
            </button>
          ))}
        </div>
        <span className="btn btn-ghost h-10 w-10 px-0 text-muted" title="settings">
          <Icon.gear />
        </span>
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
  const uid = useId();
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
  const levTicks = [1, Math.round(maxLev / 4), Math.round(maxLev / 2), Math.round((3 * maxLev) / 4), maxLev].filter((v, i, a) => a.indexOf(v) === i);
  const levAt = (v: number) => (v - 1) / Math.max(1, maxLev - 1);

  return (
    <>
      {/* amount */}
      <label className="tm-tk-size block" htmlFor={`${uid}-usd`}>
        <span className="tm-tk-size-head">
          <span className="tm-tk-size-label">Size</span>
          {signedIn && <span className="tm-tk-ref">Avail <b>{fmtUsd(avail).replace("$", "")}</b></span>}
        </span>
        <span className="tm-tk-size-main">
          <span className="tm-tk-size-cur" data-on={!!usdNum} aria-hidden>
            $
          </span>
          <input id={`${uid}-usd`} className="tm-tk-size-input" inputMode="decimal" placeholder="0" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="order size in usd" autoComplete="off" />
          <span className="tm-tk-unit" aria-hidden>
            USDC
          </span>
        </span>
        <span className="tm-tk-size-sub block">{usdNum ? `≈ ${sz.toFixed(market?.szDecimals ?? 4)} ${coin}` : "Enter amount"}</span>
      </label>
      <div className="tm-tk-quick">
        {QUICK.map((qv) => (
          <button key={qv} type="button" className="tm-tk-chip" aria-pressed={usdNum === qv} onClick={() => setUsd(String(qv))}>
            {qv >= 1000 ? `$${qv / 1000}K` : `$${qv}`}
          </button>
        ))}
      </div>

      {/* leverage */}
      <div className="tm-tk-field">
        <div className="tm-tk-field-head">
          <label htmlFor={`${uid}-lev`}>Leverage</label>
          <span className="tm-tk-levval">{lev}x</span>
        </div>
        <input id={`${uid}-lev`} type="range" min={1} max={maxLev} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="slider" style={{ ["--pct" as string]: `${levAt(lev) * 100}%` }} aria-label="leverage" />
        <div className="tm-tk-ticks">
          {levTicks.map((v) => (
            <button key={v} type="button" onClick={() => setLev(v)} style={{ "--at": levAt(v) } as CSSProperties} data-on={lev === v} data-past={v > 1 && lev > v}>
              {v}x
            </button>
          ))}
        </div>
      </div>

      {/* order type + tp/sl */}
      <div className="flex items-center gap-3">
        <span className="seg">
          {(["market", "limit"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} className={`seg-item capitalize ${type === t ? "seg-active" : ""}`} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </span>
        <Switch on={tpsl} onChange={setTpsl} label="TP / SL" className="tm-tk-sw ml-auto" />
      </div>
      {type === "limit" && (
        <label className="tm-tk-row">
          <span className="tm-tk-row-label">Limit price</span>
          <input className="tm-tk-input" inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder={mid ? fmtPx(mid) : ""} autoComplete="off" />
          <button type="button" className="tm-tk-act" onClick={() => mid && setLimitPx(String(Number(mid.toPrecision(6))))} disabled={!mid}>
            Mid
          </button>
        </label>
      )}
      {tpsl && (
        <div className="tm-tk-grid2">
          <label className="tm-tk-mini" data-tone="up">
            <span className="tm-tk-mini-label">Take profit</span>
            <input className="tm-tk-input" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="Price" autoComplete="off" />
          </label>
          <label className="tm-tk-mini" data-tone="down">
            <span className="tm-tk-mini-label">Stop loss</span>
            <input className="tm-tk-input" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="Price" autoComplete="off" />
          </label>
        </div>
      )}

      {/* thesis */}
      <label className="tm-tk-why block" htmlFor={`${uid}-why`}>
        <span className="tm-tk-why-head">
          <TkIcon.pen size={13} sw={2} />
          Why this trade?
          <span className="tm-tk-why-count">{thesis.length}/280</span>
        </span>
        <textarea id={`${uid}-why`} className="tm-tk-why-input" maxLength={280} rows={2} value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="Optional. Goes on the feed bound to this position. Close inside an hour and it's tagged Dumped." />
      </label>

      {/* summary */}
      <dl className="tm-tk-sum">
        <Row k="Order value" v={usdNum ? fmtUsd(usdNum) : null} />
        <Row k="Margin required" v={usdNum ? fmtUsd(margin) : null} warn={tooBig} />
        <Row k="Liq. price" v={liq && usdNum ? `≈ ${fmtPx(liq)}` : null} />
        <Row
          k="Fees"
          v={
            <>
              0.045% + <span className="tm-tk-builder">0.05% builder</span>
              {usdNum ? <span className="tm-tk-dim"> · {fmtUsd(fee)}</span> : null}
            </>
          }
        />
      </dl>

      <button type="button" className={`btn tm-tk-cta ${ready ? (side === "LONG" ? "btn-up" : "btn-down") : "btn-primary"} ${disabled || ob.busy ? "" : "btn-glow"}`} onClick={onCta} disabled={disabled || ob.busy}>
        {!ready && <Icon.wallet />}
        {ready ? (busy ? "Sending…" : `${side === "LONG" ? "Long" : "Short"} ${coin}${usdNum ? ` · ${fmtUsd(usdNum)}` : ""}`) : ob.cta}
      </button>
      {!ready && (
        <p className="tm-tk-note">
          <TkIcon.lock size={11} sw={2} />
          Non-custodial · routes to Hyperliquid
        </p>
      )}
      {ready && (
        <p className="tm-tk-note">
          <TkIcon.lock size={11} sw={2} />
          Signed by your agent wallet
        </p>
      )}
      {!ready && showStep && ob.Panel && <ob.Panel />}
      {ready && usdNum > 0 && usdNum < 10 && (
        <p className="tm-tk-msg" data-tone="warn">
          <TkIcon.alert size={13} />
          <span>Minimum order is $10</span>
        </p>
      )}
      {ready && tooBig && (
        <p className="tm-tk-msg" data-tone="warn">
          <TkIcon.alert size={13} />
          <span>Margin exceeds your available {fmtUsd(avail)}. Lower size or raise leverage.</span>
        </p>
      )}
      {msg && (
        <p className="tm-tk-msg" data-tone={msg.ok ? "ok" : "err"} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <TkIcon.check size={13} sw={2.2} /> : <TkIcon.alert size={13} />}
          <span>{msg.text}</span>
        </p>
      )}

      {ready && address && <DepositBox address={address} />}

      {myPos && (
        <div className="tm-tk-box">
          <div className="flex justify-between">
            <span>Current position</span>
            <span className={`font-semibold ${myPos.szi > 0 ? "tm-tk-up" : "tm-tk-down"}`}>
              {myPos.szi > 0 ? "Long" : "Short"} {Math.abs(myPos.szi)} {coin}
            </span>
          </div>
          <div className="flex justify-between num">
            <span>Entry</span>
            <span className="text-fg-2">{fmtPx(myPos.entryPx)}</span>
          </div>
          <div className="flex justify-between num">
            <span>Unrealised</span>
            <span className={myPos.unrealizedPnl >= 0 ? "tm-tk-up" : "tm-tk-down"}>
              {fmtUsd(myPos.unrealizedPnl, { sign: true })} ({(myPos.returnOnEquity * 100).toFixed(2)}%)
            </span>
          </div>
          <div className="flex justify-between num">
            <span>Liq. price</span>
            <span className="text-fg-2">{myPos.liquidationPx ? fmtPx(myPos.liquidationPx) : "–"}</span>
          </div>
          <button type="button" className="btn w-full h-9 mt-1" onClick={close} disabled={busy}>
            Close position
          </button>
        </div>
      )}
    </>
  );
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  const empty = v === null || v === undefined;
  return (
    <div>
      <dt>{k}</dt>
      <dd data-empty={empty} data-tone={warn ? "warn" : undefined}>
        {empty ? "–" : v}
      </dd>
    </div>
  );
}
