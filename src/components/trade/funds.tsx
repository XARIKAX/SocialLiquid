"use client";
/**
 * in-app deposit and withdrawal. funds move wallet ⇄ hyperliquid directly; socialLiquid signs nothing and holds nothing.
 * the deposit side mirrors hyperliquid's own dialog: an asset (USDC or a native asset through Unit) and, for USDC,
 * a deposit chain (Arbitrum via CCTP, the legacy bridge, USDT swap, HyperEVM, and the other CCTP chains).
 */
import { useEffect, useRef, useState } from "react";
import { useChainId, useReadContract, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { fmtUsd } from "@/lib/format";
import { withdrawWithWallet } from "@/lib/hl-client";
import {
  CCTP_FORWARD_FEE,
  DEFAULT_ROUTE,
  DEPOSIT_ROUTES,
  EXPLORER,
  MIN_WITHDRAW,
  WITHDRAW_FEE,
  cctpFastFeeBps,
  cctpMaxFee,
  depositCctp,
  depositHyperEvm,
  depositWithWallet,
  routeById,
  swapUsdtToUsdc,
} from "@/lib/funds";
import { UNIT_APP_URL, UNIT_ASSETS } from "@/lib/unit";
import type { wagmiConfig } from "@/lib/wagmi";
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

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "sent"; hash: string | null; explorer: string; text: string } | { kind: "done"; text: string } | { kind: "error"; text: string };
const USDC = "USDC";

function FundsModal({ mode, address, onClose, onMode }: { mode: FundsMode; address: string; onClose: () => void; onMode: (m: FundsMode) => void }) {
  const { me } = useAuth();
  const mockMode = me?.network === "mock";
  const { data: wallet } = useWalletClient();
  const chainId = useChainId();
  const qc = useQueryClient();
  const bal = useBalance(address);
  const [asset, setAsset] = useState(USDC);
  const [routeId, setRouteId] = useState(DEFAULT_ROUTE.id);
  const route = routeById(routeId);
  const [fast, setFast] = useState(true);
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState(address);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startBal = useRef<number | null>(null);
  const amt = Number(amount);
  const isUsdc = asset === USDC;

  // the wallet's balance of the token the chosen route spends, on the route's chain
  const tokenBal = useReadContract({
    address: route.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
    chainId: route.chain.id as (typeof wagmiConfig.chains)[number]["id"],
    query: { enabled: !mockMode && mode === "deposit" && isUsdc, refetchInterval: 10_000 },
  });
  const walletBal = tokenBal.data !== undefined ? Number(formatUnits(tokenBal.data, 6)) : null;
  const cctpRoute = route.kind === "cctp" || route.kind === "swap";
  const fee = useQuery({
    queryKey: ["cctp-fee", route.domain],
    queryFn: () => cctpFastFeeBps(route.domain!),
    enabled: cctpRoute && route.domain !== undefined && !mockMode,
    staleTime: 5 * 60_000,
  });
  const fastBps = fast && fee.data !== undefined && fee.data !== null ? fee.data : null;
  const unit = useQuery({
    queryKey: ["unit-address", asset, address],
    queryFn: () => api<{ address: string; chainLabel: string; signatures: number; min: string | null; confirmations: string | null; mock?: boolean }>(`/api/funds/unit?asset=${asset}`),
    enabled: mode === "deposit" && !isUsdc,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const [copied, setCopied] = useState(false);

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

  const max = mode === "deposit" ? walletBal : bal.data ? Math.max(0, bal.data.withdrawable) : null;
  const min = mode === "deposit" ? route.min : MIN_WITHDRAW;
  const valid = amt >= min && (max === null || amt <= max + 1e-9) && (mode === "deposit" || /^0x[0-9a-fA-F]{40}$/.test(dest));
  const busy = phase.kind === "busy";
  const wrongChain = mode === "deposit" && !mockMode && chainId !== route.chain.id;
  const feeUsd = cctpRoute ? Number(formatUnits(cctpMaxFee(parseUnits(amt > 0 ? amt.toFixed(6) : "0", 6), fastBps), 6)) : 0;
  const reset = () => {
    setPhase({ kind: "idle" });
    setAmount("");
  };

  const run = async () => {
    const step = (text: string) => setPhase({ kind: "busy", text });
    step(mockMode ? "Applying…" : "Confirm in your wallet…");
    try {
      if (mode === "deposit") {
        startBal.current = bal.data?.withdrawable ?? 0;
        if (mockMode) {
          await api("/api/mock/funds", { method: "POST", json: { kind: "deposit", amount: amt } });
          setPhase({ kind: "sent", hash: null, explorer: "", text: `Mock deposit sent via ${route.label}.` });
        } else {
          if (!wallet) throw new Error("wallet not connected");
          const units = parseUnits(amt.toFixed(6), 6);
          if (route.kind === "bridge") {
            const hash = await depositWithWallet(wallet, amt.toFixed(6), step);
            setPhase({ kind: "sent", hash, explorer: route.explorer, text: "Sent to Hyperliquid's bridge. It credits your balance in about a minute." });
          } else if (route.kind === "hyperevm") {
            const hash = await depositHyperEvm(wallet, units, step);
            setPhase({ kind: "sent", hash, explorer: route.explorer, text: "Deposited through HyperEVM. Your perps balance updates within seconds." });
          } else {
            let usdcUnits = units;
            if (route.kind === "swap") {
              const s = await swapUsdtToUsdc(wallet, units, step);
              usdcUnits = s.received;
            }
            const { hash, maxFee } = await depositCctp(wallet, route, usdcUnits, fastBps, step);
            setPhase({
              kind: "sent",
              hash,
              explorer: route.explorer,
              text: `Burned on ${route.chain.name}. Circle forwards ${fmtUsd(Number(formatUnits(usdcUnits - maxFee, 6)))} into your Hyperliquid perps balance ${fastBps !== null ? "in seconds" : "once the chain finalises (about 15 minutes)"}.`,
            });
          }
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const unitInfo = UNIT_ASSETS.find((a) => a.symbol === asset);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={mode}>
      <div className="card w-full max-w-md p-4 shadow-2xl max-h-[calc(100vh-24px)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="seg">
            {(["deposit", "withdraw"] as FundsMode[]).map((m) => (
              <button key={m} className={`seg-item h-8 capitalize ${mode === m ? "seg-active" : ""}`} onClick={() => { onMode(m); reset(); }}>{m}</button>
            ))}
          </span>
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>
        </div>

        {mode === "deposit" && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="block">
              <span className="text-[11px] text-muted">Asset</span>
              <select className="input h-10 mt-1 w-full" value={asset} aria-label="asset" onChange={(e) => { setAsset(e.target.value); reset(); }} disabled={busy}>
                <option value={USDC}>USDC</option>
                {UNIT_ASSETS.map((a) => (
                  <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">Deposit chain</span>
              {isUsdc ? (
                <select className="input h-10 mt-1 w-full" value={routeId} aria-label="deposit chain" onChange={(e) => { setRouteId(e.target.value); reset(); }} disabled={busy}>
                  {DEPOSIT_ROUTES.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              ) : (
                <span className="input h-10 mt-1 w-full inline-flex items-center text-fg-2">{unitInfo?.chainLabel}</span>
              )}
            </label>
          </div>
        )}

        {mode === "deposit" && !isUsdc ? (
          <UnitPanel asset={asset} q={unit} copied={copied} onCopy={copy} />
        ) : (
          <>
            <div className="card-2 p-3 text-xs space-y-1.5">
              {mode === "deposit" ? (
                <>
                  <div className="flex justify-between"><span className="text-muted">{route.symbol} in wallet · {route.chain.name}</span><span className="num">{mockMode ? "mock" : walletBal === null ? "…" : fmtUsd(walletBal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Hyperliquid balance</span><span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Fee</span><span className="num">{cctpRoute && amt > 0 ? `${feeUsd.toFixed(2)} USDC` : route.fee}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Arrives</span><span className="num">{cctpRoute ? (fastBps !== null ? "seconds" : "~15 min (standard)") : route.eta}</span></div>
                  {cctpRoute && fee.data !== null && fee.data !== undefined && (
                    <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer">
                      <span className="text-muted">Fast transfer · +{(fee.data / 100).toFixed(2)}% paid to Circle</span>
                      <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} disabled={busy} />
                    </label>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-muted">Available to withdraw</span><span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Network fee</span><span className="num">{fmtUsd(WITHDRAW_FEE)} · paid to Hyperliquid</span></div>
                </>
              )}
            </div>

            <label className="block mt-3 text-xs text-muted">Amount ({mode === "deposit" ? route.symbol : "USDC"})</label>
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
            {amt > 0 && amt < min && <p className="text-warn text-[11px] mt-1.5">Minimum {mode} is {min} {mode === "deposit" ? route.symbol : "USDC"}.</p>}
            {max !== null && amt > max + 1e-9 && <p className="text-warn text-[11px] mt-1.5">That is more than you have available.</p>}

            {phase.kind === "idle" || phase.kind === "error" ? (
              <button className="btn btn-primary h-11 w-full mt-3 text-[14px]" onClick={run} disabled={!valid || (!mockMode && !wallet)}>
                {mode === "deposit"
                  ? wrongChain
                    ? `Switch to ${route.chain.name} to deposit`
                    : `Deposit${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Hyperliquid`
                  : `Withdraw${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Arbitrum`}
              </button>
            ) : (
              <div className="btn h-11 w-full mt-3 text-[13px] justify-center cursor-default">
                {phase.kind === "busy" ? <span className="animate-pulse">{phase.text}</span> : <span className="inline-flex items-center gap-1.5 text-up"><Icon.check /> {phase.kind === "done" ? "Done" : "Sent"}</span>}
              </div>
            )}
            {phase.kind !== "idle" && phase.kind !== "busy" && (
              <p className={`text-xs mt-2 leading-snug ${phase.kind === "error" ? "text-down" : "text-muted"}`}>
                {phase.text}
                {phase.kind === "sent" && phase.hash && phase.explorer && <> <a className="text-brand hover:underline" href={`${phase.explorer}/tx/${phase.hash}`} target="_blank" rel="noreferrer">View transaction</a>.</>}
                {phase.kind === "sent" && mode === "deposit" && <> Waiting for Hyperliquid to credit it…</>}
              </p>
            )}

            <p className="text-[11px] text-dim mt-3 leading-snug">
              {mode === "deposit" ? <RouteNote kind={route.kind} /> : <>Withdrawals are signed by your main wallet, never by the trading agent, and are processed by Hyperliquid&apos;s validators. USDC arrives on Arbitrum.</>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function RouteNote({ kind }: { kind: string }) {
  switch (kind) {
    case "bridge":
      return <>A plain USDC transfer to Hyperliquid&apos;s bridge on Arbitrum. Free, but anything under 5 USDC is kept by the bridge. socialLiquid never holds funds.</>;
    case "hyperevm":
      return <>USDC moves from HyperEVM into your Hyperliquid perps balance through Circle&apos;s deposit contract. A brand-new Hyperliquid account pays its one-time 1 USDC activation fee on its first withdrawal or send.</>;
    case "swap":
      return <>Uniswap swaps your USDT for USDC in your own wallet (max 0.5% slippage), then the USDC takes the Arbitrum route: Circle burns it and credits your Hyperliquid perps balance. Two or three wallet confirmations.</>;
    default:
      return <>Circle&apos;s CCTP burns the USDC on the source chain and its forwarder credits your Hyperliquid perps balance. The {CCTP_FORWARD_FEE} USDC fee is Circle&apos;s, the same route and fee Hyperliquid&apos;s own deposit uses. socialLiquid never holds funds. Other chains? <a className="text-brand hover:underline" href={`${HL_APP_URL_CLIENT}/trade`} target="_blank" rel="noreferrer">Hyperliquid&apos;s dialog</a> lists the same routes.</>;
  }
}

type UnitQ = { data?: { address: string; chainLabel: string; signatures: number; min: string | null; confirmations: string | null; mock?: boolean }; isLoading: boolean; error: Error | null; refetch: () => void };

/** native-asset deposit: the user's Unit address on the source chain */
function UnitPanel({ asset, q, copied, onCopy }: { asset: string; q: UnitQ; copied: boolean; onCopy: (t: string) => void }) {
  return (
    <>
      <div className="card-2 p-3 text-xs space-y-2">
        {q.isLoading && <div className="text-dim animate-pulse">Asking Unit&apos;s guardians for your {asset} address…</div>}
        {q.error && (
          <div className="text-down">
            {q.error.message}
            <button className="btn btn-ghost h-7 px-2 ml-2 text-[11px]" onClick={() => q.refetch()}>Retry</button>
          </div>
        )}
        {q.data && (
          <>
            <div className="text-muted">Send only <b className="text-fg">{asset}</b> on <b className="text-fg">{q.data.chainLabel}</b> to this address. It is yours: Unit derived it for your Hyperliquid account.</div>
            <div className="flex items-center gap-2">
              <code className="input h-auto py-2 flex-1 text-[11px] break-all num leading-snug" data-testid="unit-address">{q.data.address}</code>
              <button className="btn h-9 px-3 shrink-0" onClick={() => onCopy(q.data!.address)}>{copied ? "Copied" : <><Icon.copy /> Copy</>}</button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <span className="text-muted">Minimum</span><span className="num text-right">{q.data.min ?? "see Unit"}</span>
              <span className="text-muted">Credited after</span><span className="num text-right">{q.data.confirmations ?? "chain finality"}</span>
              <span className="text-muted">Fee</span><span className="num text-right">network gas only</span>
              <span className="text-muted">Guardian signatures</span><span className="num text-right">{q.data.signatures} of 3{q.data.mock ? " · mock" : ""}</span>
            </div>
          </>
        )}
      </div>
      <p className="text-[11px] text-dim mt-3 leading-snug">
        Native deposits run on Unit, the same rails as Hyperliquid&apos;s own dialog, and land in your Hyperliquid <b>spot</b> balance. Sell for USDC on Hyperliquid spot to use it as perps margin. Below the minimum is not credited. Verify the address any time at <a className="text-brand hover:underline" href={`${UNIT_APP_URL}/?asset=${asset.toLowerCase()}`} target="_blank" rel="noreferrer">app.hyperunit.xyz</a>.
      </p>
    </>
  );
}
