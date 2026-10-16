"use client";
/** your invite link, who came in with it and what it earned. mounted at /invite */
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import { POINTS } from "@/lib/points-table";
import { timeAgo, userLabel, userPath } from "@/lib/format";
import { Avatar, Empty, Icon, Skeleton } from "../ui";
import { useConnectModal } from "../connect-modal";
import type { InviteeRow } from "@/lib/invites";

type Summary = { code: string; invitees: InviteeRow[]; stats: { joined: number; trading: number; earned: number } };

export function InviteView() {
  const { signedIn, signIn, needsSignIn, busy } = useAuth();
  const connect = useConnectModal();
  const q = useQuery({ queryKey: ["invite", "me"], queryFn: () => api<Summary>("/api/invite/me"), enabled: !!signedIn, refetchInterval: 30_000 });
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = q.data ? `${origin}/i/${q.data.code}` : "";
  const text = "see what the best hyperliquid traders open in real time and copy them in one tap. my invite:";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="max-w-3xl space-y-4 pb-6" data-testid="invite-page">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Invite friends</h1>
        <p className="text-[13px] text-muted mt-1">
          You get <b className="text-fg-2">+{POINTS.INVITED} points</b> for every friend who joins with your link and makes their first trade. They start with <b className="text-fg-2">+{POINTS.INVITE_JOINED}</b>. On an invite-only mainnet your code is also their way in.
        </p>
      </div>
      {!signedIn ? (
        <section className="card p-6 text-center">
          <p className="text-[14px] text-fg-2">Sign in to get your personal invite link.</p>
          <button className="btn btn-primary h-10 px-5 mt-3" onClick={needsSignIn ? signIn : connect.open} disabled={busy}>{needsSignIn ? "Sign in" : "Connect wallet"}</button>
        </section>
      ) : q.isLoading || !q.data ? (
        <Skeleton rows={3} h={64} />
      ) : (
        <>
          <section className="card p-4 space-y-3" data-testid="invite-link">
            <div className="text-[11px] text-muted uppercase tracking-wide">Your link</div>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="num text-[14px] bg-panel-2 border border-line rounded-lg px-3 h-10 inline-flex items-center flex-1 min-w-[240px] truncate" data-testid="invite-url">{url}</code>
              <button className="btn btn-primary h-10 px-4" onClick={copy} data-testid="invite-copy">{copied ? "Copied" : "Copy link"}</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <span className="text-muted">Code <b className="num text-fg-2" data-testid="invite-code">{q.data.code}</b></span>
              <span className="text-dim">·</span>
              <a className="btn h-8 px-3 text-xs inline-flex items-center gap-1.5" href={`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer"><Icon.x /> Share on X</a>
              <a className="btn h-8 px-3 text-xs inline-flex items-center gap-1.5" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Icon.send /> Telegram</a>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button className="btn h-8 px-3 text-xs inline-flex items-center gap-1.5" onClick={() => navigator.share({ url, text }).catch(() => {})}><Icon.share /> Share</button>
              )}
            </div>
          </section>
          <div className="grid grid-cols-3 gap-3" data-testid="invite-stats">
            <Stat label="Joined" value={q.data.stats.joined} />
            <Stat label="Trading" value={q.data.stats.trading} />
            <Stat label="Points earned" value={q.data.stats.earned} />
          </div>
          <section className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line text-[11px] text-muted uppercase tracking-wide">People you brought in</div>
            {q.data.invitees.length === 0 && <Empty title="Nobody yet" hint="Send your link to a trader you want on your feed." />}
            {q.data.invitees.length > 0 && (
              <ul className="divide-y divide-line/60">
                {q.data.invitees.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-4 h-14" data-testid={`invitee-${u.address}`}>
                    <Avatar address={u.address} url={u.avatarUrl} handle={u.handle ?? u.displayName} size={30} />
                    <Link href={userPath({ address: u.address, handle: u.handle })} className="font-medium hover:underline underline-offset-2 truncate">{userLabel({ address: u.address, handle: u.handle, displayName: u.displayName })}</Link>
                    <span className="text-[11px] text-dim num" suppressHydrationWarning>joined {timeAgo(u.joinedAt)} ago</span>
                    <span className={`ml-auto pill ${u.trading ? "pill-up" : "pill-neutral"}`}>{u.trading ? `trading · +${POINTS.INVITED}` : "not traded yet"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num text-[20px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}
