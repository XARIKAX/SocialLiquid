"use client";
import { useState } from "react";
import { useChainId, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { approveAgentWithWallet, approveBuilderFeeWithWallet } from "@/lib/hl-client";
import { fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { openFunds } from "./funds";
import { useConnectModal } from "../connect-modal";

type Prepare = { agentAddress: string; agentName: string; needsAgentApproval: boolean; needsBuilderApproval: boolean; builder: string; builderFeeTenthsBp: number; maxFeeRate: string };

export type Stage = "connect" | "signin" | "invite" | "handle" | "enable" | "ready";

/** where the user is in onboarding, the label the trade cta should carry, and the panel to expand when clicked */
export function useOnboarding(): { stage: Stage; cta: string; act: (() => void) | null; busy: boolean; Panel: (() => React.ReactElement) | null } {
  const { isConnected, signedIn, needsSignIn, signIn, busy, me } = useAuth();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });
  const connect = useConnectModal();
  if (!isConnected) return { stage: "connect", cta: "Connect wallet to trade", act: connect.open, busy: false, Panel: null };
  if (needsSignIn || !signedIn) return { stage: "signin", cta: busy ? "Check your wallet…" : "Sign in to trade", act: signIn, busy, Panel: null };
  if (me?.invite.required && !me.invite.ok) return { stage: "invite", cta: "Enter invite code", act: null, busy: false, Panel: () => <InviteStep onDone={refresh} /> };
  if (!me?.user?.handle) return { stage: "handle", cta: "Claim a handle to trade", act: null, busy: false, Panel: () => <HandleStep onDone={refresh} /> };
  if (!me.user.agent?.approved || !me.user.agent.builderApproved) return { stage: "enable", cta: "Enable trading", act: null, busy: false, Panel: () => <EnableTradingStep onDone={refresh} /> };
  return { stage: "ready", cta: "", act: null, busy: false, Panel: null };
}

/** legacy gate: renders children only when ready. kept for places that want the step cards up front. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const o = useOnboarding();
  if (o.stage === "ready") return <>{children}</>;
  if (o.Panel) return <o.Panel />;
  return (
    <Step n={o.stage === "connect" ? 1 : 2} title={o.stage === "connect" ? "Connect a wallet" : "Sign in"} hint={o.stage === "connect" ? "Hyperliquid signs with an EVM key. Any wallet works." : "Sign a message to prove you own this wallet. No gas, no permissions."}>
      <button className="btn btn-primary w-full h-11 text-[15px]" onClick={o.act ?? undefined} disabled={o.busy}>{o.cta}</button>
      <Steps current={o.stage === "connect" ? 1 : 2} />
    </Step>
  );
}

function Steps({ current }: { current: number }) {
  const labels = ["Connect", "Sign in", "Handle", "Enable trading"];
  return (
    <ol className="flex items-center gap-1.5 mt-4">
      {labels.map((l, i) => {
        const n = i + 1;
        return (
          <li key={l} className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className={`h-1 flex-1 rounded-full ${n < current ? "bg-brand" : n === current ? "bg-brand/60" : "bg-line-2"}`} />
            <span className={`text-[10px] whitespace-nowrap ${n <= current ? "text-fg-2" : "text-dim"}`}>{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 card-2 p-4">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-brand/15 text-brand text-[11px] font-semibold inline-flex items-center justify-center num">{n}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      {hint && <p className="text-xs text-muted mt-1.5 mb-3 leading-snug">{hint}</p>}
      {children}
    </div>
  );
}

function InviteStep({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Step n={3} title="Invite code" hint="Mainnet trading is invite only while we test with real money.">
      <form
        className="flex gap-2"
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
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" autoFocus />
        <button className="btn btn-primary h-10" disabled={busy || !code}>Enter</button>
      </form>
      {err && <p className="text-down text-xs mt-2">{err}</p>}
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
        className="space-y-2"
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
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-xs">socialliquid.fun/t/</span>
          <input className="input pl-[118px]" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" maxLength={20} autoFocus />
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"><Icon.x /></span>
          <input className="input pl-8" value={x} onChange={(e) => setX(e.target.value)} placeholder="x handle (optional)" maxLength={16} />
        </div>
        <button className="btn btn-primary w-full h-10" disabled={busy || handle.length < 3}>{busy ? "Saving…" : "Claim handle"}</button>
      </form>
      {err && <p className="text-down text-xs mt-2">{err}</p>}
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
      <ul className="text-xs text-fg-2 space-y-2 mb-3">
        <li className="flex gap-2"><span className="text-brand">1.</span><span><b>Approve an API wallet</b> so you don't sign every click. <span className="text-dim">approveAgent</span></span></li>
        <li className="flex gap-2"><span className="text-brand">2.</span><span><b>Approve the builder fee</b>, max 0.1%, so our code goes on your fills. <span className="text-dim">approveBuilderFee</span></span></li>
      </ul>
      <button className="btn btn-primary w-full h-11 text-[15px]" onClick={run} disabled={busy}>{busy ? "Working…" : "Approve both"}</button>
      {log.length > 0 && (
        <ol className="mt-3 text-[11px] text-muted space-y-1">
          {log.map((l, i) => (
            <li key={i} className="flex gap-1.5"><span className="text-brand"><Icon.check /></span>{l}</li>
          ))}
        </ol>
      )}
      {err && <p className="text-down text-xs mt-2">{err}</p>}
      <Steps current={4} />
    </Step>
  );
}

export function DepositBox({ address }: { address: string }) {
  const bal = useBalance(address);
  const [open, setOpen] = useState(false);
  const low = bal.data !== undefined && bal.data.withdrawable < 10;
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between px-1">
        <span className="text-muted">Available to trade</span>
        <span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"} <button className="text-brand font-medium ml-1 hover:underline" onClick={() => setOpen((v) => !v)}>{low ? "Deposit" : open ? "Hide" : "Deposit"}</button></span>
      </div>
      {(open || low) && (
        <div className="card-2 p-3 mt-2 space-y-1.5 text-muted leading-snug">
          <p>Deposit USDC from <b className="text-fg-2">Arbitrum</b> straight into your Hyperliquid balance (min 5 USDC, about a minute). Funds go wallet → Hyperliquid; socialLiquid never holds them.</p>
          <button className="btn btn-primary h-9 w-full mt-1" onClick={() => openFunds("deposit")}>Deposit USDC</button>
          <button className="btn h-8 w-full" onClick={() => openFunds("withdraw")}>Withdraw</button>
        </div>
      )}
    </div>
  );
}
