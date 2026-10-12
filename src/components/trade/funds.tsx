"use client";
/** in-app deposit and withdrawal. funds move wallet ⇄ hyperliquid directly; socialLiquid signs nothing and holds nothing. */
import "./ticket.css";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { useChainId, useReadContract, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { fmtUsd } from "@/lib/format";
import { withdrawWithWallet } from "@/lib/hl-client";
import { DEPOSIT_CHAIN, EXPLORER, MIN_DEPOSIT, MIN_WITHDRAW, USDC_ADDRESS, WITHDRAW_FEE, depositWithWallet } from "@/lib/funds";

export type FundsMode = "deposit" | "withdraw";
const EVT = "sl:funds";

/* ---------- icons for the ticket region (inline, rounded, 24 grid) ---------- */
type IcoProps = { size?: number; sw?: number; className?: string };
function Svg({ size = 14, sw = 1.8, className, children }: IcoProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}
export const TkIcon = {
  pen: (p: IcoProps) => <Svg {...p}><path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>,
  lock: (p: IcoProps) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  swap: (p: IcoProps) => <Svg {...p}><path d="M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8" /></Svg>,
  key: (p: IcoProps) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="m10.9 12.1 8.6-8.6M16.5 6.5l2.5 2.5M14 9l2 2" /></Svg>,
  ticket: (p: IcoProps) => <Svg {...p}><path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z" /><path d="M14 6.5v2M14 11v2M14 15.5v2" /></Svg>,
  at: (p: IcoProps) => <Svg {...p}><circle cx="12" cy="12" r="3.6" /><path d="M15.6 8.4v4.8a2.7 2.7 0 0 0 5.4 0V12a9 9 0 1 0-3.6 7.2" /></Svg>,
  bolt: (p: IcoProps) => <Svg {...p}><path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12z" /></Svg>,
  down: (p: IcoProps) => <Svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Svg>,
  up: (p: IcoProps) => <Svg {...p}><path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" /></Svg>,
  close: (p: IcoProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  check: (p: IcoProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7" /></Svg>,
  alert: (p: IcoProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.2M12 16.4v.1" /></Svg>,
  spin: (p: IcoProps) => <Svg {...p}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></Svg>,
  arrow: (p: IcoProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>,
  minus: (p: IcoProps) => <Svg {...p}><path d="M6 12h12" /></Svg>,
  plus: (p: IcoProps) => <Svg {...p}><path d="M12 6v12M6 12h12" /></Svg>,
  chev: (p: IcoProps) => <Svg {...p}><path d="m7 10 5 5 5-5" /></Svg>,
};

/* ---------- numbers that read like the mock: "$12,500", "112,231.1" ---------- */
/** groups the integer part of a typed number for reading; anything that is not a plain number is left alone */
export const groupDigits = (raw: string) => raw.replace(/^\d+/, (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ","));

/** a numeric field that shows grouped digits at rest and the raw value while it is being edited,
    so typing, the caret and the value the order is built from are exactly what they were */
export function TkNum({ value, onValue, ref, onFocus, onBlur, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onValue: (v: string) => void; ref?: Ref<HTMLInputElement> }) {
  const [editing, setEditing] = useState(false);
  return (
    <input
      {...rest}
      ref={ref}
      value={editing ? value : groupDigits(value)}
      onChange={(e) => onValue(e.target.value)}
      onFocus={(e) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setEditing(false);
        onBlur?.(e);
      }}
    />
  );
}

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
  // portalled to the body so no ancestor's stacking context can sit above the overlay
  return createPortal(<FundsModal mode={mode} address={address} onClose={() => setMode(null)} onMode={setMode} />, document.body);
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
  const amtRef = useRef<HTMLInputElement>(null);
  const uid = useId();
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

  // focus goes back to whatever opened the modal (the ticket's Deposit button, the account menu)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const boxRef = useRef<HTMLDivElement>(null);
  /** tab stays inside the dialog */
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !boxRef.current) return;
    const items = [...boxRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]")].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !boxRef.current.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // a pointer user lands in the amount; a touch user is not ambushed by the keyboard
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) amtRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const max = mode === "deposit" ? walletUsdc : bal.data ? Math.max(0, bal.data.withdrawable) : null;
  const min = mode === "deposit" ? MIN_DEPOSIT : MIN_WITHDRAW;
  const valid = amt >= min && (max === null || amt <= max + 1e-9) && (mode === "deposit" || /^0x[0-9a-fA-F]{40}$/.test(dest));
  const busy = phase.kind === "busy";
  const deposit = mode === "deposit";

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

  const wallEnd = (
    <span className="tm-tk-route-end">
      <i className="tm-tk-route-dot" data-tone="peri" />
      Wallet <small>{DEPOSIT_CHAIN.name}</small>
    </span>
  );
  const hlEnd = (
    <span className="tm-tk-route-end">
      <i className="tm-tk-route-dot" />
      Hyperliquid
    </span>
  );
  const moving = busy || phase.kind === "sent";
  const sub =
    amt > 0
      ? deposit
        ? `≈ ${fmtUsd(amt)} on Hyperliquid in about a minute`
        : `You receive ${fmtUsd(Math.max(0, amt - WITHDRAW_FEE))} after the ${fmtUsd(WITHDRAW_FEE)} network fee`
      : `Min ${min} USDC`;

  return (
    <div className="tm-tk-overlay" onClick={onClose}>
      <div ref={boxRef} className="pop tm-tk-scope tm-tk-modal" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} onClick={(e) => e.stopPropagation()} onKeyDown={trap}>
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
                  setPhase({ kind: "idle" });
                  setAmount("");
                }}
              >
                {m === "deposit" ? <TkIcon.down size={13} /> : <TkIcon.up size={13} />}
                {m}
              </button>
            ))}
          </span>
          <button type="button" className="tm-tk-close" onClick={onClose} aria-label="Close">
            <TkIcon.close size={15} />
          </button>
        </div>

        <h2 id={`${uid}-t`} className="tm-tk-modal-title">
          {deposit ? "Deposit USDC" : "Withdraw USDC"}
        </h2>
        <p className="tm-tk-modal-sub">{deposit ? `From your wallet on ${DEPOSIT_CHAIN.name} straight into your Hyperliquid balance.` : "From your Hyperliquid balance back to your wallet on Arbitrum."}</p>

        <div className="tm-tk-route" aria-hidden>
          {deposit ? wallEnd : hlEnd}
          <span className="tm-tk-route-line">{moving ? <i /> : <TkIcon.arrow size={12} sw={2} />}</span>
          {deposit ? hlEnd : wallEnd}
        </div>

        <dl className="tm-tk-bal">
          {deposit ? (
            <>
              <div>
                <dt>USDC in wallet</dt>
                <dd>{mockMode ? "mock" : walletUsdc === null ? "…" : <b>{fmtUsd(walletUsdc)}</b>}</dd>
              </div>
              <div>
                <dt>Hyperliquid balance</dt>
                <dd>{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Available to withdraw</dt>
                <dd>{bal.data ? <b>{fmtUsd(bal.data.withdrawable)}</b> : "…"}</dd>
              </div>
              <div>
                <dt>Network fee</dt>
                <dd>{fmtUsd(WITHDRAW_FEE)} · paid to Hyperliquid</dd>
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
                  setAmount(String(Math.floor(max * 100) / 100));
                }}
                disabled={busy}
              >
                Max <b>{fmtUsd(max)}</b>
              </button>
            )}
          </div>
          <div className="tm-tk-size-main">
            <span className="tm-tk-size-cur" data-on={!!amount}>
              $
            </span>
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
              USDC
            </span>
          </div>
          <div className="tm-tk-size-sub">{sub}</div>
        </div>

        {mode === "withdraw" && (
          <div className="tm-tk-size tm-tk-dest" onClick={() => document.getElementById(`${uid}-d`)?.focus()}>
            <div className="tm-tk-size-head">
              <label htmlFor={`${uid}-d`} className="tm-tk-size-label">
                Destination
              </label>
              <span className="tm-tk-ref">{dest.toLowerCase() === address.toLowerCase() ? "This wallet · Arbitrum" : "Arbitrum address"}</span>
            </div>
            <input id={`${uid}-d`} className="tm-tk-input tm-tk-input-mono tm-tk-dest-input" value={dest} onChange={(e) => setDest(e.target.value.trim())} disabled={busy} spellCheck={false} autoComplete="off" aria-invalid={!/^0x[0-9a-fA-F]{40}$/.test(dest) || undefined} />
          </div>
        )}
        {amt > 0 && amt < min && (
          <p className="tm-tk-msg" data-tone="warn">
            <TkIcon.alert size={13} />
            <span>
              Minimum {mode} is {min} USDC.
            </span>
          </p>
        )}
        {max !== null && amt > max + 1e-9 && (
          <p className="tm-tk-msg" data-tone="warn">
            <TkIcon.alert size={13} />
            <span>That is more than you have available.</span>
          </p>
        )}

        {phase.kind === "idle" || phase.kind === "error" ? (
          <button type="button" className={`btn btn-primary tm-tk-cta ${!valid || (!mockMode && !wallet) ? "" : "btn-glow"}`} onClick={run} disabled={!valid || (!mockMode && !wallet)}>
            {deposit ? <TkIcon.down size={15} /> : <TkIcon.up size={15} />}
            {deposit ? `Deposit${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Hyperliquid` : `Withdraw${amt >= min ? ` ${fmtUsd(amt)}` : ""} to Arbitrum`}
          </button>
        ) : (
          <div className="tm-tk-status" data-tone={phase.kind === "busy" ? undefined : "ok"} role="status">
            {phase.kind === "busy" ? (
              <>
                <TkIcon.spin size={15} className="tm-tk-spin" />
                {phase.text}
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
            {phase.kind === "error" ? <TkIcon.alert size={13} /> : <TkIcon.check size={13} />}
            <span>
              {phase.text}
              {phase.kind === "sent" && phase.hash && (
                <>
                  {" "}
                  <a className="underline underline-offset-2" href={`${EXPLORER}/tx/${phase.hash}`} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                  .
                </>
              )}
              {phase.kind === "sent" && mode === "deposit" && <> Waiting for Hyperliquid to credit it…</>}
            </span>
          </p>
        )}

        <p className="tm-tk-modal-foot">
          {deposit ? (
            <>
              A deposit is a USDC transfer from your wallet to Hyperliquid&apos;s bridge on {DEPOSIT_CHAIN.name}. socialLiquid never holds funds. Coming from Solana, Ethereum or Base?{" "}
              <a href={`${HL_APP_URL_CLIENT}/trade`} target="_blank" rel="noreferrer">
                Use Hyperliquid&apos;s cross-chain routes
              </a>{" "}
              and the balance shows up here.
            </>
          ) : (
            <>Withdrawals are signed by your main wallet, never by the trading agent, and are processed by Hyperliquid&apos;s validators. USDC arrives on Arbitrum.</>
          )}
        </p>
      </div>
    </div>
  );
}
