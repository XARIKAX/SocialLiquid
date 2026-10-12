"use client";
import { useState, useSyncExternalStore } from "react";
import { useChainId } from "wagmi";
import { chainLabel, useSigner } from "@/hooks/use-signer";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { approveAgentWithWallet, approveBuilderFeeWithWallet, usdClassTransferWithWallet } from "@/lib/hl-client";
import { fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { openFunds } from "./funds";
import { useConnectModal } from "../connect-modal";

/** a wallet prompt that never comes back should not leave the button spinning forever */
function withTimeout<T>(p: Promise<T>, what: string, ms = 120_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} within 2 minutes; open the wallet, then try again`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
/**
 * the class transfer is a signed action, not a transaction: hyperliquid credits the perps balance a beat after it
 * answers. approveAgent from an account with no perps equity is refused ("must deposit before performing actions"),
 * so the next signature waits for the money to actually land.
 */
async function waitForPerps(address: string, push: (s: string) => void) {
  for (let i = 0; i < 12; i++) {
    const b = await api<{ accountValue: number }>(`/api/balance?address=${address}`);
    if (b.accountValue >= 0.5) {
      push("USDC is in perps");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The USDC left spot but has not shown up in perps yet. Give it a few seconds, then press Approve both again.");
}

/** viem wraps a dismissed wallet prompt in a long multi-line error; hyperliquid's own refusals are the short ones */
function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "You dismissed the request in your wallet. Press Approve both to try again.";
  if (/does not exist|must deposit/i.test(msg)) return "Hyperliquid will not take approvals from an account with no perps balance yet. Move USDC to perps (or deposit), then try again.";
  if (/unified account/i.test(msg)) return "Your Hyperliquid account is unified: spot and perps share one balance, so there is nothing to move. Reload the page and press again.";
  return msg.split("\n")[0];
}


type Prepare = { agentAddress: string; agentName: string; needsAgentApproval: boolean; needsBuilderApproval: boolean; builder: string; builderEnabled: boolean; builderFeeTenthsBp: number; maxFeeRate: string };

export type Stage = "connect" | "signin" | "invite" | "handle" | "enable" | "ready";

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

/** stable component identities: an inline `() => <Step />` would remount the step (and drop its busy/log/error state,
 *  orphaning the in-flight wallet prompts) every time the ticket re-renders on a mids or balance tick. */
function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}
function InvitePanel() { return <InviteStep onDone={useRefreshMe()} />; }
function HandlePanel() { return <HandleStep onDone={useRefreshMe()} />; }
export function EnablePanel() { return <EnableTradingStep onDone={useRefreshMe()} />; }

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

/** wagmi hands us no wallet client while the extension sits on a network the site does not list */
export function needWallet<T>(wallet: T | null | undefined): T {
  if (!wallet) throw new Error("your wallet is on a network this site does not list. Switch it to Ethereum, Arbitrum, Base or Polygon (Phantom: Ethereum, Base or Polygon), then press again.");
  return wallet;
}

/** the enable flow's progress lives outside the component: a wallet prompt can take a minute, and the ticket around the
 *  step re-renders (and may remount it) the whole time. the run keeps going and its log, error and busy flag stay visible. */
type EnableState = { busy: boolean; log: string[]; err: string | null };
let enableState: EnableState = { busy: false, log: [], err: null };
const enableSubs = new Set<() => void>();
function setEnable(patch: Partial<EnableState>) {
  enableState = { ...enableState, ...patch };
  enableSubs.forEach((f) => f());
}
function useEnableState() {
  return useSyncExternalStore((f) => { enableSubs.add(f); return () => { enableSubs.delete(f); }; }, () => enableState, () => enableState);
}

function EnableTradingStep({ onDone }: { onDone: () => void }) {
  const { wallet, walletName, phantom, liveChainId } = useSigner();
  const chainId = useChainId();
  const { me, address } = useAuth();
  const { log, err, busy } = useEnableState();
  const push = (s: string) => setEnable({ log: [...enableState.log, s] });
  const mockMode = me?.network === "mock";

  const run = async () => {
    if (enableState.busy) return;
    setEnable({ busy: true, err: null, log: [] });
    try {
      // first: the agent record and the deployment's own config. a builder hyperliquid will not accept turns the
      // second signature into a dead end, so this has to refuse before the wallet is ever opened.
      push("Creating your agent wallet…");
      const prep = await api<Prepare>("/api/agent/prepare", { method: "POST" });
      // hyperliquid only registers approvals for accounts that hold USDC in perps. deposits that landed in spot move first.
      if (!mockMode && address) {
        push("Checking your Hyperliquid balances…");
        const b = await api<{ accountValue: number; unified: boolean; spot: { coin: string; total: number; hold: number }[] | null }>(`/api/balance?address=${address}`);
        const spotUsdc = b.spot?.find((x) => x.coin === "USDC");
        const inSpot = spotUsdc ? Math.max(0, spotUsdc.total - spotUsdc.hold) : 0;
        const spotCoins = (b.spot ?? []).filter((x) => x.coin !== "USDC" && x.total > 0);
        if (b.unified) {
          // one margin pool: spot USDC already backs perps, and hyperliquid refuses usdClassTransfer outright
          push("Unified account: your spot USDC already backs perps, nothing to move");
        } else if (b.accountValue < 0.5 && inSpot >= 0.5) {
          push(`Moving ${inSpot.toFixed(2)} USDC from spot to perps (sign in your wallet)…`);
          await withTimeout(usdClassTransferWithWallet(needWallet(wallet), chainId, (Math.floor(inSpot * 100) / 100).toFixed(2).replace(/\.?0+$/, ""), true), "the wallet did not answer");
          await waitForPerps(address, push);
        } else if (b.accountValue < 0.5 && inSpot < 0.5 && spotCoins.length === 0) {
          throw new Error("your Hyperliquid account has no balance yet. Deposit first (any route, including SOL / BTC / ETH), then press this again.");
        } else if (b.accountValue < 0.5 && spotCoins.length > 0) {
          // spot-only account (SOL/BTC/ETH through Unit): approvals register fine; selling for USDC comes after, through the agent
          push(`Spot balance found (${spotCoins.map((c) => c.coin.replace(/^U(?=[A-Z]{3,})/, "")).join(", ")}); enabling trading so it can be sold for USDC`);
        }
      }
      let agentSigned = false;
      let builderSigned = false;
      if (prep.needsAgentApproval) {
        push(`Approve agent ${prep.agentAddress.slice(0, 10)}… in your wallet (signature 1 of ${prep.needsBuilderApproval ? 2 : 1})`);
        if (!mockMode) await withTimeout(approveAgentWithWallet(needWallet(wallet), chainId, prep.agentAddress, prep.agentName), "the wallet did not answer the agent approval");
        agentSigned = true;
        push("Agent approved");
      } else push("Agent already approved");
      if (prep.needsBuilderApproval) {
        push(`Approve builder fee (max ${prep.maxFeeRate}, we charge ${prep.builderFeeTenthsBp / 1000}%) in your wallet`);
        if (!mockMode) await withTimeout(approveBuilderFeeWithWallet(needWallet(wallet), chainId, prep.builder, prep.maxFeeRate), "the wallet did not answer the builder-fee approval");
        builderSigned = true;
        push("Builder fee approved");
      } else push(prep.builderEnabled ? "Builder fee already approved" : "No builder fee on this deployment, nothing to approve");
      push("Confirming on chain…");
      const c = await api<{ agentApproved: boolean; builderApproved: boolean }>("/api/agent/confirm", { method: "POST", json: { agentSigned, builderSigned } });
      if (!c.agentApproved || !c.builderApproved) throw new Error(`Approval not visible on chain yet (agent ${c.agentApproved ? "ok" : "missing"}, builder fee ${c.builderApproved ? "ok" : "missing"}). Wait a few seconds and press again.`);
      push("Done. You can trade.");
      onDone();
    } catch (e) {
      setEnable({ err: explain(e) });
    } finally {
      setEnable({ busy: false });
    }
  };

  return (
    <Step n={4} title="Enable trading" hint="A signature from your main wallet, once. No gas, nothing leaves Hyperliquid; your wallet may label it 'Ethereum' or your current network, that is only the signing network. We never hold your main key.">
      <ul className="text-xs text-fg-2 space-y-2 mb-3">
        <li className="flex gap-2"><span className="text-brand">1.</span><span><b>Approve an API wallet</b> so you don't sign every click. <span className="text-dim">approveAgent</span></span></li>
        <li className="flex gap-2"><span className="text-brand">2.</span><span><b>Approve the builder fee</b>, max 0.1%, so our code goes on your fills. <span className="text-dim">approveBuilderFee</span> — skipped while this deployment charges no fee.</span></li>
      </ul>
      {walletName && (
        <p className="text-[11px] text-dim mb-2 leading-snug" data-testid="enable-wallet">
          Signing with <b className="text-fg-2">{walletName}</b> on <b className="text-fg-2">{chainLabel(liveChainId)}</b>. No network switch is needed: Hyperliquid accepts these signatures from any network{phantom ? ", so Phantom on Ethereum, Base or Polygon is fine (Arbitrum is not in Phantom)" : ""}.
        </p>
      )}
      <button className="btn btn-primary w-full h-11 text-[15px]" onClick={run} disabled={busy} data-testid="enable-run">{busy ? "Working… check your wallet" : err ? "Try again" : "Approve both"}</button>
      {log.length > 0 && (
        <ol className="mt-3 text-[11px] text-muted space-y-1" data-testid="enable-log">
          {log.map((l, i) => (
            <li key={i} className="flex gap-1.5"><span className="text-brand"><Icon.check /></span>{l}</li>
          ))}
        </ol>
      )}
      {err && <p className="text-down text-xs mt-2 leading-snug" role="alert" data-testid="enable-error">{err}</p>}
      <p className="text-[11px] text-dim mt-2">Stuck? <a className="text-brand hover:underline" href="/api/me/trading-check" target="_blank" rel="noreferrer">Open the trading check</a> and send us what it says.</p>
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
