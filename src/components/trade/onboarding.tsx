"use client";
import "./ticket.css";
import { useState } from "react";
import { useChainId, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { approveAgentWithWallet, approveBuilderFeeWithWallet } from "@/lib/hl-client";
import { fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { openFunds, TkIcon } from "./funds";
import { useConnectModal } from "../connect-modal";

type Prepare = { agentAddress: string; agentName: string; needsAgentApproval: boolean; needsBuilderApproval: boolean; builder: string; builderFeeTenthsBp: number; maxFeeRate: string };

export type Stage = "connect" | "signin" | "invite" | "handle" | "enable" | "ready";

/** which of the four onboarding steps a stage belongs to (the invite gate sits inside step 3) */
export const STAGE_STEP: Record<Stage, number> = { connect: 1, signin: 2, invite: 3, handle: 3, enable: 4, ready: 5 };

/* the step panels are module-level components so their identity is stable across renders:
   the ticket re-renders on every price tick, and a fresh component type each render would
   remount the form (losing what the user typed and stealing focus) */
function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}
function InvitePanel() {
  const refresh = useRefreshMe();
  return <InviteStep onDone={refresh} />;
}
function HandlePanel() {
  const refresh = useRefreshMe();
  return <HandleStep onDone={refresh} />;
}
function EnablePanel() {
  const refresh = useRefreshMe();
  return <EnableTradingStep onDone={refresh} />;
}

/** where the user is in onboarding, the label the trade cta should carry, and the panel to expand when clicked */
export function useOnboarding(): { stage: Stage; cta: string; act: (() => void) | null; busy: boolean; Panel: (() => React.ReactElement) | null } {
  const { isConnected, signedIn, needsSignIn, signIn, busy, me } = useAuth();
  const connect = useConnectModal();
  if (!isConnected) return { stage: "connect", cta: "Connect wallet to trade", act: connect.open, busy: false, Panel: null };
  if (needsSignIn || !signedIn) return { stage: "signin", cta: busy ? "Check your wallet…" : "Sign in to trade", act: signIn, busy, Panel: null };
  if (me?.invite.required && !me.invite.ok) return { stage: "invite", cta: "Enter invite code", act: null, busy: false, Panel: InvitePanel };
  if (!me?.user?.handle) return { stage: "handle", cta: "Claim a handle to trade", act: null, busy: false, Panel: HandlePanel };
  if (!me.user.agent?.approved || !me.user.agent.builderApproved) return { stage: "enable", cta: "Enable trading", act: null, busy: false, Panel: EnablePanel };
  return { stage: "ready", cta: "", act: null, busy: false, Panel: null };
}

/** legacy gate: renders children only when ready. kept for places that want the step cards up front. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const o = useOnboarding();
  if (o.stage === "ready") return <>{children}</>;
  if (o.Panel) return <o.Panel />;
  const first = o.stage === "connect";
  return (
    <Step n={first ? 1 : 2} title={first ? "Connect a wallet" : "Sign in"} hint={first ? "Hyperliquid signs with an EVM key. Any wallet works." : "Sign a message to prove you own this wallet. No gas, no permissions."}>
      <button type="button" className={`btn btn-primary w-full h-11 text-[15px] ${o.busy ? "" : "btn-glow"}`} onClick={o.act ?? undefined} disabled={o.busy}>
        {first ? <Icon.wallet /> : o.busy ? <TkIcon.spin size={15} className="tm-tk-spin" /> : <TkIcon.key size={15} />}
        {o.cta}
      </button>
      <Steps current={first ? 1 : 2} />
    </Step>
  );
}

const STEP_LABELS = ["Connect", "Sign in", "Handle", "Enable"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="tm-tk-progress" aria-label={`Step ${current} of ${STEP_LABELS.length}`}>
      {STEP_LABELS.map((l, i) => {
        const n = i + 1;
        return (
          <li key={l} data-state={n < current ? "done" : n === current ? "now" : "next"} aria-current={n === current ? "step" : undefined}>
            <span className="tm-tk-progress-bar" />
            <span className="tm-tk-progress-label">{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="tm-tk-scope tm-tk-step">
      <div className="tm-tk-step-head">
        <span className="tm-tk-step-num" aria-hidden>
          {String(n).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <span className="tm-tk-step-kicker">
            Step {n} of {STEP_LABELS.length}
          </span>
          <h2 className="tm-tk-step-title">{title}</h2>
        </div>
      </div>
      {hint && <p className="tm-tk-step-hint">{hint}</p>}
      {children}
    </div>
  );
}

function StepError({ text }: { text: string }) {
  return (
    <p className="tm-tk-msg tm-tk-err" data-tone="err" role="alert">
      <TkIcon.alert size={13} />
      <span>{text}</span>
    </p>
  );
}

function InviteStep({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Step n={3} title="Invite code" hint="Mainnet trading is invite only while we test with real money.">
      <form
        className="tm-tk-step-inline"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/api/invite", { method: "POST", json: { code } });
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="tm-tk-row flex-1 min-w-0">
          <span className="sr-only">Invite code</span>
          <input className="tm-tk-input tm-tk-input-mono uppercase tracking-[0.12em]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" autoFocus autoComplete="off" spellCheck={false} />
        </label>
        <button className="btn btn-primary h-10 px-4" disabled={busy || !code}>
          {busy ? <TkIcon.spin size={14} className="tm-tk-spin" /> : null}
          Enter
        </button>
      </form>
      {err && <StepError text={err} />}
      <Steps current={3} />
    </Step>
  );
}

function HandleStep({ onDone }: { onDone: () => void }) {
  const [handle, setHandle] = useState("");
  const [x, setX] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Step n={3} title="Pick a handle" hint="Your name on the feed and your profile URL. The X handle is optional and shows next to your posts.">
      <form
        className="tm-tk-step-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/api/me/handle", { method: "POST", json: { handle: handle.toLowerCase(), xHandle: x.replace(/^@/, "") || null } });
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="tm-tk-row">
          <span className="tm-tk-step-prefix">socialliquid.fun/t/</span>
          <input className="tm-tk-input -ml-1.5" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" maxLength={20} autoFocus autoComplete="off" spellCheck={false} aria-label="Handle" />
        </label>
        <label className="tm-tk-row">
          <span className="tm-tk-step-prefix inline-flex">
            <Icon.x />
          </span>
          <input className="tm-tk-input" value={x} onChange={(e) => setX(e.target.value)} placeholder="x handle (optional)" maxLength={16} autoComplete="off" spellCheck={false} aria-label="X handle (optional)" />
        </label>
        <button className={`btn btn-primary w-full h-10 mt-1 ${busy || handle.length < 3 ? "" : "btn-glow"}`} disabled={busy || handle.length < 3}>
          {busy ? <TkIcon.spin size={14} className="tm-tk-spin" /> : <TkIcon.at size={14} />}
          {busy ? "Saving…" : "Claim handle"}
        </button>
      </form>
      {err && <StepError text={err} />}
      <Steps current={3} />
    </Step>
  );
}

function EnableTradingStep({ onDone }: { onDone: () => void }) {
  const { data: wallet } = useWalletClient();
  const chainId = useChainId();
  const { me } = useAuth();
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const push = (s: string) => setLog((l) => [...l, s]);
  const mockMode = me?.network === "mock";

  const run = async () => {
    setBusy(true);
    setErr(null);
    setLog([]);
    try {
      push("Creating your agent wallet…");
      const prep = await api<Prepare>("/api/agent/prepare", { method: "POST" });
      let agentSigned = false;
      let builderSigned = false;
      if (prep.needsAgentApproval) {
        push(`Approve agent ${prep.agentAddress.slice(0, 10)}… in your wallet`);
        if (!mockMode) {
          if (!wallet) throw new Error("wallet not ready");
          await approveAgentWithWallet(wallet, chainId, prep.agentAddress, prep.agentName);
        }
        agentSigned = true;
        push("Agent approved");
      } else push("Agent already approved");
      if (prep.needsBuilderApproval) {
        push(`Approve builder fee (max ${prep.maxFeeRate}, we charge ${prep.builderFeeTenthsBp / 1000}%)`);
        if (!mockMode) {
          if (!wallet) throw new Error("wallet not ready");
          await approveBuilderFeeWithWallet(wallet, chainId, prep.builder, prep.maxFeeRate);
        }
        builderSigned = true;
        push("Builder fee approved");
      } else push("Builder fee already approved");
      push("Confirming on chain…");
      const c = await api<{ agentApproved: boolean; builderApproved: boolean }>("/api/agent/confirm", { method: "POST", json: { agentSigned, builderSigned } });
      if (!c.agentApproved || !c.builderApproved) throw new Error("Approval not visible on chain yet. Wait a few seconds and retry.");
      push("Done. You can trade.");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step n={4} title="Enable trading" hint="Two signatures from your main wallet, once. We never hold your main key.">
      <ul className="tm-tk-step-list">
        <li>
          <i>1</i>
          <span>
            <b>Approve an API wallet</b> so you don&apos;t sign every click.
            <code>approveAgent</code>
          </span>
        </li>
        <li>
          <i>2</i>
          <span>
            <b>Approve the builder fee</b>, max 0.1%, so our code goes on your fills.
            <code>approveBuilderFee</code>
          </span>
        </li>
      </ul>
      <button type="button" className={`btn btn-primary w-full h-11 text-[14px] ${busy ? "" : "btn-glow"}`} onClick={run} disabled={busy}>
        {busy ? <TkIcon.spin size={15} className="tm-tk-spin" /> : <TkIcon.bolt size={15} />}
        {busy ? "Working…" : "Approve both"}
      </button>
      {log.length > 0 && (
        <ol className="tm-tk-log" aria-live="polite">
          {log.map((l, i) => (
            <li key={i}>
              {busy && i === log.length - 1 ? <TkIcon.spin size={12} className="tm-tk-spin" /> : <TkIcon.check size={12} sw={2.2} />}
              {l}
            </li>
          ))}
        </ol>
      )}
      {err && <StepError text={err} />}
      <Steps current={4} />
    </Step>
  );
}

export function DepositBox({ address }: { address: string }) {
  const bal = useBalance(address);
  const [open, setOpen] = useState(false);
  const low = bal.data !== undefined && bal.data.withdrawable < 10;
  return (
    <div className="tm-tk-scope tm-tk-depo">
      <div className="tm-tk-depo-row">
        <span>Available to trade</span>
        <span className="num text-fg-2">
          {bal.data ? fmtUsd(bal.data.withdrawable) : "…"}{" "}
          <button type="button" className="tm-tk-link ml-1" onClick={() => setOpen((v) => !v)}>
            {low ? "Deposit" : open ? "Hide" : "Deposit"}
          </button>
        </span>
      </div>
      {(open || low) && (
        <div className="tm-tk-box">
          <p>
            Deposit USDC from <b>Arbitrum</b> straight into your Hyperliquid balance (min 5 USDC, about a minute). Funds go wallet → Hyperliquid; socialLiquid never holds them.
          </p>
          <button type="button" className="btn btn-primary h-9 w-full" onClick={() => openFunds("deposit")}>
            <TkIcon.down size={14} />
            Deposit USDC
          </button>
          <button type="button" className="btn h-8 w-full" onClick={() => openFunds("withdraw")}>
            <TkIcon.up size={13} />
            Withdraw
          </button>
        </div>
      )}
    </div>
  );
}
