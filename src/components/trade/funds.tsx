"use client";
/**
 * in-app deposit and withdrawal. funds move wallet ⇄ hyperliquid directly; socialLiquid signs nothing and holds nothing.
 * both sides mirror hyperliquid's own dialogs: an asset (USDC or a native asset through Unit) and, for USDC, a chain
 * (Arbitrum via CCTP, the legacy bridge, HyperEVM, the other CCTP chains; deposits also offer the USDT swap).
 * styles: the ticket's modal language (ticket.css, .tm-tk-*) and the dialog's own parts (funds.css, .tm-fd-*).
 */
import "./ticket.css";
import "./funds.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAccount, useChainId, useReadContract, useWalletClient } from "wagmi";
import { isPhantomWallet } from "@/hooks/use-signer";
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
  PHANTOM_CHAINS,
  PHANTOM_HINT,
  markPhantomWallet,
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
import { cents, usdcSpotAvail } from "@/lib/spot";
import { UNIT_APP_URL, UNIT_ASSETS, fetchUnitAddress, fetchUnitOperations, fetchUnitWithdrawAddress, looksLikeAddress, minNumber, spotEntry, unitDepositable, unitStateLabel, unitWithdrawable, type UnitAddress, type UnitAsset, type UnitOperation } from "@/lib/unit";
import QRCode from "qrcode";
import type { wagmiConfig } from "@/lib/wagmi";
import { CoinIcon } from "../ui";
import { openConvert } from "./convert";
import { TkChain, TkClose, TkIcon, TkModal, TkMsg, TkNum, TkPicker, TkPickStatic, TkRoute, type TkPickOption } from "./tk-bits";

/* the ticket region's icon set and number field moved to ./tk-bits; ticket.tsx and trade-panel.tsx import them from here */
export { TkIcon, TkNum, groupDigits } from "./tk-bits";

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
  const close = useCallback(() => setMode(null), []);
  if (!mode) return null;
  // the dialog portals itself to the body (TkModal) so no ancestor's stacking context can sit above the overlay
  return <FundsModal mode={mode} address={address} onClose={close} onMode={setMode} />;
}

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "sent"; hash: string | null; explorer: string; text: string } | { kind: "done"; text: string } | { kind: "error"; text: string };
const USDC = "USDC";

function FundsModal({ mode, address, onClose, onMode }: { mode: FundsMode; address: string; onClose: () => void; onMode: (m: FundsMode) => void }) {
  const { me } = useAuth();
  const mockMode = me?.network === "mock";
  const { data: wallet } = useWalletClient();
  const chainId = useChainId();
  const { connector } = useAccount();
  // Phantom's EVM side only shows Ethereum, Base and Polygon; asking it for anything else opens its "Unsupported network" screen
  const phantom = isPhantomWallet(connector?.name);
  useEffect(() => {
    markPhantomWallet(phantom);
  }, [phantom]);
  const canSwitchTo = (id: number) => !phantom || PHANTOM_CHAINS.has(id);
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
  const startSpotUsdc = useRef<number | null>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const destRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const perpsAvail = bal.data ? Math.max(0, bal.data.withdrawable) : 0;
  const spotUsdcAvail = usdcSpotAvail(bal.data?.spot);
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
      setPhase({ kind: "done", text: `${fmtUsd(bal.data.withdrawable - startBal.current)} credited to your Hyperliquid perps balance. Ready to trade.` });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } else if (startSpotUsdc.current !== null && usdcSpotAvail(bal.data.spot) > startSpotUsdc.current + 0.01) {
      setPhase({ kind: "done", text: `${fmtUsd(usdcSpotAvail(bal.data.spot) - startSpotUsdc.current)} arrived in your Hyperliquid spot balance. Move it to perps below to trade with it.` });
      qc.invalidateQueries({ queryKey: ["balance"] });
    }
  }, [bal.data, phase.kind, mode, qc]);

  // a pointer user lands in the amount; a touch user is not ambushed by the keyboard
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) amtRef.current?.focus({ preventScroll: true });
  }, [mode]);

  // what the amount is in, where it can go, and how much of it there is
  const symbol = mode === "deposit" ? route.symbol : nativeW ? asset : USDC;
  const destLocked = mode === "withdraw" && !nativeW && wRoute.kind === "hyperevm";
  const effDest = destLocked ? address : dest;
  const destOk = mode === "deposit" ? true : nativeW ? !!unitInfo && looksLikeAddress(unitInfo.chain, dest) : /^0x[0-9a-fA-F]{40}$/.test(effDest);
  const max = mode === "deposit" ? walletBal : nativeW ? (spotBal ? Math.max(0, spotBal.total - spotBal.hold) : bal.data?.spot ? 0 : null) : bal.data ? perpsAvail + spotUsdcAvail : null;
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
        startSpotUsdc.current = usdcSpotAvail(bal.data?.spot);
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
        // USDC can sit in perps or spot; take it from wherever it is, moving between the two only when needed
        const fromSpot = Math.max(0, amt - perpsAvail);
        if (mockMode) {
          if (fromSpot > 0.001) await api("/api/mock/funds", { method: "POST", json: { kind: "class-transfer", amount: Number(cents(fromSpot)), toPerp: true } });
          await api("/api/mock/funds", { method: "POST", json: { kind: "withdraw", amount: amt } });
        } else {
          if (!wallet) throw new Error("wallet not connected");
          if (wRoute.kind === "bridge") {
            if (fromSpot > 0.001) {
              step(`1 of 2 · Confirm moving ${fmtUsd(fromSpot)} from spot to perps…`);
              await usdClassTransferWithWallet(wallet, chainId, cents(fromSpot), true);
              step("2 of 2 · Confirm the withdrawal in your wallet…");
            } else step("Confirm the withdrawal in your wallet…");
            await withdrawWithWallet(wallet, chainId, effDest, amountStr);
          } else if (wRoute.kind === "hyperevm") {
            const { tokens } = await api<{ tokens: Record<string, { tokenId: string }> }>("/api/funds/tokens?names=USDC");
            if (!tokens.USDC) throw new Error("USDC is missing from Hyperliquid's spot token list; nothing was sent");
            const needFromPerps = Math.max(0, amt - spotUsdcAvail);
            if (needFromPerps > 0.001) {
              step(`1 of 2 · Confirm moving ${fmtUsd(needFromPerps)} from perps to spot…`);
              await usdClassTransferWithWallet(wallet, chainId, cents(needFromPerps), false);
              step("2 of 2 · Confirm sending it to HyperEVM…");
            } else step("Confirm sending it to HyperEVM…");
            await spotSendWithWallet(wallet, chainId, USDC_SYSTEM_ADDRESS, `USDC:${tokens.USDC.tokenId}`, amountStr);
          } else if (amt <= perpsAvail + 1e-9) {
            step("Confirm the withdrawal in your wallet…");
            await sendToEvmWithWallet(wallet, chainId, { amount: amountStr, destination: effDest, domain: wRoute.domain! });
          } else if (amt <= spotUsdcAvail + 1e-9) {
            step("Confirm the withdrawal (from your spot balance) in your wallet…");
            await sendToEvmWithWallet(wallet, chainId, { amount: amountStr, destination: effDest, domain: wRoute.domain!, sourceDex: "spot" });
          } else {
            step(`1 of 2 · Confirm moving ${fmtUsd(fromSpot)} from spot to perps…`);
            await usdClassTransferWithWallet(wallet, chainId, cents(fromSpot), true);
            step("2 of 2 · Confirm the withdrawal in your wallet…");
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

  /* ---------- presentation ---------- */
  const deposit = mode === "deposit";
  const moving = busy || phase.kind === "sent";
  const ctaOff = !valid || (!mockMode && !wallet) || (deposit && !canSwitchTo(route.chain.id));
  /** dollars (USDC, USDT) get the $ sign; coins (SOL, BTC, ETH) are counted in their own unit */
  const usdAmount = !nativeW;
  const destIsMe = !nativeW && effDest.toLowerCase() === address.toLowerCase();
  const title = `${deposit ? "Deposit" : "Withdraw"} ${asset}`;
  const subline = deposit
    ? isUsdc
      ? route.kind === "swap"
        ? "USDT from your wallet on Arbitrum, swapped for USDC, straight into your Hyperliquid perps balance."
        : `From your wallet on ${route.chain.name} straight into your Hyperliquid perps balance.`
      : unitInfo && unitDepositable(unitInfo)
        ? `Send ${asset} on ${unitInfo.chainLabel} to your own Unit address. It lands in your Hyperliquid spot balance.`
        : `${asset} deposits go through Unit's own dialog for now.`
    : nativeW
      ? unitInfo && unitWithdrawable(unitInfo)
        ? `From your Hyperliquid spot balance to a ${unitInfo.chainLabel} address, through Unit.`
        : `${asset} withdrawals go through Unit's own dialog for now.`
      : `From your Hyperliquid balance to ${destIsMe ? "your wallet" : "an address"} on ${wRoute.chain.name}.`;
  const sub = !(amt > 0)
    ? `Min ${min} ${symbol}`
    : deposit
      ? cctpRoute
        ? `≈ ${fmtUsd(Math.max(0, amt - feeUsd))} into perps after the ${feeUsd.toFixed(2)} USDC fee`
        : `≈ ${fmtUsd(amt)} into perps · ${route.eta}`
      : nativeW
        ? `${amountStr} ${asset}, minus Unit's network fee`
        : wRoute.fee > 0
          ? `You receive ${fmtUsd(Math.max(0, amt - wRoute.fee))} after the ${fmtUsd(wRoute.fee)} fee`
          : `You receive ${fmtUsd(amt)} · no fee`;

  const assetOptions: TkPickOption[] = [
    { value: USDC, text: USDC, icon: <CoinIcon coin={USDC} size={22} />, sub: `${deposit ? DEPOSIT_ROUTES.length : WITHDRAW_ROUTES.length} routes` },
    // hyperliquid's own order; the ones without a verified minimum run in Unit's app (they keep their place at the end)
    ...UNIT_ASSETS.map((a) => ({
      value: a.symbol,
      text: a.symbol,
      icon: <CoinIcon coin={a.symbol} size={22} />,
      sub: a.chainLabel,
      section: (deposit ? unitDepositable(a) : unitWithdrawable(a)) ? undefined : "Through Unit's app",
    })),
  ];
  const routeOptions: TkPickOption[] = DEPOSIT_ROUTES.map((r) => ({
    value: r.id,
    text: r.label,
    icon: <TkChain name={r.label} size={20} />,
    sub: `${r.fee === "none" ? "no fee" : r.fee} · ${r.eta}`,
    tag: canSwitchTo(r.chain.id) ? undefined : (
      <span className="tm-fd-tag" data-tone="warn">
        not in Phantom
      </span>
    ),
  }));
  const wRouteOptions: TkPickOption[] = WITHDRAW_ROUTES.map((r) => ({
    value: r.id,
    text: r.label,
    icon: <TkChain name={r.label} size={20} />,
    sub: `${r.fee > 0 ? r.feeLabel : "no fee"} · ${r.eta}`,
  }));

  return (
    <TkModal labelledBy={`${uid}-t`} onClose={onClose}>
      <div className="tm-tk-modal-head">
        <span className="seg" aria-label="Direction">
          {(["deposit", "withdraw"] as FundsMode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={`seg-item capitalize ${mode === m ? "seg-active" : ""}`}
              onClick={() => {
                onMode(m);
                setDest(isUsdc ? address : "");
                reset();
              }}
            >
              {m === "deposit" ? <TkIcon.down size={13} /> : <TkIcon.up size={13} />}
              {m}
            </button>
          ))}
        </span>
        <TkClose onClose={onClose} />
      </div>

      <h2 id={`${uid}-t`} className="tm-tk-modal-title">
        {title}
      </h2>
      <p className="tm-tk-modal-sub">{subline}</p>

      <div className="tm-fd-picks">
        <TkPicker
          label="Asset"
          listLabel="asset"
          value={asset}
          options={assetOptions}
          onPick={pickAsset}
          disabled={busy}
          grid
          face={
            <>
              <CoinIcon coin={asset} size={20} />
              <span className="tm-fd-pick-t">{asset}</span>
            </>
          }
        />
        {!isUsdc ? (
          <TkPickStatic label={deposit ? "Deposit chain" : "Withdrawal chain"}>
            <TkChain name={unitInfo?.chainLabel ?? ""} size={18} />
            <span className="tm-fd-pick-t">{unitInfo?.chainLabel}</span>
          </TkPickStatic>
        ) : deposit ? (
          <TkPicker
            label="Deposit chain"
            listLabel="deposit chain"
            value={routeId}
            options={routeOptions}
            onPick={(v) => {
              setRouteId(v);
              reset();
            }}
            disabled={busy}
          />
        ) : (
          <TkPicker
            label="Withdrawal chain"
            listLabel="withdrawal chain"
            value={wRouteId}
            options={wRouteOptions}
            onPick={(v) => {
              setWRouteId(v);
              reset();
            }}
            disabled={busy}
          />
        )}
      </div>

      {deposit && !isUsdc ? (
        unitInfo && !unitDepositable(unitInfo) ? (
          <UnitLinkPanel mode="deposit" asset={unitInfo.symbol} chainLabel={unitInfo.chainLabel} />
        ) : (
          <UnitPanel asset={unitInfo!} q={unit} spot={bal.data?.spot} copied={copied} onCopy={copy} hlAddress={address} />
        )
      ) : nativeW && unitInfo && !unitWithdrawable(unitInfo) ? (
        <UnitLinkPanel mode="withdraw" asset={unitInfo.symbol} chainLabel={unitInfo.chainLabel} />
      ) : (
        <>
          <TkRoute
            from={deposit ? { name: "Wallet", sub: route.chain.name, tone: "peri" } : { name: "Hyperliquid", sub: nativeW ? "Spot" : undefined }}
            to={deposit ? { name: "Hyperliquid", sub: "Perps" } : { name: destIsMe ? "Wallet" : "Address", sub: chainName, tone: "peri" }}
            moving={moving}
          />

          <dl className="tm-tk-bal">
            {deposit ? (
              <>
                <div>
                  <dt>
                    {route.symbol} in wallet · {route.chain.name}
                  </dt>
                  <dd>{mockMode ? "mock" : walletBal === null ? "…" : <b>{fmtUsd(walletBal)}</b>}</dd>
                </div>
                <div>
                  <dt>Hyperliquid balance</dt>
                  <dd>{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</dd>
                </div>
                <div>
                  <dt>Fee</dt>
                  <dd>{cctpRoute && amt > 0 ? `${feeUsd.toFixed(2)} USDC` : route.fee}</dd>
                </div>
                <div>
                  <dt>Arrives</dt>
                  <dd>{cctpRoute ? (fastBps !== null ? "seconds" : "~15 min (standard)") : route.eta}</dd>
                </div>
                {cctpRoute && fee.data !== null && fee.data !== undefined && (
                  <div className="tm-fd-fast">
                    <dt>
                      Fast transfer <small>+{(fee.data / 100).toFixed(2)}% paid to Circle</small>
                    </dt>
                    <dd>
                      <button type="button" role="switch" aria-checked={fast} aria-label={`Fast transfer · +${(fee.data / 100).toFixed(2)}% paid to Circle`} className="switch" onClick={() => setFast((v) => !v)} disabled={busy} />
                    </dd>
                  </div>
                )}
              </>
            ) : nativeW ? (
              <>
                <div>
                  <dt>{asset} on Hyperliquid spot</dt>
                  <dd>{max === null ? "…" : <b>{`${max.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`}</b>}</dd>
                </div>
                <div>
                  <dt>Minimum withdrawal</dt>
                  <dd>{unitInfo?.withdrawMin}</dd>
                </div>
                <div>
                  <dt>Fee</dt>
                  <dd>Unit&apos;s network fee, deducted</dd>
                </div>
                <div>
                  <dt>Arrives</dt>
                  <dd>about 4 minutes</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>Available to withdraw</dt>
                  <dd>
                    {bal.data ? <b>{fmtUsd(perpsAvail + spotUsdcAvail)}</b> : "…"}
                    {bal.data && spotUsdcAvail > 0.01 && (
                      <span className="tm-fd-split">
                        {" "}
                        · perps {fmtUsd(perpsAvail)} + spot {fmtUsd(spotUsdcAvail)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Fee</dt>
                  <dd>{wRoute.feeLabel}</dd>
                </div>
                <div>
                  <dt>Arrives</dt>
                  <dd>{wRoute.eta}</dd>
                </div>
              </>
            )}
          </dl>

          <div className="tm-tk-size" onClick={() => amtRef.current?.focus()}>
            <div className="tm-tk-size-head">
              <label htmlFor={`${uid}-a`} className="tm-tk-size-label">
                Amount
              </label>
              {max !== null && (
                <button
                  type="button"
                  className="tm-tk-max"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAmount(String(nativeW ? Math.floor(max * 1e6) / 1e6 : Math.floor(max * 100) / 100));
                  }}
                  disabled={busy}
                >
                  Max <b>{usdAmount ? fmtUsd(max) : `${max.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`}</b>
                </button>
              )}
            </div>
            <div className="tm-tk-size-main">
              {usdAmount && (
                <span className="tm-tk-size-cur" data-on={!!amount} aria-hidden>
                  $
                </span>
              )}
              <TkNum
                id={`${uid}-a`}
                ref={amtRef}
                className="tm-tk-size-input"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onValue={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
                disabled={busy}
                autoComplete="off"
              />
              <span className="tm-tk-unit" aria-hidden>
                {symbol}
              </span>
            </div>
            <div className="tm-tk-size-sub">{sub}</div>
          </div>

          {mode === "withdraw" && (
            <div className="tm-tk-size tm-tk-dest" data-locked={destLocked || undefined} onClick={() => destRef.current?.focus()}>
              <div className="tm-tk-size-head">
                <label htmlFor={`${uid}-d`} className="tm-tk-size-label">
                  Destination
                </label>
                <span className="tm-tk-ref">
                  {destLocked && <TkIcon.lock size={10} sw={2.2} />}
                  {destIsMe ? `This wallet · ${chainName}` : `${chainName} address`}
                </span>
              </div>
              <input
                id={`${uid}-d`}
                ref={destRef}
                className="tm-tk-input tm-tk-input-mono tm-tk-dest-input"
                value={effDest}
                onChange={(e) => setDest(e.target.value.trim())}
                disabled={busy || destLocked}
                spellCheck={false}
                autoComplete="off"
                placeholder={nativeW ? `Your ${chainName} address` : "0x…"}
                aria-label="destination"
                aria-invalid={(!!dest && !destOk && !destLocked) || undefined}
              />
            </div>
          )}
          {mode === "withdraw" && destLocked && (
            <p className="tm-fd-note">
              <TkIcon.info size={12} sw={2} />
              <span>USDC can only leave to HyperEVM at this same address. Send it on from there.</span>
            </p>
          )}
          {mode === "withdraw" && dest && !destOk && !destLocked && <TkMsg tone="warn">That is not a valid {chainName} address.</TkMsg>}
          {mode === "deposit" && !canSwitchTo(route.chain.id) && (
            <TkMsg tone="warn" testid="phantom-route-warning">
              Phantom cannot switch to {route.chain.name}. {PHANTOM_HINT}: pick Ethereum, Base or Polygon, or connect MetaMask or Rabby for this route.
            </TkMsg>
          )}
          {amt > 0 && amt < min && (
            <TkMsg tone="warn">
              Minimum {mode === "deposit" ? "deposit" : "withdrawal"} is {min} {symbol}.
            </TkMsg>
          )}
          {max !== null && amt > max + 1e-9 && <TkMsg tone="warn">That is more than you have available.</TkMsg>}
          {/* the loss warning sits above the button: it is read before anything is signed */}
          {nativeW && unitInfo && (
            <div className="tm-fd-danger" role="alert" data-testid="unit-important">
              <TkIcon.alert size={15} sw={2} />
              <p>
                <b>IMPORTANT:</b> There is a minimum withdrawal of <b>{unitInfo.withdrawMin}</b>. The destination must be a <b>{unitInfo.chainLabel}</b> address that you control. {asset} sent to an address on any other network, or below the minimum, will be lost.
              </p>
            </div>
          )}

          {phase.kind === "idle" || phase.kind === "error" ? (
            <button type="button" className={`btn btn-primary tm-tk-cta ${ctaOff ? "" : "btn-glow"}`} onClick={run} disabled={ctaOff}>
              {deposit ? wrongChain ? <TkIcon.swap size={15} /> : <TkIcon.down size={15} /> : <TkIcon.up size={15} />}
              <span className="tm-fd-cta-t">{buttonLabel}</span>
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
                  <TkIcon.check size={15} sw={2.2} /> {phase.kind === "done" ? "Done" : "Sent"}
                </>
              )}
            </div>
          )}
          {phase.kind !== "idle" && phase.kind !== "busy" && (
            <p className="tm-tk-msg" data-tone={phase.kind === "error" ? "err" : "ok"} role={phase.kind === "error" ? "alert" : "status"}>
              {phase.kind === "error" ? <TkIcon.alert size={13} /> : phase.kind === "sent" && mode === "deposit" ? <i className="tm-fd-live" aria-hidden /> : <TkIcon.check size={13} />}
              <span>
                {phase.text}
                {phase.kind === "sent" && phase.hash && phase.explorer && (
                  <>
                    {" "}
                    <a className="underline underline-offset-2" href={`${phase.explorer}/tx/${phase.hash}`} target="_blank" rel="noreferrer">
                      View transaction
                    </a>
                    .
                  </>
                )}
                {phase.kind === "sent" && mode === "deposit" && <> Waiting for Hyperliquid to credit it…</>}
              </span>
            </p>
          )}
          {mode === "deposit" && spotUsdcAvail > 0.01 && (
            <button
              type="button"
              className="tm-fd-spot"
              onClick={() => {
                onClose();
                openConvert("USDC");
              }}
              data-testid="move-spot-usdc"
            >
              <i className="tm-fd-spot-dot" aria-hidden />
              <span className="tm-fd-spot-t">
                <b>{fmtUsd(spotUsdcAvail)} USDC</b> is in your spot balance
              </span>
              <span className="tm-fd-spot-act">
                Move it to perps
                <TkIcon.arrow size={12} sw={2.2} />
              </span>
            </button>
          )}

          <p className="tm-tk-modal-foot">
            {mode === "deposit" ? (
              <RouteNote kind={route.kind} />
            ) : nativeW ? (
              <>
                Signed by your main wallet, never by the trading agent. Your {asset} goes to Unit&apos;s guardians on Hyperliquid, who pay it out on {chainName}, the same rails as Hyperliquid&apos;s own withdrawal dialog.
              </>
            ) : (
              <WithdrawNote kind={wRoute.kind} chain={wRoute.chain.name} />
            )}
          </p>
        </>
      )}
    </TkModal>
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
      return (
        <>
          Circle&apos;s CCTP burns the USDC on the source chain and its forwarder credits your Hyperliquid perps balance. The {CCTP_FORWARD_FEE} USDC fee is Circle&apos;s, the same route and fee Hyperliquid&apos;s own deposit uses. socialLiquid never holds funds. Other chains?{" "}
          <a href={`${HL_APP_URL_CLIENT}/trade`} target="_blank" rel="noreferrer">
            Hyperliquid&apos;s dialog
          </a>{" "}
          lists the same routes.
        </>
      );
  }
}

type UnitQ = { data?: UnitAddress; isLoading: boolean; error: Error | null; refetch: () => void };

/** what to send from where, per chain */
function sendHint(asset: string, chain: string) {
  switch (chain) {
    case "solana":
      return (
        <>
          From Phantom, Solflare, Backpack or an exchange: send <b>{asset}</b> on Solana mainnet to this address. {asset === "SOL" ? "Plain SOL only, not wrapped SOL or an SPL token." : `The ${asset} SPL token only.`}
        </>
      );
    case "bitcoin":
      return <>Send BTC on the Bitcoin network to this address. Not Lightning, not wrapped BTC on another chain.</>;
    case "ethereum":
      return <>Send ETH on Ethereum mainnet to this address. Not from an L2, not WETH.</>;
    default:
      return (
        <>
          Send only <b>{asset}</b> on its native chain to this address.
        </>
      );
  }
}

/** one Unit operation: amount, state in plain words, time */
function OpRow({ o }: { o: UnitOperation }) {
  const st = unitStateLabel(o.state);
  const when = o.createdAt ? new Date(o.createdAt) : null;
  const tone = st.done ? "up" : /^failed/i.test(st.text) ? "down" : "warn";
  return (
    <li className="tm-fd-op">
      <span className="num">
        {o.sourceAmount ?? o.destinationAmount ?? "…"} {o.asset}
      </span>
      <span className="tm-fd-op-state" data-tone={tone}>
        {tone === "warn" && <i className="tm-fd-live" data-tone="warn" aria-hidden />}
        {st.text}
      </span>
      <span className="tm-fd-op-time num">{when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
    </li>
  );
}

/** an asset whose minimum deposit we could not verify: no address in-app, Unit's own dialog instead */
function UnitLinkPanel({ mode, asset, chainLabel }: { mode: FundsMode; asset: string; chainLabel: string }) {
  const verb = mode === "deposit" ? "deposit" : "withdrawal";
  return (
    <div className="tm-fd-linkout" data-testid="unit-link">
      <div className="tm-fd-linkout-head">
        <CoinIcon coin={asset} size={28} />
        <span>
          <b>{asset}</b>
          <small>
            {chainLabel} · through Unit&apos;s app
          </small>
        </span>
      </div>
      <p>
        Unit sets a minimum {verb} for {asset} on {chainLabel} and anything below it is lost. We do not have that minimum verified yet, so for {asset} use Unit&apos;s own dialog, which shows it next to the address.{mode === "deposit" ? " It still lands in your Hyperliquid spot balance." : ""}
      </p>
      <a className="btn btn-primary btn-glow tm-fd-linkout-go" href={`${UNIT_APP_URL}/?asset=${asset.toLowerCase()}`} target="_blank" rel="noreferrer">
        {mode === "deposit" ? "Deposit" : "Withdraw"} {asset} on Unit
        <TkIcon.ext size={13} sw={2} />
      </a>
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
    QRCode.toDataURL(addr, { margin: 1, width: 192, errorCorrectionLevel: "M" })
      .then((u) => live && setQr(u))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [addr]);
  return (
    <>
      <TkRoute from={{ name: "Wallet", sub: info.chainLabel, tone: "peri" }} to={{ name: "Hyperliquid", sub: "Spot" }} />
      <div className="tm-fd-unit">
        {q.isLoading && (
          <div className="tm-fd-loading" role="status">
            <span className="skeleton tm-fd-loading-qr" aria-hidden />
            <span className="tm-fd-loading-lines">
              <span className="skeleton" aria-hidden />
              <span className="skeleton" aria-hidden />
              <span className="tm-fd-loading-t">Asking Unit&apos;s guardians for your {asset} address…</span>
            </span>
          </div>
        )}
        {q.error && (
          <p className="tm-tk-msg" data-tone="err" role="alert">
            <TkIcon.alert size={13} />
            <span className="min-w-0">{q.error.message}</span>
            <button type="button" className="tm-fd-retry" onClick={() => q.refetch()}>
              <TkIcon.retry size={12} sw={2} />
              Retry
            </button>
          </p>
        )}
        {q.data && (
          <>
            <p className="tm-fd-hint">
              {sendHint(asset, q.data.chain)} It is yours: Unit derived it for your Hyperliquid account.
            </p>
            <div className="tm-fd-addr">
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt={`QR code of your ${asset} deposit address`} width={104} height={104} className="tm-fd-qr" data-testid="unit-qr" />
              )}
              <div className="tm-fd-addr-main">
                <span className="tm-fd-addr-k">
                  Your {asset} address · {q.data.chainLabel}
                </span>
                <code className="tm-fd-code" data-testid="unit-address">
                  {q.data.address}
                </code>
                <button type="button" className={`btn btn-primary tm-fd-copy ${copied ? "" : "btn-glow"}`} data-copied={copied || undefined} onClick={() => onCopy(q.data!.address)} data-testid="unit-copy">
                  {copied ? (
                    <>
                      <TkIcon.check size={14} sw={2.4} />
                      Copied
                    </>
                  ) : (
                    <>
                      <TkIcon.copy size={14} />
                      Copy address
                    </>
                  )}
                </button>
              </div>
            </div>
            <dl className="tm-tk-bal tm-fd-facts">
              <div>
                <dt>Minimum</dt>
                <dd>
                  <b>{q.data.min ?? "see Unit"}</b>
                </dd>
              </div>
              <div>
                <dt>Credited after</dt>
                <dd>{q.data.confirmations ?? "chain finality"}</dd>
              </div>
              <div>
                <dt>Fee</dt>
                <dd>{q.data.fee ?? "network fee, set by Unit"}</dd>
              </div>
              <div>
                <dt>Guardian signatures</dt>
                <dd className="tm-fd-sigs">
                  <TkIcon.shield size={12} sw={2} />
                  {q.data.signatures} of 3{q.data.mock ? " · mock" : ""}
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
      {q.data && (
        <div className="tm-fd-danger" role="alert" data-testid="unit-important">
          <TkIcon.alert size={15} sw={2} />
          <p>
            <b>IMPORTANT:</b> There is a minimum deposit of <b>{q.data.min}</b>. This address can only receive <b>{asset}</b> on the <b>{q.data.chainLabel}</b> network. Any other asset sent to it will be lost. Deposits below {q.data.min} will result in a loss of funds.
          </p>
        </div>
      )}
      {q.data && (
        <div className="tm-fd-watch" data-arrived={arrived > 0 || undefined} data-testid="unit-arrival">
          <div className="tm-fd-watch-head">
            <span className="tm-fd-watch-k">
              {arrived > 0 ? <TkIcon.check size={13} sw={2.4} /> : <i className="tm-fd-live" aria-hidden />}
              Your {asset} on Hyperliquid spot
            </span>
            <span className="tm-fd-watch-v num">{have === null ? "…" : `${have.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`}</span>
          </div>
          {arrived > 0 ? (
            <p className="tm-fd-watch-ok">
              {arrived.toLocaleString(undefined, { maximumFractionDigits: 6 })} {asset} arrived. It sits in your Hyperliquid spot balance.
            </p>
          ) : (
            <p className="tm-fd-watch-wait">Watching for a deposit… it shows here {q.data.confirmations ? `about ${q.data.confirmations.replace(/^~/, "")} after you send` : "once Unit credits it"}.</p>
          )}
          <p className="tm-fd-watch-sell">
            To trade perps with it,{" "}
            <button type="button" className="tm-fd-link" onClick={() => openConvert(info.spotCoin ?? asset)}>
              sell {asset} for USDC
            </button>
            : a market sell on Hyperliquid spot, then the USDC moves to your perps balance.
          </p>
          {mine.length > 0 && (
            <ul className="tm-fd-ops" data-testid="unit-ops">
              {mine.map((o) => (
                <OpRow key={o.id} o={o} />
              ))}
            </ul>
          )}
          {ops.data && mine.length === 0 && (
            <p className="tm-fd-ops-none">
              Unit has no {asset} deposit on record for this account yet. It appears here once the {q.data.chainLabel} transaction is seen.
            </p>
          )}
          {ops.error && <p className="tm-fd-ops-none">Unit&apos;s deposit tracker is not answering right now; the balance above still updates on its own.</p>}
        </div>
      )}
      <p className="tm-tk-modal-foot">
        Native deposits run on Unit, the same rails as Hyperliquid&apos;s own dialog, and land in your Hyperliquid <b>spot</b> balance. Sell for USDC on Hyperliquid spot to use it as perps margin. Below the minimum is not credited. Verify the address any time at{" "}
        <a href={`${UNIT_APP_URL}/?asset=${asset.toLowerCase()}`} target="_blank" rel="noreferrer">
          app.hyperunit.xyz
        </a>
        .
      </p>
    </>
  );
}
