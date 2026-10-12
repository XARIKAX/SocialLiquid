"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { TICKET_PRICE_EVENT } from "@/hooks/use-account";
import { api } from "@/lib/client";
import { fmtPx, fmtUsd } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { Icon, Toggle } from "../ui";
import { useOnboarding } from "./onboarding";
import { openFunds } from "./funds";

type OrderType = "market" | "limit" | "stopMarket" | "stopLimit" | "takeProfitMarket" | "takeProfitLimit" | "scale" | "twap";
const PRO: [OrderType, string][] = [
  ["stopMarket", "Stop Market"],
  ["stopLimit", "Stop Limit"],
  ["takeProfitMarket", "Take Profit Market"],
  ["takeProfitLimit", "Take Profit Limit"],
  ["scale", "Scale"],
  ["twap", "TWAP"],
];
const LABEL: Record<OrderType, string> = { market: "Market", limit: "Limit", stopMarket: "Stop Market", stopLimit: "Stop Limit", takeProfitMarket: "TP Market", takeProfitLimit: "TP Limit", scale: "Scale", twap: "TWAP" };
const TAKER = 0.00045;
const MAKER = 0.00015;
const BUILDER = 0.0005;
const MAX_SLIP = 0.03;

type Book = { bids: { px: number; sz: number }[]; asks: { px: number; sz: number }[] };
type OrderResponse = { order: { status: "filled" | "resting" | "twap"; avgPx?: number; totalSz?: number; oid?: number; count?: number; twapId?: number }; thesis: { id: string } | null; copied?: boolean };

export function Ticket({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const { address, signedIn } = useAuth();
  const ob = useOnboarding();
  const ready = ob.stage === "ready";
  const qc = useQueryClient();
  const bal = useBalance(signedIn ? address : null);
  const maxLev = market?.maxLeverage ?? 50;
  const szDec = market?.szDecimals ?? 4;

  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [type, setType] = useState<OrderType>("market");
  const [proOpen, setProOpen] = useState(false);
  const [isCross, setIsCross] = useState(true);
  const [lev, setLev] = useState(10);
  const [levOpen, setLevOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [trigger, setTrigger] = useState("");
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState<"coin" | "usd">("usd");
  const [pct, setPct] = useState(0);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tif, setTif] = useState<"Gtc" | "Ioc" | "Alo">("Gtc");
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [scale, setScale] = useState({ start: "", end: "", count: "5", skew: "1" });
  const [twap, setTwap] = useState({ minutes: "30", randomize: true });
  const [thesis, setThesis] = useState("");
  const [showStep, setShowStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** copy trade: set from /m/[coin]?copy=<positionId>&from=<address>&side=&lev=&name= */
  const [copyOf, setCopyOf] = useState<{ positionId: string; address: string; name: string; side: "LONG" | "SHORT"; lev: number } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("copy");
    const from = q.get("from");
    if (!id || !from) return;
    const sd = q.get("side") === "SHORT" ? "SHORT" : "LONG";
    const lv = Math.max(1, Math.min(maxLev, Number(q.get("lev")) || 10));
    setCopyOf({ positionId: id, address: from, name: q.get("name") ?? from.slice(0, 6), side: sd, lev: lv });
    setSide(sd);
    setLev(lv);
    setType("market");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);
  // once trading is enabled, push the copied leverage to the exchange
  useEffect(() => {
    if (!copyOf || !ready) return;
    api("/api/trade/leverage", { method: "POST", json: { coin, leverage: copyOf.lev, isCross: true } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyOf?.positionId, ready]);
  const clearCopy = () => {
    setCopyOf(null);
    const u = new URL(window.location.href);
    ["copy", "from", "side", "lev", "name"].forEach((k) => u.searchParams.delete(k));
    window.history.replaceState(null, "", u.pathname + (u.search || ""));
  };
  const proRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLev((l) => Math.min(l, maxLev)), [maxLev]);
  useEffect(() => {
    setMsg(null);
    setPrice("");
    setTrigger("");
    setSize("");
    setPct(0);
  }, [coin]);
  useEffect(() => {
    const h = (e: Event) => {
      const px = (e as CustomEvent<number>).detail;
      setPrice(String(Number(px.toPrecision(7))));
      setType((t) => (t === "market" ? "limit" : t));
    };
    window.addEventListener(TICKET_PRICE_EVENT, h);
    return () => window.removeEventListener(TICKET_PRICE_EVENT, h);
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => !proRef.current?.contains(e.target as Node) && setProOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const isLimit = type === "limit" || type === "stopLimit" || type === "takeProfitLimit";
  const isTrig = type.startsWith("stop") || type.startsWith("takeProfit");
  const refPx = isLimit && Number(price) ? Number(price) : type === "scale" && Number(scale.start) && Number(scale.end) ? (Number(scale.start) + Number(scale.end)) / 2 : (mid ?? market?.markPx ?? 0);
  const myPos = bal.data?.positions.find((p) => p.coin === coin && p.szi !== 0);
  const avail = bal.data?.withdrawable ?? 0;
  const maxCoin = reduceOnly ? Math.abs(myPos?.szi ?? 0) : refPx ? (avail * lev) / refPx : 0;
  const sizeCoin = unit === "coin" ? Number(size) || 0 : refPx ? (Number(size) || 0) / refPx : 0;
  const sizeUsd = sizeCoin * refPx;
  const margin = lev ? sizeUsd / lev : 0;
  const dir = side === "LONG" ? 1 : -1;
  const mm = 1 / (2 * maxLev);
  const liq = refPx && lev ? refPx - dir * (refPx * (1 / lev - mm)) / (1 - mm * dir) : null;
  const book = qc.getQueryData<Book>(["book", coin]);
  const slip = useMemo(() => {
    if (!book || !sizeCoin || !(type === "market" || type.endsWith("Market")) || !mid) return 0;
    const levels = side === "LONG" ? book.asks : book.bids;
    let left = sizeCoin;
    let cost = 0;
    for (const l of levels) {
      const take = Math.min(left, l.sz);
      cost += take * l.px;
      left -= take;
      if (left <= 0) break;
    }
    if (left > 0) return MAX_SLIP;
    return Math.abs(cost / sizeCoin - mid) / mid;
  }, [book, sizeCoin, type, side, mid]);
  const feeRate = (type === "market" || type.endsWith("Market") || tif === "Ioc" ? TAKER : MAKER) + BUILDER;
  const tpGain = Number(tp) && refPx ? ((Number(tp) - refPx) / refPx) * dir * lev : null;
  const slLoss = Number(sl) && refPx ? ((Number(sl) - refPx) / refPx) * dir * lev : null;

  const setPctAndSize = (p: number) => {
    setPct(p);
    const c = (maxCoin * p) / 100;
    setSize(unit === "coin" ? String(Number(c.toFixed(szDec))) : String(Math.floor(c * refPx)));
  };
  const onSize = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setSize(clean);
    const c = unit === "coin" ? Number(clean) || 0 : refPx ? (Number(clean) || 0) / refPx : 0;
    setPct(maxCoin ? Math.min(100, Math.round((c / maxCoin) * 100)) : 0);
  };
  const switchUnit = (u: "coin" | "usd") => {
    if (u === unit) return;
    if (sizeCoin) setSize(u === "coin" ? String(Number(sizeCoin.toFixed(szDec))) : String(Math.floor(sizeUsd)));
    setUnit(u);
  };

  const invalid = ready && (() => {
    if (!sizeCoin) return "Enter a size";
    if (sizeUsd < 10 && !reduceOnly) return "Minimum order value is $10";
    if (isLimit && !Number(price)) return "Enter a limit price";
    if (isTrig && !Number(trigger)) return "Enter a trigger price";
    if (type === "scale" && (!Number(scale.start) || !Number(scale.end) || Number(scale.count) < 2)) return "Enter the scale range";
    if (type === "twap" && Number(twap.minutes) < 5) return "TWAP runs for at least 5 minutes";
    if (!reduceOnly && margin > avail && avail > 0) return `Margin ${fmtUsd(margin)} exceeds available ${fmtUsd(avail)}`;
    return null;
  })();

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<OrderResponse>("/api/trade/order", {
        method: "POST",
        json: {
          coin,
          side,
          type,
          sz: Number(sizeCoin.toFixed(szDec)),
          leverage: lev,
          isCross,
          limitPx: isLimit ? Number(price) : undefined,
          triggerPx: isTrig ? Number(trigger) : undefined,
          tif: isLimit ? tif : undefined,
          reduceOnly,
          tp: tpsl && Number(tp) ? Number(tp) : undefined,
          sl: tpsl && Number(sl) ? Number(sl) : undefined,
          scale: type === "scale" ? { startPx: Number(scale.start), endPx: Number(scale.end), count: Number(scale.count), skew: Number(scale.skew) || 1 } : undefined,
          twap: type === "twap" ? { minutes: Number(twap.minutes), randomize: twap.randomize } : undefined,
          thesis: thesis.trim() || undefined,
          copyOf: copyOf ? { positionId: copyOf.positionId, address: copyOf.address } : undefined,
        },
      });
      const o = r.order;
      if (o.status === "filled") setMsg({ ok: true, text: `Filled ${o.totalSz} ${coin} at ${fmtPx(o.avgPx)}${copyOf ? ` · copied ${copyOf.name}` : ""}${r.thesis ? " · thesis posted" : ""}` });
      if (copyOf && o.status === "filled") clearCopy();
      else if (o.status === "twap") setMsg({ ok: true, text: `TWAP #${o.twapId} running for ${twap.minutes} min` });
      else setMsg({ ok: true, text: o.count ? `${o.count} orders resting` : `Order #${o.oid} resting${r.thesis ? " · thesis posted" : ""}` });
      setThesis("");
      setSize("");
      setPct(0);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market", coin] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const applyLeverage = async (l: number, cross: boolean) => {
    setLev(l);
    setIsCross(cross);
    setLevOpen(false);
    if (ready) await api("/api/trade/leverage", { method: "POST", json: { coin, leverage: l, isCross: cross } }).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  };

  const onCta = () => {
    if (ready) return submit();
    if (ob.act) return ob.act();
    setShowStep((v) => !v);
  };

  return (
    <section className="card p-3 text-[13px] space-y-3">
      {/* margin mode + leverage */}
      <div className="grid grid-cols-3 gap-1.5">
        <span className="seg !p-0.5 col-span-2">
          <button className={`seg-item flex-1 h-8 ${isCross ? "seg-active" : ""}`} onClick={() => applyLeverage(lev, true)}>Cross</button>
          <button className={`seg-item flex-1 h-8 ${!isCross ? "seg-active" : ""}`} onClick={() => applyLeverage(lev, false)}>Isolated</button>
        </span>
        <div className="relative">
          <button className="btn w-full h-9 num font-semibold" onClick={() => setLevOpen((v) => !v)}>{lev}x</button>
          {levOpen && (
            <div className="absolute right-0 top-11 z-30 w-72 card p-4 shadow-2xl shadow-black/70">
              <div className="flex items-center justify-between text-xs"><span className="font-semibold">Adjust leverage</span><span className="num text-brand font-semibold">{lev}x</span></div>
              <input type="range" min={1} max={maxLev} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="slider mt-3" style={{ ["--pct" as string]: `${((lev - 1) / Math.max(1, maxLev - 1)) * 100}%` }} aria-label="leverage" />
              <div className="flex justify-between text-[10px] text-dim num mt-1">
                {[1, Math.round(maxLev / 4), Math.round(maxLev / 2), Math.round((3 * maxLev) / 4), maxLev].map((v, i) => (
                  <button key={i} onClick={() => setLev(v)} className="hover:text-fg">{v}x</button>
                ))}
              </div>
              <p className="text-[11px] text-dim mt-3 leading-snug">Max {maxLev}x on {coin}. Higher leverage lowers the margin required and moves the liquidation price closer.</p>
              <button className="btn btn-primary w-full h-9 mt-3" onClick={() => applyLeverage(lev, isCross)}>Confirm</button>
            </div>
          )}
        </div>
      </div>

      {/* order type */}
      <div className="flex items-center border-b border-line">
        {(["market", "limit"] as OrderType[]).map((t) => (
          <button key={t} className={`h-9 px-3 text-[13px] font-medium border-b-2 -mb-px ${type === t ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`} onClick={() => setType(t)}>{LABEL[t]}</button>
        ))}
        <div ref={proRef} className="relative">
          <button className={`h-9 px-3 text-[13px] font-medium border-b-2 -mb-px inline-flex items-center gap-1 ${!["market", "limit"].includes(type) ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`} onClick={() => setProOpen((v) => !v)}>
            {["market", "limit"].includes(type) ? "Pro" : LABEL[type]} <Icon.chevron />
          </button>
          {proOpen && (
            <div className="absolute left-0 top-10 z-30 w-48 card p-1 shadow-2xl shadow-black/70">
              {PRO.map(([t, l]) => (
                <button key={t} className={`w-full text-left px-3 h-9 rounded-lg hover:bg-panel-2 ${type === t ? "text-brand" : ""}`} onClick={() => { setType(t); setProOpen(false); }}>{l}</button>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto text-[11px] text-dim pr-1">{type === "twap" ? "slices every 30s" : type === "scale" ? "ladder of limits" : ""}</span>
      </div>

      {copyOf && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-brand/10 border border-brand/30 text-[12px]">
          <span className="text-brand"><Icon.copy /></span>
          <span className="min-w-0 leading-tight">
            Copying <b className="text-fg">{copyOf.name}</b>
            <span className="block text-[11px] text-muted">{coin} <span className={copyOf.side === "LONG" ? "text-up" : "text-down"}>{copyOf.side === "LONG" ? "Long" : "Short"}</span> <span className="num">{copyOf.lev}x</span> · pick your size</span>
          </span>
          <button className="ml-auto btn btn-ghost h-6 w-6 px-0 text-dim shrink-0" onClick={clearCopy} aria-label="stop copying">✕</button>
        </div>
      )}

      {/* side */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-[12px] bg-panel-2 border border-line">
        <button className={`h-9 rounded-[9px] font-semibold transition-colors ${side === "LONG" ? "bg-up text-black" : "text-muted hover:text-fg"}`} onClick={() => setSide("LONG")}>Buy / Long</button>
        <button className={`h-9 rounded-[9px] font-semibold transition-colors ${side === "SHORT" ? "bg-down text-white" : "text-muted hover:text-fg"}`} onClick={() => setSide("SHORT")}>Sell / Short</button>
      </div>

      <dl className="text-xs space-y-1 px-0.5">
        <Row k="Available to Trade" v={signedIn ? `${fmtUsd(avail)} USDC` : "–"} />
        <Row k="Current Position" v={myPos ? <span className={myPos.szi > 0 ? "text-up" : "text-down"}>{myPos.szi} {coin}</span> : `0.00 ${coin}`} />
      </dl>

      {/* prices */}
      {isTrig && (
        <Field label={type.startsWith("stop") ? "Stop Price (USDC)" : "TP Price (USDC)"}>
          <input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={mid ? fmtPx(mid) : ""} />
          <button className="text-brand text-xs ml-2" onClick={() => mid && setTrigger(String(Number(mid.toPrecision(7))))}>Mark</button>
        </Field>
      )}
      {isLimit && (
        <Field label="Price (USDC)">
          <input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={mid ? fmtPx(mid) : ""} />
          <button className="text-brand text-xs ml-2" onClick={() => mid && setPrice(String(Number(mid.toPrecision(7))))}>Mid</button>
        </Field>
      )}
      {type === "scale" && (
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Start (USDC)"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={scale.start} onChange={(e) => setScale({ ...scale, start: e.target.value })} placeholder={mid ? fmtPx(mid * (side === "LONG" ? 0.99 : 1.01)) : ""} /></Field>
          <Field label="End (USDC)"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={scale.end} onChange={(e) => setScale({ ...scale, end: e.target.value })} placeholder={mid ? fmtPx(mid * (side === "LONG" ? 0.95 : 1.05)) : ""} /></Field>
          <Field label="Orders"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="numeric" value={scale.count} onChange={(e) => setScale({ ...scale, count: e.target.value })} /></Field>
          <Field label="Size skew"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={scale.skew} onChange={(e) => setScale({ ...scale, skew: e.target.value })} /></Field>
        </div>
      )}
      {type === "twap" && (
        <div className="grid grid-cols-2 gap-1.5 items-center">
          <Field label="Running time (min)"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="numeric" value={twap.minutes} onChange={(e) => setTwap({ ...twap, minutes: e.target.value })} /></Field>
          <Toggle on={twap.randomize} onChange={(v) => setTwap({ ...twap, randomize: v })} label="Randomize" />
        </div>
      )}

      {/* size */}
      <Field label="Size">
        <input className="flex-1 bg-transparent outline-none num text-right text-[15px]" inputMode="decimal" value={size} onChange={(e) => onSize(e.target.value)} placeholder="0" aria-label="size" />
        <select className="bg-transparent text-fg-2 outline-none ml-2 text-xs cursor-pointer" value={unit} onChange={(e) => switchUnit(e.target.value as "coin" | "usd")} aria-label="size unit">
          <option value="usd">USD</option>
          <option value="coin">{coin}</option>
        </select>
      </Field>
      <div className="flex items-center gap-3 px-0.5">
        <input type="range" min={0} max={100} step={1} value={pct} onChange={(e) => setPctAndSize(Number(e.target.value))} className="slider flex-1" style={{ ["--pct" as string]: `${pct}%` }} aria-label="size percent" disabled={!signedIn} />
        <span className="card-2 h-8 px-2 inline-flex items-center num text-xs w-16 justify-end">
          <input className="w-8 bg-transparent outline-none text-right" value={pct} onChange={(e) => setPctAndSize(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} aria-label="percent" />%
        </span>
      </div>
      <div className="flex justify-between text-[10px] text-dim num px-0.5 -mt-1.5">
        {[0, 25, 50, 75, 100].map((p) => (
          <button key={p} onClick={() => setPctAndSize(p)} className="hover:text-fg">{p}%</button>
        ))}
      </div>

      {/* flags */}
      <div className="flex items-center justify-between gap-3 px-0.5">
        <Toggle on={reduceOnly} onChange={setReduceOnly} label="Reduce Only" />
        {isLimit && (
          <span className="text-xs flex items-center gap-1.5">
            <span className="text-muted underline decoration-dotted decoration-line-2 underline-offset-4">TIF</span>
            <select className="bg-transparent text-fg outline-none cursor-pointer" value={tif} onChange={(e) => setTif(e.target.value as "Gtc" | "Ioc" | "Alo")} aria-label="time in force">
              <option value="Gtc">GTC</option>
              <option value="Ioc">IOC</option>
              <option value="Alo">ALO</option>
            </select>
          </span>
        )}
      </div>
      {(type === "market" || type === "limit") && (
        <div className="px-0.5">
          <Toggle on={tpsl} onChange={setTpsl} label="Take Profit / Stop Loss" />
          {tpsl && (
            <div className="grid grid-cols-[1fr_auto] gap-1.5 mt-2">
              <Field label="TP Price"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
              <span className={`card-2 h-10 px-2.5 inline-flex items-center num text-xs w-[76px] justify-end ${tpGain === null ? "text-dim" : tpGain >= 0 ? "text-up" : "text-down"}`}>{tpGain === null ? "Gain %" : `${(tpGain * 100).toFixed(1)}%`}</span>
              <Field label="SL Price"><input className="flex-1 bg-transparent outline-none num text-right" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
              <span className={`card-2 h-10 px-2.5 inline-flex items-center num text-xs w-[76px] justify-end ${slLoss === null ? "text-dim" : slLoss >= 0 ? "text-up" : "text-down"}`}>{slLoss === null ? "Loss %" : `${(slLoss * 100).toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}

      {/* thesis */}
      <div className="card-2 px-3 py-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-thesis font-medium">Why this trade?</span>
          <span className="num text-dim">{thesis.length}/280</span>
        </div>
        <textarea className="w-full bg-transparent outline-none resize-none h-12 mt-1 text-[13px] placeholder:text-dim leading-snug" maxLength={280} value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="Optional. Posted to the feed, bound to this position." />
      </div>

      {/* cta */}
      <button className={`btn w-full h-11 text-[15px] ${ready ? (side === "LONG" ? "btn-up" : "btn-down") : "btn-primary"}`} onClick={onCta} disabled={busy || ob.busy || !!invalid}>
        {!ready && <Icon.wallet />}
        {ready ? (busy ? "Placing…" : `${side === "LONG" ? "Buy / Long" : "Sell / Short"} ${coin}`) : ob.cta}
      </button>
      {ready && invalid && sizeCoin > 0 && <p className="text-[11px] text-warn text-center -mt-1">{invalid}</p>}
      {!ready && showStep && ob.Panel && <ob.Panel />}
      {msg && <p className={`text-xs text-center ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}

      {/* summary */}
      <dl className="text-xs space-y-1.5 px-0.5 pt-1 border-t border-line">
        <Row k="Liquidation Price" v={liq && sizeCoin ? fmtPx(liq) : "N/A"} />
        <Row k="Order Value" v={sizeUsd ? fmtUsd(sizeUsd) : "N/A"} />
        <Row k="Margin Required" v={sizeUsd ? fmtUsd(margin) : "N/A"} />
        {(type === "market" || type.endsWith("Market")) && <Row k="Slippage" v={<span>Est: <span className={slip > 0.005 ? "text-warn" : ""}>{(slip * 100).toFixed(2)}%</span> / Max: {(MAX_SLIP * 100).toFixed(2)}%</span>} />}
        <Row k="Fees" v={<span><span className="text-brand">◆</span> {(TAKER * 100).toFixed(3)}% / {(MAKER * 100).toFixed(3)}% + {(BUILDER * 100).toFixed(2)}% builder{sizeUsd ? ` · ${fmtUsd(sizeUsd * feeRate)}` : ""}</span>} />
      </dl>
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn h-9" onClick={() => openFunds("deposit")}>Deposit</button>
        <button className="btn h-9" onClick={() => openFunds("withdraw")}>Withdraw</button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="card-2 h-10 px-3 flex items-center gap-2">
      <span className="text-xs text-muted whitespace-nowrap">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted underline decoration-dotted decoration-line-2 underline-offset-4">{k}</dt>
      <dd className="num text-right text-fg-2">{v}</dd>
    </div>
  );
}
