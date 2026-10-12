"use client";
/**
 * "Sell for USDC": turns a spot coin (SOL, BTC, ETH that arrived through Unit) into perps margin, the way the
 * Hyperliquid app does it in two moves: a spot market sell on the coin's USDC pair (an order, so signed by the
 * approved trading agent; browser wallets cannot sign hyperliquid orders themselves), then usdClassTransfer of
 * the USDC from spot to perps (a user-signed message from the main wallet). not enabled yet → the enable step
 * renders right here.
 * styles: the funds dialog's language (ticket.css .tm-tk-*, funds.css .tm-fd-*).
 */
import "./ticket.css";
import "./funds.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
import { CoinIcon } from "../ui";
import { EnablePanel, needWallet } from "./onboarding";
import { TkClose, TkIcon, TkModal, TkMsg, TkNum, TkPicker, TkRoute, type TkPickOption } from "./tk-bits";

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
  const close = useCallback(() => setCoin(undefined), []);
  if (coin === undefined) return null;
  // the dialog portals itself to the body (TkModal), above anything that opened it (the funds dialog included)
  return <ConvertModal address={address} want={coin} onClose={close} />;
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
  const uid = useId();
  const amtRef = useRef<HTMLInputElement>(null);
  // once a sale runs the coin leaves the balance; keep showing the row we sold so the result stays on screen
  const lastSel = useRef<(typeof rows)[number] | null>(null);
  const live = picked ? rows.find((r) => r.coin === picked) ?? row : row;
  if (live) lastSel.current = live;
  const sel = live ?? (phase.kind !== "idle" ? lastSel.current : null);
  useEffect(() => {
    if (sel && amount === "" && phase.kind === "idle") setAmount(String(Math.floor(sel.available * 1e6) / 1e6));
  }, [sel, amount, phase.kind]);

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

  /* ---------- presentation ---------- */
  const spotFree = spotUsdc ? spotUsdc.total - spotUsdc.hold : 0;
  const options: TkPickOption[] = rows.map((r) => ({ value: r.coin, text: r.name, icon: <CoinIcon coin={r.name} size={22} />, sub: `${fmtQty(r.available)} ${r.name}${r.usd !== null ? ` · ≈ ${fmtUsd(r.usd)}` : ""}` }));
  const goOff = !valid || busy;

  return (
    <TkModal labelledBy={`${uid}-t`} onClose={onClose} className="tm-fd-cv">
      <div className="tm-tk-modal-head">
        <span className="tm-fd-kicker">
          <span className="tm-fd-badge" aria-hidden>
            <TkIcon.swap size={13} sw={2} />
          </span>
          Spot → perps
        </span>
        <TkClose onClose={onClose} />
      </div>
      <h2 id={`${uid}-t`} className="tm-tk-modal-title">
        {sel ? "Sell for USDC" : unified ? "Your USDC balance" : "Move USDC to perps"}
      </h2>

      {spotUsdc && spotFree > 0.01 && (
        <div className="tm-fd-usdc" data-testid="usdc-spot-card">
          <div className="tm-fd-usdc-head">
            <span>
              <CoinIcon coin="USDC" size={18} />
              USDC in your spot balance
            </span>
            <b className="num">{fmtUsd(spotFree)}</b>
          </div>
          {unified ? (
            <p>Your Hyperliquid account is unified: spot and perps share one margin pool, so this USDC already backs your trades. There is nothing to move.</p>
          ) : (
            <>
              <p>Deposits sometimes land in spot. Perps trade from the perps balance, so move it over: one signed message, no fee, instant.</p>
              <button type="button" className={`btn tm-fd-usdc-go ${sel ? "" : `btn-primary ${busy || (!mockMode && !wallet) ? "" : "btn-glow"}`}`} onClick={moveOnly} disabled={busy || (!mockMode && !wallet)} data-testid="move-usdc-go">
                {busy ? <TkIcon.spin size={14} className="tm-tk-spin" /> : <TkIcon.arrow size={14} sw={2} />}
                {busy ? "Working…" : `Move ${fmtUsd(spotFree)} to perps`}
              </button>
            </>
          )}
          {phase.kind !== "idle" && phase.kind !== "busy" && !sel && (
            <p className="tm-tk-msg" data-tone={phase.kind === "error" ? "err" : "ok"} role={phase.kind === "error" ? "alert" : "status"} data-testid="convert-status">
              {phase.kind === "error" ? <TkIcon.alert size={13} /> : <TkIcon.check size={13} sw={2.2} />}
              <span>{phase.text}</span>
            </p>
          )}
        </div>
      )}
      {!sel ? (
        <div className="tm-fd-empty">
          Nothing to sell: no spot coins in your Hyperliquid balance.{spotUsdc && spotUsdc.total > 0.01 ? " Your spot USDC is above." : ""}
        </div>
      ) : (
        <>
          {rows.length > 1 && (
            <div className="tm-fd-picks" data-one="">
              <TkPicker
                label="Asset"
                listLabel="asset"
                value={sel.coin}
                options={options}
                onPick={(v) => {
                  setPicked(v);
                  setAmount("");
                  setPhase({ kind: "idle" });
                }}
                disabled={busy}
                face={
                  <>
                    <CoinIcon coin={sel.name} size={20} />
                    <span className="tm-fd-pick-t">{sel.name}</span>
                    <small className="tm-fd-pick-s">{fmtQty(sel.available)} available</small>
                  </>
                }
              />
            </div>
          )}
          <TkRoute from={{ name: "Spot", sub: sel.name, tone: "peri" }} to={{ name: "Perps", sub: "USDC" }} moving={busy} />
          <dl className="tm-tk-bal">
            <div>
              <dt>In your spot balance</dt>
              <dd className="tm-fd-coinval">
                <CoinIcon coin={sel.name} size={16} />
                <b>
                  {fmtQty(sel.available)} {sel.name}
                </b>
              </dd>
            </div>
            <div>
              <dt>Price · Hyperliquid spot</dt>
              <dd>{px !== null ? fmtUsd(px) : "…"}</dd>
            </div>
            <div>
              <dt>You get · to perps</dt>
              <dd className="tm-fd-est" data-testid="convert-est">
                {est !== null ? `≈ ${fmtUsd(est)}` : "…"}
              </dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd>Hyperliquid spot taker fee</dd>
            </div>
          </dl>
          <div className="tm-tk-size" onClick={() => amtRef.current?.focus()}>
            <div className="tm-tk-size-head">
              <label htmlFor={`${uid}-a`} className="tm-tk-size-label">
                Amount
              </label>
              <button
                type="button"
                className="tm-tk-max"
                onClick={(e) => {
                  e.stopPropagation();
                  setAmount(String(Math.floor(sel.available * 1e6) / 1e6));
                }}
                disabled={busy}
              >
                Max{" "}
                <b>
                  {fmtQty(sel.available)} {sel.name}
                </b>
              </button>
            </div>
            <div className="tm-tk-size-main">
              <TkNum id={`${uid}-a`} ref={amtRef} className="tm-tk-size-input" inputMode="decimal" value={amount} onValue={(v) => setAmount(v.replace(/[^0-9.]/g, ""))} disabled={busy} aria-label="amount" autoComplete="off" placeholder="0" />
              <span className="tm-tk-unit" aria-hidden>
                {sel.name}
              </span>
            </div>
            <div className="tm-tk-size-sub">{amt > 0 && est !== null ? `≈ ${fmtUsd(est)} of USDC to perps` : `${fmtQty(sel.available)} ${sel.name} available`}</div>
          </div>
          {amt > sel.available + 1e-9 && <TkMsg tone="warn">That is more than you have.</TkMsg>}
          {!enabled ? (
            <div className="tm-fd-cv-enable" data-testid="convert-enable">
              <p className="tm-fd-note">
                <TkIcon.info size={12} sw={2} />
                <span>Hyperliquid fills spot sells through your approved trading agent, so enable trading first. Two signatures, once; the sell button appears right after.</span>
              </p>
              <EnablePanel />
            </div>
          ) : phase.kind === "idle" || phase.kind === "error" ? (
            <button type="button" className={`btn btn-primary tm-tk-cta ${goOff ? "" : "btn-glow"}`} onClick={run} disabled={goOff} data-testid="convert-go">
              <TkIcon.swap size={15} />
              <span className="tm-fd-cta-t">
                Sell {amt > 0 ? `${fmtQty(amt)} ` : ""}
                {sel.name} → USDC
              </span>
            </button>
          ) : (
            <div className="tm-tk-status" data-tone={phase.kind === "busy" ? undefined : "ok"} role="status">
              {phase.kind === "busy" ? (
                <>
                  <TkIcon.spin size={15} className="tm-tk-spin" />
                  <span className="tm-fd-status-t">{phase.text}</span>
                </>
              ) : (
                <>
                  <TkIcon.check size={15} sw={2.2} /> Done
                </>
              )}
            </div>
          )}
          {phase.kind !== "idle" && phase.kind !== "busy" && (
            <p className="tm-tk-msg" data-tone={phase.kind === "error" ? "err" : "ok"} role={phase.kind === "error" ? "alert" : "status"} data-testid="convert-status">
              {phase.kind === "error" ? <TkIcon.alert size={13} /> : <TkIcon.check size={13} sw={2.2} />}
              <span>{phase.text}</span>
            </p>
          )}
          <p className="tm-tk-modal-foot">
            Same two moves as the Hyperliquid app: a market sell of {displayCoin(sel.coin)} on Hyperliquid spot, placed by your trading agent (no wallet prompt), then one signed message from your wallet moves the USDC from spot to perps. No gas, nothing leaves Hyperliquid. Your wallet may label the signature &quot;Ethereum&quot; or your current network; that is only the signing network.
          </p>
        </>
      )}
    </TkModal>
  );
}
