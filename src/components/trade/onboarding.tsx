"use client";
import { useState } from "react";
import { useChainId, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectModal } from "../connect-modal";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api, HL_APP_URL_CLIENT } from "@/lib/client";
import { approveAgentWithWallet, approveBuilderFeeWithWallet } from "@/lib/hl-client";
import { fmtUsd } from "@/lib/format";

type Prepare = {
  agentAddress: string;
  agentName: string;
  needsAgentApproval: boolean;
  needsBuilderApproval: boolean;
  builder: string;
  builderFeeTenthsBp: number;
  maxFeeRate: string;
};

/** returns null when the user is fully set up; otherwise the next onboarding step ui */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { isConnected, signedIn, needsSignIn, signIn, busy, error, me } = useAuth();
  const { refresh } = useMeRefresh();
  const connect = useConnectModal();
  if (!isConnected)
    return (
      <Step title="connect a wallet" hint="hyperliquid signs with an evm key. any wallet works.">
        <button className="btn btn-primary w-full" onClick={connect.open}>connect wallet</button>
      </Step>
    );
  if (needsSignIn || !signedIn)
    return (
      <Step title="sign in" hint="sign a message to prove you own this wallet. no gas, no permissions.">
        <button className="btn btn-primary w-full" onClick={signIn} disabled={busy}>{busy ? "check your wallet…" : "sign in"}</button>
        {error && <p className="text-down text-xs mt-2">{error}</p>}
      </Step>
    );
  if (me?.invite.required && !me.invite.ok) return <InviteStep onDone={refresh} />;
  if (!me?.user?.handle) return <HandleStep onDone={refresh} />;
  if (!me.user.agent?.approved || !me.user.agent.builderApproved) return <EnableTradingStep onDone={refresh} />;
  return <>{children}</>;
}

function useMeRefresh() {
  const qc = useQueryClient();
  return { refresh: () => qc.invalidateQueries({ queryKey: ["me"] }) };
}

function Step({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted mt-1 mb-3">{hint}</p>}
      {children}
    </div>
  );
}

function InviteStep({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Step title="invite code" hint="mainnet trading is invite only while we test with real money.">
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
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" autoFocus />
        <button className="btn btn-primary" disabled={busy || !code}>enter</button>
      </form>
      {err && <p className="text-down text-xs mt-2">{err}</p>}
    </Step>
  );
}

function HandleStep({ onDone }: { onDone: () => void }) {
  const [handle, setHandle] = useState("");
  const [x, setX] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Step title="pick a handle" hint="this is your name on the feed and your profile url. x handle is optional.">
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
        <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle (a-z 0-9 _)" maxLength={20} autoFocus />
        <input className="input" value={x} onChange={(e) => setX(e.target.value)} placeholder="@x handle (optional)" maxLength={16} />
        <button className="btn btn-primary w-full" disabled={busy || handle.length < 3}>{busy ? "saving…" : "claim handle"}</button>
      </form>
      {err && <p className="text-down text-xs mt-2">{err}</p>}
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
      push("creating your agent wallet…");
      const prep = await api<Prepare>("/api/agent/prepare", { method: "POST" });
      let agentSigned = false;
      let builderSigned = false;
      if (prep.needsAgentApproval) {
        push(`approve agent ${prep.agentAddress.slice(0, 10)}… in your wallet`);
        if (!mockMode) {
          if (!wallet) throw new Error("wallet not ready");
          await approveAgentWithWallet(wallet, chainId, prep.agentAddress, prep.agentName);
        }
        agentSigned = true;
        push("agent approved");
      } else push("agent already approved");
      if (prep.needsBuilderApproval) {
        push(`approve builder fee (max ${prep.maxFeeRate}, we charge ${prep.builderFeeTenthsBp / 1000}%)`);
        if (!mockMode) {
          if (!wallet) throw new Error("wallet not ready");
          await approveBuilderFeeWithWallet(wallet, chainId, prep.builder, prep.maxFeeRate);
        }
        builderSigned = true;
        push("builder fee approved");
      } else push("builder fee already approved");
      push("confirming on chain…");
      const c = await api<{ agentApproved: boolean; builderApproved: boolean }>("/api/agent/confirm", { method: "POST", json: { agentSigned, builderSigned } });
      if (!c.agentApproved || !c.builderApproved) throw new Error("approval not visible on chain yet. wait a few seconds and retry.");
      push("done. you can trade.");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step title="enable trading" hint="two signatures from your main wallet, once: an api wallet so you don't sign every click, and a builder fee approval so our code goes on your fills. we never hold your main key.">
      <ul className="text-xs text-muted space-y-1 mb-3">
        <li>1. approve agent wallet <span className="text-dim">(approveAgent)</span></li>
        <li>2. approve builder fee ≤ 0.1% <span className="text-dim">(approveBuilderFee)</span></li>
      </ul>
      <button className="btn btn-primary w-full" onClick={run} disabled={busy}>{busy ? "working…" : "approve both"}</button>
      {log.length > 0 && (
        <ol className="mt-3 text-[11px] text-muted space-y-0.5">
          {log.map((l, i) => (
            <li key={i}>› {l}</li>
          ))}
        </ol>
      )}
      {err && <p className="text-down text-xs mt-2">{err}</p>}
    </Step>
  );
}

export function DepositBox({ address }: { address: string }) {
  const bal = useBalance(address);
  const [open, setOpen] = useState(false);
  const low = bal.data !== undefined && bal.data.withdrawable < 10;
  return (
    <div className="px-3 py-2 border-b border-line text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted">available</span>
        <span className="num">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted">account value</span>
        <span className="num">{bal.data ? fmtUsd(bal.data.accountValue) : "…"}</span>
      </div>
      <button className="text-accent text-[11px] mt-1 hover:underline" onClick={() => setOpen((v) => !v)}>
        {low ? "deposit usdc to start →" : open ? "hide deposit" : "deposit"}
      </button>
      {(open || low) && (
        <div className="mt-2 p-2 rounded bg-panel-2 text-[11px] text-muted space-y-1">
          <p>1. hold usdc on <b className="text-fg">arbitrum</b> in this wallet.</p>
          <p>2. bridge it to hyperliquid with the native bridge (min 5 usdc). it lands in your perps balance in ~1 min.</p>
          <a className="btn btn-primary h-7 w-full mt-1" href={`${HL_APP_URL_CLIENT}/trade`} target="_blank" rel="noreferrer">
            open hyperliquid deposit ↗
          </a>
          <p className="text-dim">solana deposits via relay / debridge are coming in phase 2.</p>
        </div>
      )}
    </div>
  );
}
