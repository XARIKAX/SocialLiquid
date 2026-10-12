"use client";
/** in-app deposit and withdrawal. funds move wallet ⇄ hyperliquid directly; socialLiquid signs nothing and holds nothing. */
import { useEffect, useRef, useState } from "react";
import { useChainId, useReadContract, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { fmtUsd } from "@/lib/format";
import { withdrawWithWallet } from "@/lib/hl-client";
import { DEPOSIT_CHAIN, EXPLORER, MIN_DEPOSIT, MIN_WITHDRAW, USDC_ADDRESS, WITHDRAW_FEE, depositWithWallet } from "@/lib/funds";
import { Icon } from "../ui";

export type FundsMode = "deposit" | "withdraw";
const EVT = "sl:funds";

/** open the funds modal from anywhere (ticket buttons, onboarding box, empty states) */
export function openFunds(mode: FundsMode) {
  window.dispatchEvent(new CustomEvent<FundsMode>(EVT, { detail: mode }));
}

/** mount once per page; renders the modal when something calls openFunds */
export function FundsHost({ address }: { address: string }) {
  const [mode, setMode] = useState<FundsMode | null>(null);
  useEffect(() => {
    const h = (e: Event) => setMode((e as CustomEvent<FundsMode>).detail);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  if (!mode) return null;
  return <FundsModal mode={mode} address={address} onClose={() => setMode(null)} onMode={setMode} />;
}

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "sent"; hash: string | null; text: string } | { kind: "done"; text: string } | { kind: "error"; text: string };

function FundsModal({ mode, address, onClose, onMode }: { mode: FundsMode; address: string; onClose: () => void; onMode: (m: FundsMode) => void }) {
  const { me } = useAuth();
  const mockMode = me?.network === "mock";
  const { data: wallet } = useWalletClient();
  const chainId = useChainId();
  const qc = useQueryClient();
  const bal = useBalance(address);
  const usdc = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
    chainId: DEPOSIT_CHAIN.id,
    query: { enabled: !mockMode, refetchInterval: 10_000 },
  });
  const walletUsdc = usdc.data !== undefined ? Number(formatUnits(usdc.data, 6)) : null;
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState(address);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startBal = useRef<number | null>(null);
  const amt = Number(amount);

  // after a deposit, watch the hyperliquid balance until it moves
  useEffect(() => {
    if (phase.kind !== "sent" || mode !== "deposit" || startBal.current === null || !bal.data) return;
    if (bal.data.withdrawable > startBal.current + 0.01) {
      setPhase({ kind: "done", text: `${fmtUsd(bal.data.withdrawable - startBal.current)} credited to your Hyperliquid balance.` });
      qc.invalidateQueries({ queryKey: ["balance"] });
    }
  }, [bal.data, phase.kind, mode, qc]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const max = mode === "deposit" ? walletUsdc : bal.data ? Math.max(0, bal.data.withdrawable) : null;
  const min = mode === "deposit" ? MIN_DEPOSIT : MIN_WITHDRAW;
  const valid = amt >= min && (max === null || amt <= max + 1e-9) && (mode === "deposit" || /^0x[0-9a-fA-F]{40}$/.test(dest));
  const busy = phase.kind === "busy";

  const run = async () => {
    setPhase({ kind: "busy", text: mockMode ? "Applying…" : "Confirm in your wallet…" });
    try {
      if (mode === "deposit") {
        startBal.current = bal.data?.withdrawable ?? 0;
        if (mockMode) {
          await api("/api/mock/funds", { method: "POST", json: { kind: "deposit", amount: amt } });
          setPhase({ kind: "sent", hash: null, text: "Mock deposit sent." });
        } else {
          if (!wallet) throw new Error("wallet not connected");
          const hash = await depositWithWallet(wallet, amount);
          setPhase({ kind: "sent", hash, text: `Sent to Hyperliquid's bridge. It credits your balance in about a minute.` });
        }
        qc.invalidateQueries({ queryKey: ["balance"] });
      } else {
        if (mockMode) {
          await api("/api/mock/funds", { method: "POST", json: { kind: "withdraw", amount: amt } });
        } else {
          if (!wallet) throw new Error("wallet not connected");
          await withdrawWithWallet(wallet, chainId, dest, amount);
        }
        qc.invalidateQueries({ queryKey: ["balance"] });
        setPhase({ kind: "done", text: `Withdrawal requested. ${fmtUsd(Math.max(0, amt - WITHDRAW_FEE))} arrives on Arbitrum in about 5 minutes.` });
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setPhase({ kind: "error", text: /rejected|denied/i.test(msg) ? "Cancelled in wallet." : msg.slice(0, 220) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={mode}>
      <div className="card w-full max-w-md p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="seg">
            {(["deposit", "withdraw"] as FundsMode[]).map((m) => (
              <button key={m} className={`seg-item h-8 capitalize ${mode === m ? "seg-active" : ""}`} onClick={() => { onMode(m); setPhase({ kind: "idle" }); setAmount(""); }}>{m}</button>
            ))}
          </span>
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="card-2 p-3 text-xs space-y-1.5">
          {mode === "deposit" ? (
            <>
              <div className="flex justify-between"><span className="text-muted">USDC in wallet · {DEPOSIT_CHAIN.name}</span><span className="num">{mockMode ? "mock" : walletUsdc === null ? "…" : fmtUsd(walletUsdc)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Hyperliquid balance</span><span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span></div>
            </>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted">Available to withdraw</span><span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span></div>
              <div className="flex justify-between"><span className="text-muted">Network fee</span><span className="num">{fmtUsd(WITHDRAW_FEE)} · paid to Hyperliquid</span></div>
            </>
          )}
        </div>

        <label className="block mt-3 text-xs text-muted">Amount (USDC)</label>
        <div className="flex items-center gap-2 mt-1">
          <input className="input h-11 flex-1 num text-[15px]" inputMode="decimal" placeholder={`min ${min}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} disabled={busy} />
          <button className="btn h-11 px-3" onClick={() => max !== null && setAmount(String(Math.floor(max * 100) / 100))} disabled={busy || max === null}>Max</button>
        </div>
        {mode === "withdraw" && (
          <>
            <label className="block mt-3 text-xs text-muted">Destination · Arbitrum address</label>
            <input className="input h-10 w-full mt-1 num text-xs" value={dest} onChange={(e) => setDest(e.target.value.trim())} disabled={busy} spellCheck={false} />
          </>
        )}
        {amt > 0 && amt < min && <p className="text-warn text-[11px] mt-1.5">Minimum {mode} is {min} USDC.</p>}
        {max !== null && amt > max + 1e-9 && <p className="text-warn text-[11px] mt-1.5">That is more than you have available.</p>}

        {phase.kind === "idle" || phase.kind === "error" ? (
          <button className="btn btn-primary h-11 w-full mt-3 text-[14px]" onClick={run} disabled={!valid || (!mockMode && !wallet)}>
            {mode === "deposit" ? `Deposit${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Hyperliquid` : `Withdraw${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Arbitrum`}
          </button>
        ) : (
          <div className="btn h-11 w-full mt-3 text-[13px] justify-center cursor-default">
            {phase.kind === "busy" ? <span className="animate-pulse">{phase.text}</span> : <span className="inline-flex items-center gap-1.5 text-up"><Icon.check /> {phase.kind === "done" ? "Done" : "Sent"}</span>}
          </div>
        )}
        {phase.kind !== "idle" && phase.kind !== "busy" && (
          <p className={`text-xs mt-2 leading-snug ${phase.kind === "error" ? "text-down" : "text-muted"}`}>
            {phase.text}
            {phase.kind === "sent" && phase.hash && <> <a className="text-brand hover:underline" href={`${EXPLORER}/tx/${phase.hash}`} target="_blank" rel="noreferrer">View transaction</a>.</>}
            {phase.kind === "sent" && mode === "deposit" && <> Waiting for Hyperliquid to credit it…</>}
          </p>
        )}

        <p className="text-[11px] text-dim mt-3 leading-snug">
          {mode === "deposit"
            ? <>A deposit is a USDC transfer from your wallet to Hyperliquid&apos;s bridge on {DEPOSIT_CHAIN.name}. socialLiquid never holds funds. Coming from Solana, Ethereum or Base? <a className="text-brand hover:underline" href={`${HL_APP_URL_CLIENT}/trade`} target="_blank" rel="noreferrer">Use Hyperliquid&apos;s cross-chain routes</a> and the balance shows up here.</>
            : <>Withdrawals are signed by your main wallet, never by the trading agent, and are processed by Hyperliquid&apos;s validators. USDC arrives on Arbitrum.</>}
        </p>
      </div>
    </div>
  );
}
