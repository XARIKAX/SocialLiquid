"use client";
/**
 * in-app deposit and withdrawal. funds move wallet ⇄ hyperliquid directly; socialLiquid signs nothing and holds nothing.
 * both sides mirror hyperliquid's own dialogs: an asset (USDC or a native asset through Unit) and, for USDC, a chain
 * (Arbitrum via CCTP, the legacy bridge, HyperEVM, the other CCTP chains; deposits also offer the USDT swap).
 */
import { useEffect, useRef, useState } from "react";
import { useChainId, useReadContract, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance, type Balance } from "@/hooks/use-me";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { fmtUsd } from "@/lib/format";
import { sendToEvmWithWallet, spotSendWithWallet, usdClassTransferWithWallet, withdrawWithWallet } from "@/lib/hl-client";
import {
  CCTP_FORWARD_FEE,
  DEFAULT_ROUTE,
  DEPOSIT_ROUTES,
  USDC_SYSTEM_ADDRESS,
  WITHDRAW_ROUTES,
  cctpFastFeeBps,
  cctpMaxFee,
  depositCctp,
  depositHyperEvm,
  depositWithWallet,
  routeById,
  swapUsdtToUsdc,
  withdrawRouteById,
} from "@/lib/funds";
import { UNIT_APP_URL, UNIT_ASSETS, fetchUnitAddress, fetchUnitOperations, fetchUnitWithdrawAddress, looksLikeAddress, minNumber, spotEntry, unitDepositable, unitStateLabel, unitWithdrawable, type UnitAddress, type UnitAsset, type UnitOperation } from "@/lib/unit";
import QRCode from "qrcode";
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
  const [wRouteId, setWRouteId] = useState(WITHDRAW_ROUTES[0].id);
  const wRoute = withdrawRouteById(wRouteId);
  const [fast, setFast] = useState(true);
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState(address);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startBal = useRef<number | null>(null);
  const amt = Number(amount);
  const isUsdc = asset === USDC;
  const unitInfo = UNIT_ASSETS.find((a) => a.symbol === asset);
  const nativeW = mode === "withdraw" && !isUsdc;
  const spotBal = unitInfo ? spotEntry(unitInfo, bal.data?.spot) : null;

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
  const cctpRoute = mode === "deposit" && (route.kind === "cctp" || route.kind === "swap");
  const fee = useQuery({
    queryKey: ["cctp-fee", route.domain],
    queryFn: () => cctpFastFeeBps(route.domain!),
    enabled: cctpRoute && route.domain !== undefined && !mockMode,
    staleTime: 5 * 60_000,
  });
  const fastBps = fast && fee.data !== undefined && fee.data !== null ? fee.data : null;
  const unit = useQuery({
    queryKey: ["unit-address", asset, address],
    queryFn: () => fetchUnitAddress(asset, address, api),
    enabled: mode === "deposit" && !isUsdc && !!unitInfo && unitDepositable(unitInfo),
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

  // what the amount is in, where it can go, and how much of it there is
  const symbol = mode === "deposit" ? route.symbol : nativeW ? asset : USDC;
  const destLocked = mode === "withdraw" && !nativeW && wRoute.kind === "hyperevm";
  const effDest = destLocked ? address : dest;
  const destOk = mode === "deposit" ? true : nativeW ? !!unitInfo && looksLikeAddress(unitInfo.chain, dest) : /^0x[0-9a-fA-F]{40}$/.test(effDest);
  const max = mode === "deposit" ? walletBal : nativeW ? (spotBal ? Math.max(0, spotBal.total - spotBal.hold) : bal.data?.spot ? 0 : null) : bal.data ? Math.max(0, bal.data.withdrawable) : null;
  const min = mode === "deposit" ? route.min : nativeW ? minNumber(unitInfo?.withdrawMin) : wRoute.min;
  const valid = amt >= min && (max === null || amt <= max + 1e-9) && destOk;
  const busy = phase.kind === "busy";
  const wrongChain = mode === "deposit" && !mockMode && chainId !== route.chain.id;
  const feeUsd = cctpRoute ? Number(formatUnits(cctpMaxFee(parseUnits(amt > 0 ? amt.toFixed(6) : "0", 6), fastBps), 6)) : 0;
  const reset = () => {
    setPhase({ kind: "idle" });
    setAmount("");
  };
  const pickAsset = (a: string) => {
    setAsset(a);
    setDest(a === USDC ? address : "");
    reset();
  };
  /** decimal string for hyperliquid actions: no exponent, no trailing zeros */
  const amountStr = amt.toFixed(8).replace(/\.?0+$/, "");

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
      } else if (nativeW) {
        // native asset out through Unit: Unit names a hyperliquid address for this destination, we spotSend the coin there
        const info = unitInfo!;
        step(`Asking Unit's guardians for the ${asset} withdrawal address…`);
        const w = await fetchUnitWithdrawAddress(asset, dest, api);
        if (mockMode) {
          await api("/api/mock/funds", { method: "POST", json: { kind: "spot-withdraw", coin: info.spotCoin, amount: amt } });
        } else {
          if (!wallet) throw new Error("wallet not connected");
          const { tokens } = await api<{ tokens: Record<string, { tokenId: string }> }>(`/api/funds/tokens?names=${info.spotCoin}`);
          const tok = tokens[info.spotCoin!];
          if (!tok) throw new Error(`${info.spotCoin} is not in Hyperliquid's spot token list; nothing was sent`);
          step(`Confirm sending ${amountStr} ${asset} to Unit in your wallet…`);
          await spotSendWithWallet(wallet, chainId, w.address, `${info.spotCoin}:${tok.tokenId}`, amountStr);
        }
        qc.invalidateQueries({ queryKey: ["balance"] });
        setPhase({ kind: "done", text: `Sent to Unit. ${amountStr} ${asset}, minus Unit's network fee, arrives at ${dest.slice(0, 6)}…${dest.slice(-4)} on ${info.chainLabel} in about 4 minutes.` });
      } else {
        if (mockMode) {
          await api("/api/mock/funds", { method: "POST", json: { kind: "withdraw", amount: amt } });
        } else {
          if (!wallet) throw new Error("wallet not connected");
          if (wRoute.kind === "bridge") {
            await withdrawWithWallet(wallet, chainId, effDest, amountStr);
          } else if (wRoute.kind === "hyperevm") {
            step("1 of 2 · Confirm moving USDC from perps to spot…");
            await usdClassTransferWithWallet(wallet, chainId, amountStr, false);
            const { tokens } = await api<{ tokens: Record<string, { tokenId: string }> }>("/api/funds/tokens?names=USDC");
            if (!tokens.USDC) throw new Error("USDC is missing from Hyperliquid's spot token list; the USDC is in your spot balance, nothing was sent to HyperEVM");
            step("2 of 2 · Confirm sending it to HyperEVM…");
            await spotSendWithWallet(wallet, chainId, USDC_SYSTEM_ADDRESS, `USDC:${tokens.USDC.tokenId}`, amountStr);
          } else {
            step("Confirm the withdrawal in your wallet…");
            await sendToEvmWithWallet(wallet, chainId, { amount: amountStr, destination: effDest, domain: wRoute.domain! });
          }
        }
        qc.invalidateQueries({ queryKey: ["balance"] });
        const net = fmtUsd(Math.max(0, amt - wRoute.fee));
        setPhase({
          kind: "done",
          text:
            wRoute.kind === "hyperevm"
              ? `${net} USDC is on its way to ${address.slice(0, 6)}…${address.slice(-4)} on HyperEVM. Seconds.`
              : wRoute.kind === "bridge"
                ? `Withdrawal requested. ${net} arrives on Arbitrum in about 5 minutes.`
                : `Withdrawal requested. Circle delivers ${net} to ${effDest.slice(0, 6)}…${effDest.slice(-4)} on ${wRoute.chain.name} within 5 minutes.`,
        });
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

  const chainName = mode === "deposit" ? route.chain.name : nativeW ? unitInfo?.chainLabel ?? "" : wRoute.chain.name;
  const buttonLabel = busy
    ? ""
    : mode === "deposit"
      ? wrongChain
        ? `Switch to ${route.chain.name} to deposit`
        : `Deposit${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Hyperliquid`
      : nativeW
        ? `Withdraw${amt >= min ? ` ${amountStr} ${asset}` : ""} to ${chainName}`
        : `Withdraw${amt >= min ? ` ${fmtUsd(amt)}` : ""} to ${chainName}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={mode}>
      <div className="card w-full max-w-md p-4 shadow-2xl max-h-[calc(100vh-24px)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="seg">
            {(["deposit", "withdraw"] as FundsMode[]).map((m) => (
              <button key={m} className={`seg-item h-8 capitalize ${mode === m ? "seg-active" : ""}`} onClick={() => { onMode(m); setDest(isUsdc ? address : ""); reset(); }}>{m}</button>
            ))}
          </span>
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block">
            <span className="text-[11px] text-muted">Asset</span>
            <select className="input h-10 mt-1 w-full" value={asset} aria-label="asset" onChange={(e) => pickAsset(e.target.value)} disabled={busy}>
              <option value={USDC}>USDC</option>
              {UNIT_ASSETS.map((a) => (
                <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">{mode === "deposit" ? "Deposit chain" : "Withdrawal chain"}</span>
            {!isUsdc ? (
              <span className="input h-10 mt-1 w-full inline-flex items-center text-fg-2">{unitInfo?.chainLabel}</span>
            ) : mode === "deposit" ? (
              <select className="input h-10 mt-1 w-full" value={routeId} aria-label="deposit chain" onChange={(e) => { setRouteId(e.target.value); reset(); }} disabled={busy}>
                {DEPOSIT_ROUTES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            ) : (
              <select className="input h-10 mt-1 w-full" value={wRouteId} aria-label="withdrawal chain" onChange={(e) => { setWRouteId(e.target.value); reset(); }} disabled={busy}>
                {WITHDRAW_ROUTES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            )}
          </label>
        </div>

        {mode === "deposit" && !isUsdc ? (
          unitInfo && !unitDepositable(unitInfo) ? <UnitLinkPanel mode="deposit" asset={unitInfo.symbol} chainLabel={unitInfo.chainLabel} /> : <UnitPanel asset={unitInfo!} q={unit} spot={bal.data?.spot} copied={copied} onCopy={copy} hlAddress={address} />
        ) : nativeW && unitInfo && !unitWithdrawable(unitInfo) ? (
          <UnitLinkPanel mode="withdraw" asset={unitInfo.symbol} chainLabel={unitInfo.chainLabel} />
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
              ) : nativeW ? (
                <>
                  <div className="flex justify-between"><span className="text-muted">{asset} on Hyperliquid spot</span><span className="num">{max === null ? "…" : `${max.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Minimum withdrawal</span><span className="num">{unitInfo?.withdrawMin}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Fee</span><span className="num">Unit&apos;s network fee, deducted</span></div>
                  <div className="flex justify-between"><span className="text-muted">Arrives</span><span className="num">about 4 minutes</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-muted">Available to withdraw</span><span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Fee</span><span className="num">{wRoute.feeLabel}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Arrives</span><span className="num">{wRoute.eta}</span></div>
                </>
              )}
            </div>

            <label className="block mt-3 text-xs text-muted">Amount ({symbol})</label>
            <div className="flex items-center gap-2 mt-1">
              <input className="input h-11 flex-1 num text-[15px]" inputMode="decimal" placeholder={`min ${min}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} disabled={busy} />
              <button className="btn h-11 px-3" onClick={() => max !== null && setAmount(String(nativeW ? Math.floor(max * 1e6) / 1e6 : Math.floor(max * 100) / 100))} disabled={busy || max === null}>Max</button>
            </div>
            {mode === "withdraw" && (
              <>
                <label className="block mt-3 text-xs text-muted">Destination · {chainName} address</label>
                <input
                  className="input h-10 w-full mt-1 num text-xs"
                  value={effDest}
                  onChange={(e) => setDest(e.target.value.trim())}
                  disabled={busy || destLocked}
                  spellCheck={false}
                  placeholder={nativeW ? `Your ${chainName} address` : "0x…"}
                  aria-label="destination"
                />
                {destLocked && <p className="text-[11px] text-dim mt-1">USDC can only leave to HyperEVM at this same address. Send it on from there.</p>}
                {dest && !destOk && !destLocked && <p className="text-warn text-[11px] mt-1.5">That is not a valid {chainName} address.</p>}
              </>
            )}
            {amt > 0 && amt < min && <p className="text-warn text-[11px] mt-1.5">Minimum {mode === "deposit" ? "deposit" : "withdrawal"} is {min} {symbol}.</p>}
            {max !== null && amt > max + 1e-9 && <p className="text-warn text-[11px] mt-1.5">That is more than you have available.</p>}

            {phase.kind === "idle" || phase.kind === "error" ? (
              <button className="btn btn-primary h-11 w-full mt-3 text-[14px]" onClick={run} disabled={!valid || (!mockMode && !wallet)}>
                {buttonLabel}
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

            {nativeW && unitInfo && (
              <div className="mt-3 rounded-md border border-down/60 bg-down/10 p-3 text-[12px] leading-snug text-down" role="alert" data-testid="unit-important">
                <b>IMPORTANT:</b> There is a minimum withdrawal of <b>{unitInfo.withdrawMin}</b>. The destination must be a <b>{unitInfo.chainLabel}</b> address that you control. {asset} sent to an address on any other network, or below the minimum, will be lost.
              </div>
            )}

            <p className="text-[11px] text-dim mt-3 leading-snug">
              {mode === "deposit" ? <RouteNote kind={route.kind} /> : nativeW ? <>Signed by your main wallet, never by the trading agent. Your {asset} goes to Unit&apos;s guardians on Hyperliquid, who pay it out on {chainName}, the same rails as Hyperliquid&apos;s own withdrawal dialog.</> : <WithdrawNote kind={wRoute.kind} chain={wRoute.chain.name} />}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function WithdrawNote({ kind, chain }: { kind: string; chain: string }) {
  switch (kind) {
    case "bridge":
      return <>Hyperliquid&apos;s original withdrawal: signed by your main wallet, processed by the validators, USDC on Arbitrum in about 5 minutes. 1 USDC fee to Hyperliquid.</>;
    case "hyperevm":
      return <>Two signatures from your main wallet: USDC moves from perps to spot, then to HyperEVM through Hyperliquid&apos;s own bridge. No fee. It arrives as USDC at the same address on HyperEVM.</>;
    default:
      return <>Signed by your main wallet, never by the trading agent. Hyperliquid burns the USDC through Circle&apos;s CCTP and Circle mints it to your address on {chain}. The fee is Circle&apos;s, the same route and fee as Hyperliquid&apos;s own withdrawal dialog.</>;
  }
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

type UnitQ = { data?: UnitAddress; isLoading: boolean; error: Error | null; refetch: () => void };

/** what to send from where, per chain */
function sendHint(asset: string, chain: string) {
  switch (chain) {
    case "solana":
      return <>From Phantom, Solflare, Backpack or an exchange: send <b className="text-fg">{asset}</b> on Solana mainnet to this address. {asset === "SOL" ? "Plain SOL only, not wrapped SOL or an SPL token." : `The ${asset} SPL token only.`}</>;
    case "bitcoin":
      return <>Send BTC on the Bitcoin network to this address. Not Lightning, not wrapped BTC on another chain.</>;
    case "ethereum":
      return <>Send ETH on Ethereum mainnet to this address. Not from an L2, not WETH.</>;
    default:
      return <>Send only <b className="text-fg">{asset}</b> on its native chain to this address.</>;
  }
}

/** one Unit operation: amount, state in plain words, time */
function OpRow({ o }: { o: UnitOperation }) {
  const st = unitStateLabel(o.state);
  const when = o.createdAt ? new Date(o.createdAt) : null;
  return (
    <li className="flex items-center justify-between gap-2 text-[11px]">
      <span className="num">{o.sourceAmount ?? o.destinationAmount ?? "…"} {o.asset}</span>
      <span className={st.done ? "text-up" : "text-warn animate-pulse"}>{st.text}</span>
      <span className="text-dim num">{when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
    </li>
  );
}

/** an asset whose minimum deposit we could not verify: no address in-app, Unit's own dialog instead */
function UnitLinkPanel({ mode, asset, chainLabel }: { mode: FundsMode; asset: string; chainLabel: string }) {
  const verb = mode === "deposit" ? "deposit" : "withdrawal";
  return (
    <div className="card-2 p-3 text-xs space-y-2" data-testid="unit-link">
      <div className="leading-snug">Unit sets a minimum {verb} for {asset} on {chainLabel} and anything below it is lost. We do not have that minimum verified yet, so for {asset} use Unit&apos;s own dialog, which shows it next to the address.{mode === "deposit" ? " It still lands in your Hyperliquid spot balance." : ""}</div>
      <a className="btn btn-primary h-10 w-full" href={`${UNIT_APP_URL}/?asset=${asset.toLowerCase()}`} target="_blank" rel="noreferrer">{mode === "deposit" ? "Deposit" : "Withdraw"} {asset} on Unit</a>
    </div>
  );
}

/** native-asset deposit: the user's Unit address on the source chain, with a QR for mobile wallets */
function UnitPanel({ asset: info, q, spot, copied, onCopy, hlAddress }: { asset: UnitAsset; q: UnitQ; spot: Balance["spot"] | undefined; copied: boolean; onCopy: (t: string) => void; hlAddress: string }) {
  const asset = info.symbol;
  // Unit's own record of this account's deposits: the answer to "has it shown up yet"
  const ops = useQuery({ queryKey: ["unit-ops", hlAddress], queryFn: () => fetchUnitOperations(hlAddress, api), enabled: !!q.data, refetchInterval: 15_000, retry: 0 });
  const mine = (ops.data ?? []).filter((o) => o.asset === asset && (!o.destinationChain || /hyperliquid/i.test(o.destinationChain))).slice(0, 5);
  const [qr, setQr] = useState<string | null>(null);
  // spot balance of this coin now vs when the panel opened: the difference is what arrived while watching
  const entry = spotEntry(info, spot);
  const have = entry?.total ?? (spot ? 0 : null);
  const baseline = useRef<number | null>(null);
  if (baseline.current === null && have !== null) baseline.current = have;
  const arrived = have !== null && baseline.current !== null && have > baseline.current + 1e-9 ? have - baseline.current : 0;
  const addr = q.data?.address;
  useEffect(() => {
    if (!addr) return setQr(null);
    let live = true;
    QRCode.toDataURL(addr, { margin: 1, width: 192, errorCorrectionLevel: "M" }).then((u) => live && setQr(u)).catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [addr]);
  return (
    <>
      <div className="card-2 p-3 text-xs space-y-2">
        {q.isLoading && <div className="text-dim animate-pulse">Asking Unit&apos;s guardians for your {asset} address…</div>}
        {q.error && (
          <div className="text-down leading-snug">
            {q.error.message}
            <button className="btn btn-ghost h-7 px-2 ml-2 text-[11px]" onClick={() => q.refetch()}>Retry</button>
          </div>
        )}
        {q.data && (
          <>
            <div className="text-muted leading-snug">{sendHint(asset, q.data.chain)} It is yours: Unit derived it for your Hyperliquid account.</div>
            <div className="flex items-start gap-3">
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt={`QR code of your ${asset} deposit address`} width={96} height={96} className="rounded-md bg-white p-1 shrink-0" data-testid="unit-qr" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <code className="input h-auto py-2 block text-[11px] break-all num leading-snug" data-testid="unit-address">{q.data.address}</code>
                <button className="btn h-9 px-3 w-full" onClick={() => onCopy(q.data!.address)} data-testid="unit-copy">{copied ? "Copied" : <><Icon.copy /> Copy address</>}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <span className="text-muted">Minimum</span><span className="num text-right">{q.data.min ?? "see Unit"}</span>
              <span className="text-muted">Credited after</span><span className="num text-right">{q.data.confirmations ?? "chain finality"}</span>
              <span className="text-muted">Fee</span><span className="num text-right">{q.data.fee ?? "network fee, set by Unit"}</span>
              <span className="text-muted">Guardian signatures</span><span className="num text-right">{q.data.signatures} of 3{q.data.mock ? " · mock" : ""}</span>
            </div>
          </>
        )}
      </div>
      {q.data && (
        <div className={`mt-3 card-2 p-3 text-xs ${arrived > 0 ? "border-up/60" : ""}`} data-testid="unit-arrival">
          <div className="flex items-center justify-between">
            <span className="text-muted">Your {asset} on Hyperliquid spot</span>
            <span className="num font-semibold">{have === null ? "…" : `${have.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`}</span>
          </div>
          {arrived > 0 ? (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-up"><Icon.check /> {arrived.toLocaleString(undefined, { maximumFractionDigits: 6 })} {asset} arrived. It sits in your Hyperliquid spot balance.</div>
          ) : (
            <div className="mt-1.5 text-dim animate-pulse">Watching for a deposit… it shows here {q.data.confirmations ? `about ${q.data.confirmations.replace(/^~/, "")} after you send` : "once Unit credits it"}.</div>
          )}
          <div className="mt-1.5 text-dim leading-snug">To trade perps with it, sell {asset} for USDC on <a className="text-brand hover:underline" href={`${HL_APP_URL_CLIENT}/trade`} target="_blank" rel="noreferrer">Hyperliquid spot</a> ({asset}/USDC), then it is margin here.</div>
          {mine.length > 0 && (
            <ul className="mt-2 border-t border-line pt-2 space-y-1" data-testid="unit-ops">
              {mine.map((o) => <OpRow key={o.id} o={o} />)}
            </ul>
          )}
          {ops.data && mine.length === 0 && <div className="mt-2 border-t border-line pt-2 text-dim">Unit has no {asset} deposit on record for this account yet. It appears here once the Solana transaction is seen.</div>}
          {ops.error && <div className="mt-2 border-t border-line pt-2 text-dim">Unit&apos;s deposit tracker is not answering right now; the balance above still updates on its own.</div>}
        </div>
      )}
      {q.data && (
        <div className="mt-3 rounded-md border border-down/60 bg-down/10 p-3 text-[12px] leading-snug text-down" role="alert" data-testid="unit-important">
          <b>IMPORTANT:</b> There is a minimum deposit of <b>{q.data.min}</b>. This address can only receive <b>{asset}</b> on the <b>{q.data.chainLabel}</b> network. Any other asset sent to it will be lost. Deposits below {q.data.min} will result in a loss of funds.
        </div>
      )}
      <p className="text-[11px] text-dim mt-3 leading-snug">
        Native deposits run on Unit, the same rails as Hyperliquid&apos;s own dialog, and land in your Hyperliquid <b>spot</b> balance. Sell for USDC on Hyperliquid spot to use it as perps margin. Below the minimum is not credited. Verify the address any time at <a className="text-brand hover:underline" href={`${UNIT_APP_URL}/?asset=${asset.toLowerCase()}`} target="_blank" rel="noreferrer">app.hyperunit.xyz</a>.
      </p>
    </>
  );
}
