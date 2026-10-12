"use client";
/**
 * "Sell for USDC": turns a spot coin (SOL, BTC, ETH that arrived through Unit) into perps margin, the way the
 * Hyperliquid app does it in two moves: a spot market sell on the coin's USDC pair (an order, so signed by the
 * approved trading agent; browser wallets cannot sign hyperliquid orders themselves), then usdClassTransfer of
 * the USDC from spot to perps (a user-signed message from the main wallet). not enabled yet → the enable step
 * renders right here.
 */
import { useEffect, useRef, useState } from "react";
import { useChainId } from "wagmi";
import { useSigner } from "@/hooks/use-signer";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { useMids } from "@/hooks/use-market";
import { api } from "@/lib/client";
import { fmtUsd } from "@/lib/format";
import { usdClassTransferWithWallet } from "@/lib/hl-client";
import { displayCoin, fmtQty, spotRows } from "@/lib/spot";
import { CoinIcon, Icon } from "../ui";
import { EnablePanel, needWallet } from "./onboarding";

const EVT = "sl:convert";
/** open the sell-for-USDC modal for a spot coin (USOL) or its display name (SOL); no coin = the largest holding */
export function openConvert(coin?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(EVT, { detail: coin }));
}

export function ConvertHost({ address }: { address: string }) {
  const [coin, setCoin] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const h = (e: Event) => setCoin((e as CustomEvent<string | undefined>).detail ?? null);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  if (coin === undefined) return null;
  return <ConvertModal address={address} want={coin} onClose={() => setCoin(undefined)} />;
}

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "done"; text: string } | { kind: "error"; text: string };

function ConvertModal({ address, want, onClose }: { address: string; want: string | null; onClose: () => void }) {
  const { me } = useAuth();
  const mockMode = me?.network === "mock";
  const { wallet } = useSigner();
  const chainId = useChainId();
  const qc = useQueryClient();
  const bal = useBalance(address);
  const mids = useMids();
  const rows = spotRows(bal.data?.spot, mids.data).filter((r) => r.name !== "USDC");
  const row = rows.find((r) => r.coin === want || r.name === want) ?? rows[0] ?? null;
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [picked, setPicked] = useState<string | null>(null);
  // once a sale runs the coin leaves the balance; keep showing the row we sold so the result stays on screen
  const lastSel = useRef<(typeof rows)[number] | null>(null);
  const live = picked ? rows.find((r) => r.coin === picked) ?? row : row;
  if (live) lastSel.current = live;
  const sel = live ?? (phase.kind !== "idle" ? lastSel.current : null);
  useEffect(() => {
    if (sel && amount === "" && phase.kind === "idle") setAmount(String(Math.floor(sel.available * 1e6) / 1e6));
  }, [sel, amount, phase.kind]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const amt = Number(amount);
  const px = sel && sel.usd !== null && sel.total > 0 ? sel.usd / sel.total : null;
  const est = px !== null ? amt * px : null;
  const valid = !!sel && amt > 0 && amt <= sel.available + 1e-9;
  const busy = phase.kind === "busy";
  const spotUsdc = bal.data?.spot?.find((b) => b.coin === "USDC");
  const enabled = !!me?.user?.agent?.approved && !!me.user.agent.builderApproved;
  /** spot and perps share one margin pool: nothing to move, and hyperliquid rejects usdClassTransfer */
  const unified = !!bal.data?.unified;

  const run = async () => {
    if (!sel) return;
    try {
      setPhase({ kind: "busy", text: `1 of 2 · Selling ${fmtQty(amt)} ${sel.name} on Hyperliquid spot (your trading agent signs, no wallet prompt)…` });
      const r = await api<{ avgPx: number; totalSz: number; usdc: number; sz: string }>("/api/trade/spot-sell", { method: "POST", json: { coin: sel.coin, sz: amt } });
      const fresh = await api<{ spot: { coin: string; total: number; hold: number }[] | null }>(`/api/balance?address=${address}`);
      const usdcSpot = fresh.spot?.find((b) => b.coin === "USDC");
      const move = Math.floor(Math.max(0, (usdcSpot ? usdcSpot.total - usdcSpot.hold : r.usdc)) * 100) / 100;
      if (unified) {
        // one margin pool: the USDC from the sale already backs perps, and hyperliquid refuses the transfer
        qc.invalidateQueries({ queryKey: ["balance"] });
        setPhase({ kind: "done", text: `Sold ${r.totalSz} ${sel.name} at ${fmtUsd(r.avgPx)}. Your account is unified, so the ${fmtUsd(move)} is already margin, ready to trade.` });
        return;
      }
      if (move <= 0) throw new Error(`sold ${r.totalSz} ${sel.name} at ${fmtUsd(r.avgPx)}, but no USDC shows in spot yet; open Withdraw → HyperEVM or try again in a moment`);
      setPhase({ kind: "busy", text: mockMode ? "2 of 2 · Moving USDC to perps…" : `2 of 2 · Confirm moving ${fmtUsd(move)} to perps in your wallet…` });
      if (mockMode) await api("/api/mock/funds", { method: "POST", json: { kind: "class-transfer", amount: move, toPerp: true } });
      else await usdClassTransferWithWallet(needWallet(wallet), chainId, String(move), true);
      qc.invalidateQueries({ queryKey: ["balance"] });
      setPhase({ kind: "done", text: `Sold ${r.totalSz} ${sel.name} at ${fmtUsd(r.avgPx)}. ${fmtUsd(move)} is now in your perps balance, ready to trade.` });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setPhase({ kind: "error", text: /rejected|denied/i.test(msg) ? "Cancelled in wallet." : msg.slice(0, 240) });
      qc.invalidateQueries({ queryKey: ["balance"] });
    }
  };

  const moveOnly = async () => {
    if (!spotUsdc) return;
    const move = Math.floor(Math.max(0, spotUsdc.total - spotUsdc.hold) * 100) / 100;
    try {
      setPhase({ kind: "busy", text: mockMode ? "Moving USDC to perps…" : `Confirm moving ${fmtUsd(move)} to perps in your wallet…` });
      if (mockMode) await api("/api/mock/funds", { method: "POST", json: { kind: "class-transfer", amount: move, toPerp: true } });
      else await usdClassTransferWithWallet(needWallet(wallet), chainId, String(move), true);
      qc.invalidateQueries({ queryKey: ["balance"] });
      setPhase({ kind: "done", text: `${fmtUsd(move)} moved to your perps balance.` });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setPhase({ kind: "error", text: /rejected|denied/i.test(msg) ? "Cancelled in wallet." : msg.slice(0, 240) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="sell for USDC">
      <div className="card w-full max-w-md p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold">{sel ? "Sell for USDC" : unified ? "Your USDC balance" : "Move USDC to perps"}</h2>
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>
        </div>
        {spotUsdc && spotUsdc.total - spotUsdc.hold > 0.01 && (
          <div className="card-2 p-3 text-xs mb-3" data-testid="usdc-spot-card">
            <div className="flex items-center justify-between">
              <span className="text-muted">USDC in your spot balance</span>
              <span className="num font-semibold">{fmtUsd(spotUsdc.total - spotUsdc.hold)}</span>
            </div>
            {unified ? (
              <p className="text-dim mt-1 leading-snug">Your Hyperliquid account is unified: spot and perps share one margin pool, so this USDC already backs your trades. There is nothing to move.</p>
            ) : (
              <>
                <p className="text-dim mt-1 leading-snug">Deposits sometimes land in spot. Perps trade from the perps balance, so move it over: one signed message, no fee, instant.</p>
                <button className="btn btn-primary h-10 w-full mt-2" onClick={moveOnly} disabled={busy || (!mockMode && !wallet)} data-testid="move-usdc-go">{busy ? "Working…" : `Move ${fmtUsd(spotUsdc.total - spotUsdc.hold)} to perps`}</button>
              </>
            )}
            {phase.kind !== "idle" && phase.kind !== "busy" && !sel && <p className={`text-xs mt-2 leading-snug ${phase.kind === "error" ? "text-down" : "text-up"}`} data-testid="convert-status">{phase.text}</p>}
          </div>
        )}
        {!sel ? (
          <div className="card-2 p-3 text-xs text-muted">Nothing to sell: no spot coins in your Hyperliquid balance.{spotUsdc && spotUsdc.total > 0.01 ? " Your spot USDC is above." : ""}</div>
        ) : (
          <>
            {rows.length > 1 && (
              <label className="block mb-3">
                <span className="text-[11px] text-muted">Asset</span>
                <select className="input h-10 mt-1 w-full" value={sel.coin} aria-label="asset" onChange={(e) => { setPicked(e.target.value); setAmount(""); setPhase({ kind: "idle" }); }} disabled={busy}>
                  {rows.map((r) => <option key={r.coin} value={r.coin}>{r.name} · {fmtQty(r.available)}</option>)}
                </select>
              </label>
            )}
            <div className="card-2 p-3 text-xs space-y-1.5">
              <div className="flex justify-between items-center"><span className="text-muted">In your spot balance</span><span className="num inline-flex items-center gap-1.5"><CoinIcon coin={sel.name} size={16} />{fmtQty(sel.available)} {sel.name}</span></div>
              <div className="flex justify-between"><span className="text-muted">Price · Hyperliquid spot</span><span className="num">{px !== null ? fmtUsd(px) : "…"}</span></div>
              <div className="flex justify-between"><span className="text-muted">You get · to perps</span><span className="num font-semibold" data-testid="convert-est">{est !== null ? `≈ ${fmtUsd(est)}` : "…"}</span></div>
              <div className="flex justify-between"><span className="text-muted">Fee</span><span className="num">Hyperliquid spot taker fee</span></div>
            </div>
            <label className="block mt-3 text-xs text-muted">Amount ({sel.name})</label>
            <div className="flex items-center gap-2 mt-1">
              <input className="input h-11 flex-1 num text-[15px]" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} disabled={busy} aria-label="amount" />
              <button className="btn h-11 px-3" onClick={() => setAmount(String(Math.floor(sel.available * 1e6) / 1e6))} disabled={busy}>Max</button>
            </div>
            {amt > sel.available + 1e-9 && <p className="text-warn text-[11px] mt-1.5">That is more than you have.</p>}
            {!enabled ? (
              <div className="mt-1" data-testid="convert-enable">
                <p className="text-xs text-muted mt-3 leading-snug">Hyperliquid fills spot sells through your approved trading agent, so enable trading first. Two signatures, once; the sell button appears right after.</p>
                <EnablePanel />
              </div>
            ) : phase.kind === "idle" || phase.kind === "error" ? (
              <button className="btn btn-primary h-11 w-full mt-3 text-[14px]" onClick={run} disabled={!valid || busy} data-testid="convert-go">
                Sell {amt > 0 ? `${fmtQty(amt)} ` : ""}{sel.name} → USDC
              </button>
            ) : (
              <div className="btn h-11 w-full mt-3 text-[13px] justify-center cursor-default">
                {phase.kind === "busy" ? <span className="animate-pulse">{phase.text}</span> : <span className="inline-flex items-center gap-1.5 text-up"><Icon.check /> Done</span>}
              </div>
            )}
            {phase.kind !== "idle" && phase.kind !== "busy" && <p className={`text-xs mt-2 leading-snug ${phase.kind === "error" ? "text-down" : "text-muted"}`} data-testid="convert-status">{phase.text}</p>}
            <p className="text-[11px] text-dim mt-3 leading-snug">
              Same two moves as the Hyperliquid app: a market sell of {displayCoin(sel.coin)} on Hyperliquid spot, placed by your trading agent (no wallet prompt), then one signed message from your wallet moves the USDC from spot to perps. No gas, nothing leaves Hyperliquid. Your wallet may label the signature &quot;Ethereum&quot; or your current network; that is only the signing network.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
