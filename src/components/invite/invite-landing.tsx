"use client";
/** /i/<code>: the inviter's card, the pitch, and a connect button. stores the referral on mount. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import { fmtPct, userLabel, userPath } from "@/lib/format";
import { Avatar, Icon, Pnl } from "../ui";
import { useConnectModal } from "../connect-modal";
import { POINTS } from "@/lib/points-table";

type Props = {
  code: string;
  inviter: { address: string; handle: string | null; displayName: string | null; avatarUrl: string | null };
  stats: { closedTrades: number; winRate: number | null; pnl30d: number; copiers: number; followers: number; invited: number };
};

export function InviteLanding({ code, inviter, stats }: Props) {
  const { signedIn, needsSignIn, signIn, busy } = useAuth();
  const connect = useConnectModal();
  const router = useRouter();
  const [stored, setStored] = useState(false);
  useEffect(() => {
    api<{ ok: boolean }>("/api/invite/ref", { method: "POST", json: { code } }).then((r) => setStored(r.ok)).catch(() => setStored(false));
  }, [code]);
  return (
    <div className="max-w-xl mx-auto py-6 space-y-4" data-testid="invite-landing">
      <section className="card p-5">
        <div className="flex items-center gap-3">
          <Avatar address={inviter.address} url={inviter.avatarUrl} handle={inviter.handle ?? inviter.displayName} size={48} ring />
          <div className="min-w-0">
            <div className="text-[11px] text-muted uppercase tracking-wide">Invited by</div>
            <Link href={userPath(inviter)} className="font-semibold text-[16px] hover:underline underline-offset-2 truncate block">{userLabel(inviter)}</Link>
          </div>
          <span className="ml-auto pill pill-brand num" data-testid="invite-landing-code">{code}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <Mini label="30d PnL"><Pnl value={stats.pnl30d} compact className="font-semibold" /></Mini>
          <Mini label="Win rate">{stats.winRate === null ? "–" : fmtPct(stats.winRate, 0, false)}</Mini>
          <Mini label="Trades">{stats.closedTrades}</Mini>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted mt-2 justify-center flex-wrap">
          <span>{stats.followers} followers</span>
          {stats.copiers > 0 && <span>copied by {stats.copiers}</span>}
          {stats.invited > 0 && <span>brought in {stats.invited}</span>}
        </div>
      </section>
      <section className="card p-5 space-y-3">
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">The social layer for perpetual markets</h1>
        <ul className="text-[13.5px] text-fg-2 space-y-1.5">
          <li className="flex gap-2"><span className="text-brand">•</span> See what real traders open the second they open it, with their thesis and track record.</li>
          <li className="flex gap-2"><span className="text-brand">•</span> Copy a trade in one tap. Every order routes straight to Hyperliquid; your funds never leave your wallet.</li>
          <li className="flex gap-2"><span className="text-brand">•</span> Perps, spot and a live feed in one terminal. Points, streaks and a leaderboard on top.</li>
        </ul>
        <div className="text-[12px] text-muted">Join with this link and you start with <b className="text-fg-2">+{POINTS.INVITE_JOINED} points</b>.</div>
        {signedIn ? (
          <button className="btn btn-primary h-11 w-full text-[14px]" onClick={() => router.push("/trade")}>Open the terminal</button>
        ) : (
          <button className="btn btn-primary h-11 w-full text-[14px]" onClick={needsSignIn ? signIn : connect.open} disabled={busy} data-testid="invite-landing-cta">
            {needsSignIn ? (busy ? "Signing…" : "Sign in to join") : "Connect wallet to join"}
          </button>
        )}
        <div className="text-[11px] text-dim text-center inline-flex items-center gap-1 w-full justify-center">
          <Icon.check /> {stored ? "Invite saved for this browser" : "Saving invite…"}
        </div>
      </section>
    </div>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel-2 rounded-lg py-2">
      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
      <div className="num text-[14px] mt-0.5">{children}</div>
    </div>
  );
}
