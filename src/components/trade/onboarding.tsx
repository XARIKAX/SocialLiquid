"use client";
import "./ticket.css";
import "./funds.css";
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
import { TkIcon } from "./tk-bits";
import { useConnectModal } from "../connect-modal";

/** a wallet prompt that never comes back should not leave the button spinning forever */
function withTimeout<T>(p: Promise<T>, what: string, ms = 120_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} within 2 minutes; open the wallet, then try again`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
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

/** which of the four onboarding steps a stage belongs to (the invite gate sits inside step 3); ready is past the end */
export const STAGE_STEP: Record<Stage, number> = { connect: 1, signin: 2, invite: 3, handle: 3, enable: 4, ready: 5 };

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
 *  orphaning the in-flight wallet prompts, or losing what the user typed) every time the ticket re-renders on a mids or
 *  balance tick. */
function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}
function InvitePanel() {
  return <InviteStep onDone={useRefreshMe()} />;
}
function HandlePanel() {
  return <HandleStep onDone={useRefreshMe()} />;
}
export function EnablePanel() {
  return <EnableTradingStep onDone={useRefreshMe()} />;
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
    <div className="tm-tk-scope tm-tk-step tm-fd">
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

function StepError({ text, testid }: { text: string; testid?: string }) {
  return (
    <p className="tm-tk-msg tm-tk-err" data-tone="err" role="alert" data-testid={testid}>
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
    <Step n={3} title="Invite code" hint="Mainnet trading is invite only while we test with real money. Any socialLiquid trader can give you their personal code from their Invite page.">
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
  return useSyncExternalStore(
    (f) => {
      enableSubs.add(f);
      return () => {
        enableSubs.delete(f);
      };
    },
    () => enableState,
    () => enableState,
  );
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
      // the builder's own wallet: hyperliquid counts only its perps account for the 100 USDC minimum, and USDC
      // deposits often land in spot. move it over before the builder check below, so one click gets through.
      const builderAddr = (process.env.NEXT_PUBLIC_BUILDER_ADDRESS ?? "").toLowerCase();
      if (!mockMode && address && builderAddr && address.toLowerCase() === builderAddr) {
        const b = await api<{ accountValue: number; unified: boolean; spot: { coin: string; total: number; hold: number }[] | null }>(`/api/balance?address=${address}`);
        const spotUsdc = b.spot?.find((x) => x.coin === "USDC");
        const inSpot = spotUsdc ? Math.max(0, spotUsdc.total - spotUsdc.hold) : 0;
        if (b.unified) push("This is the builder wallet (unified account): spot USDC already backs perps, nothing to move");
        else if (b.accountValue < 100 && inSpot >= 0.5) {
          push(`This is the builder wallet: moving its ${inSpot.toFixed(2)} USDC from spot to perps so Hyperliquid counts it (sign in your wallet)…`);
          await withTimeout(usdClassTransferWithWallet(needWallet(wallet), chainId, (Math.floor(inSpot * 100) / 100).toFixed(2).replace(/\.?0+$/, ""), true), "the wallet did not answer");
          await waitForPerps(address, push);
        }
      }
      // then: the agent record and the deployment's own config. a builder hyperliquid will not accept turns the
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
            <span className="tm-fd-skip">— skipped while this deployment charges no fee.</span>
          </span>
        </li>
      </ul>
      {walletName && (
        <p className="tm-fd-signer" data-testid="enable-wallet">
          <TkIcon.wallet size={13} />
          <span>
            Signing with <b>{walletName}</b> on <b>{chainLabel(liveChainId)}</b>. No network switch is needed: Hyperliquid accepts these signatures from any network{phantom ? ", so Phantom on Ethereum, Base or Polygon is fine (Arbitrum is not in Phantom)" : ""}.
          </span>
        </p>
      )}
      <button type="button" className={`btn btn-primary w-full h-11 text-[14px] ${busy ? "" : "btn-glow"}`} onClick={run} disabled={busy} data-testid="enable-run">
        {busy ? <TkIcon.spin size={15} className="tm-tk-spin" /> : err ? <TkIcon.retry size={15} sw={2} /> : <TkIcon.bolt size={15} />}
        {busy ? "Working… check your wallet" : err ? "Try again" : "Approve both"}
      </button>
      {log.length > 0 && (
        <ol className="tm-tk-log" aria-live="polite" data-testid="enable-log">
          {log.map((l, i) => {
            const last = i === log.length - 1;
            const state = last && busy ? "now" : last && err ? "fail" : "done";
            return (
              <li key={i} data-state={state}>
                {state === "now" ? <TkIcon.spin size={12} className="tm-tk-spin" /> : state === "fail" ? <TkIcon.close size={12} sw={2.4} /> : <TkIcon.check size={12} sw={2.2} />}
                {l}
              </li>
            );
          })}
        </ol>
      )}
      {err && <StepError text={err} testid="enable-error" />}
      <p className="tm-fd-help">
        Stuck?{" "}
        <a href="/api/me/trading-check" target="_blank" rel="noreferrer">
          Open the trading check
        </a>{" "}
        and send us what it says.
      </p>
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
