"use client";
/** /groups/<slug>: header with join / invite link, then Feed · Members · Leaderboard tabs */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useMids } from "@/hooks/use-market";
import { api } from "@/lib/client";
import type { GroupLite, GroupMemberRow } from "@/lib/groups";
import type { FeedItem } from "@/lib/queries";
import { fmtPct, timeAgo, userLabel, userPath } from "@/lib/format";
import { Avatar, Empty, Icon, Pnl, Skeleton, Toggle } from "../ui";
import { FeedCard } from "../feed/feed-card";
import { useConnectModal } from "../connect-modal";

type Payload = { group: GroupLite; members: GroupMemberRow[]; joinCode: string | null; readable: boolean };
type Tab = "feed" | "members" | "leaderboard";
const MIN_SIZES = [0, 1000, 10_000, 100_000];

export function GroupView({ slug }: { slug: string }) {
  const { signedIn, needsSignIn, signIn, busy, address } = useAuth();
  const connect = useConnectModal();
  const qc = useQueryClient();
  const params = useSearchParams();
  const joinParam = params.get("join");
  const q = useQuery({ queryKey: ["group", slug, !!signedIn], queryFn: () => api<Payload>(`/api/groups/${slug}`), refetchInterval: 30_000, retry: false });
  const [tab, setTab] = useState<Tab>("feed");
  const [code, setCode] = useState(joinParam ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (joinParam) setCode(joinParam);
  }, [joinParam]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["group", slug] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
  const join = async () => {
    setActing(true);
    setErr(null);
    try {
      await api(`/api/groups/${slug}/join`, { method: "POST", json: { code: code || null } });
      await refresh();
      if (joinParam) history.replaceState(null, "", `/groups/${slug}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setActing(false);
    }
  };
  const leave = async () => {
    if (!confirm("Leave this group?")) return;
    setActing(true);
    try {
      const r = await api<{ deleted?: boolean }>(`/api/groups/${slug}/leave`, { method: "POST" });
      if (r.deleted) window.location.assign("/groups");
      else await refresh();
    } finally {
      setActing(false);
    }
  };
  if (q.error) return <Empty title="Group not found" hint={(q.error as Error).message} />;
  if (!q.data) return <Skeleton rows={4} h={64} />;
  const { group: g, members, joinCode, readable } = q.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteUrl = joinCode ? `${origin}/groups/${g.slug}?join=${joinCode}` : g.isPublic ? `${origin}/groups/${g.slug}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const owner = g.role === "OWNER";
  return (
    <div className="max-w-4xl space-y-3 pb-6" data-testid="group-page">
      <section className="card p-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href="/groups" className="text-dim hover:text-fg text-xs">Groups /</Link>
              <h1 className="text-[20px] font-semibold tracking-tight truncate" data-testid="group-name">{g.name}</h1>
              {!g.isPublic && <span className="pill pill-neutral">Private</span>}
              {g.isPublic && <span className="pill pill-neutral">Public</span>}
              {owner && <span className="pill pill-brand">Owner</span>}
            </div>
            {g.description && <p className="text-[13px] text-fg-2 mt-1">{g.description}</p>}
            <div className="flex items-center gap-2 mt-2 text-[12px] text-muted">
              <span className="flex -space-x-1.5">
                {g.preview.map((p) => (
                  <span key={p.address} className="ring-2 ring-bg rounded-full"><Avatar address={p.address} url={p.avatarUrl} handle={p.handle} size={22} /></span>
                ))}
              </span>
              <span className="num" data-testid="group-members-count">{g.members} {g.members === 1 ? "member" : "members"}</span>
              <span>· by {userLabel(g.owner)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {g.isMember ? (
              <>
                {inviteUrl && <button className="btn h-9 px-3 inline-flex items-center gap-1.5" onClick={copy} data-testid="group-copy-invite"><Icon.share /> {copied ? "Copied" : "Copy invite link"}</button>}
                {owner && <OwnerMenu slug={slug} g={g} onChange={refresh} />}
                <button className="btn btn-ghost h-9 px-3 text-xs" onClick={leave} disabled={acting} data-testid="group-leave">Leave</button>
              </>
            ) : !signedIn ? (
              <button className="btn btn-primary h-9 px-4" onClick={needsSignIn ? signIn : connect.open} disabled={busy}>{needsSignIn ? "Sign in to join" : "Connect to join"}</button>
            ) : g.isPublic ? (
              <button className="btn btn-primary h-9 px-4" onClick={join} disabled={acting} data-testid="group-join">Join</button>
            ) : (
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void join(); }}>
                <input className="input h-9 w-36 num uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" data-testid="group-code" />
                <button className="btn btn-primary h-9 px-4" disabled={acting || !code} data-testid="group-join">Join</button>
              </form>
            )}
          </div>
        </div>
        {err && <p className="text-down text-xs mt-2" data-testid="group-error">{err}</p>}
        {joinParam && !g.isMember && signedIn && !err && <p className="text-[12px] text-brand mt-2">You were invited. Press Join to get in.</p>}
      </section>
      {!readable ? (
        <Empty title="Members only" hint="This group's feed and leaderboard are visible to members. Ask a member for the invite link." icon={<Icon.users />} />
      ) : (
        <>
          <div className="flex items-center gap-0.5 border-b border-line">
            {(["feed", "members", "leaderboard"] as Tab[]).map((t) => (
              <button key={t} className={`tab h-9 px-3 capitalize ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)} data-testid={`group-tab-${t}`}>{t}</button>
            ))}
          </div>
          {tab === "feed" && <GroupFeed slug={slug} />}
          {tab === "members" && <Members rows={members} slug={slug} owner={owner} me={address?.toLowerCase()} />}
          {tab === "leaderboard" && <GroupBoard slug={slug} />}
        </>
      )}
    </div>
  );
}

function OwnerMenu({ slug, g, onChange }: { slug: string; g: GroupLite; onChange: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const patch = async (json: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`/api/groups/${slug}`, { method: "PATCH", json });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="relative">
      <button className="btn h-9 px-3 text-xs" onClick={() => setOpen((v) => !v)} data-testid="group-settings">Settings</button>
      {open && (
        <div className="absolute right-0 top-10 card p-3 z-20 w-64 space-y-2 shadow-2xl" data-testid="group-settings-menu">
          <div className="flex items-center gap-2">
            <Toggle on={g.isPublic} onChange={(v) => void patch({ isPublic: v })} label="Public" />
            <span className="text-[11px] text-muted">{g.isPublic ? "listed, anyone can join" : "invite link only"}</span>
          </div>
          <button className="btn h-8 w-full text-xs" disabled={busy} onClick={() => void patch({ rotateCode: true })} data-testid="group-rotate">New invite code</button>
          <button
            className="btn h-8 w-full text-xs text-down"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Delete this group for everyone?")) return;
              await api(`/api/groups/${slug}`, { method: "DELETE" });
              window.location.assign("/groups");
            }}
          >
            Delete group
          </button>
        </div>
      )}
    </span>
  );
}

function GroupFeed({ slug }: { slug: string }) {
  const { signedIn } = useAuth();
  const mids = useMids();
  const [minUsd, setMinUsd] = useState(0);
  const [thesisOnly, setThesisOnly] = useState(false);
  const qs = new URLSearchParams();
  if (minUsd) qs.set("minUsd", String(minUsd));
  if (thesisOnly) qs.set("thesis", "1");
  const q = useQuery({ queryKey: ["group-feed", slug, minUsd, thesisOnly], queryFn: () => api<{ items: FeedItem[] }>(`/api/groups/${slug}/feed?${qs}`).then((r) => r.items), refetchInterval: 10_000 });
  return (
    <div className="space-y-2" data-testid="group-feed">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="seg">
          {MIN_SIZES.map((m) => (
            <button key={m} className={`seg-item h-7 ${minUsd === m ? "seg-active" : ""}`} onClick={() => setMinUsd(m)}>{m === 0 ? "All sizes" : `$${m >= 1000 ? `${m / 1000}k` : m}+`}</button>
          ))}
        </span>
        <Toggle on={thesisOnly} onChange={setThesisOnly} label="Theses only" />
      </div>
      <div className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={6} h={72} />}
        {q.data?.length === 0 && <Empty title="Quiet in here" hint="When a member opens, closes or posts a thesis it shows up here." />}
        {q.data?.map((item) => (
          <FeedCard key={item.id} item={item} mid={mids.data ? Number(mids.data[item.coin]) : undefined} signedIn={!!signedIn} />
        ))}
      </div>
    </div>
  );
}

function Members({ rows, slug, owner, me }: { rows: GroupMemberRow[]; slug: string; owner: boolean; me?: string }) {
  const qc = useQueryClient();
  const { signedIn } = useAuth();
  const follow = async (r: GroupMemberRow) => {
    await api("/api/follow", { method: "POST", json: { address: r.user.address, follow: !r.isFollowing } });
    await qc.invalidateQueries({ queryKey: ["group", slug] });
  };
  void owner;
  return (
    <section className="card overflow-hidden" data-testid="group-members">
      <table className="w-full text-[13px]">
        <thead className="text-[11px] text-dim">
          <tr className="border-b border-line">
            <th className="text-left font-medium px-4 py-2.5">Member</th>
            <th className="text-right font-medium px-3 py-2.5">Points</th>
            <th className="text-right font-medium px-3 py-2.5">Streak</th>
            <th className="text-right font-medium px-3 py-2.5">7d PnL</th>
            <th className="text-right font-medium px-3 py-2.5">Joined</th>
            <th className="px-4 py-2.5 w-24" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`member-${r.user.address}`}>
              <td className="px-4 py-2.5">
                <Link href={userPath(r.user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                  <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={28} />
                  <span className="font-medium">{userLabel(r.user)}</span>
                  {r.role === "OWNER" && <span className="pill pill-brand">Owner</span>}
                  {r.user.style && <span className="pill pill-neutral hidden md:inline-flex">{r.user.style}</span>}
                </Link>
              </td>
              <td className="num text-right px-3">{r.user.points ?? 0}</td>
              <td className="num text-right px-3">{r.streak >= 2 ? <span className="text-warn">🔥 {r.streak}</span> : <span className="text-dim">–</span>}</td>
              <td className="text-right px-3"><Pnl value={r.stats.pnl7d} compact /></td>
              <td className="num text-right px-3 text-muted" suppressHydrationWarning>{timeAgo(r.joinedAt)}</td>
              <td className="px-4 text-right">
                {r.user.address === me ? <span className="text-[11px] text-dim">you</span> : (
                  <button className={`btn h-7 px-2.5 text-xs ${r.isFollowing ? "" : "btn-primary"}`} disabled={!signedIn} onClick={() => follow(r)}>{r.isFollowing ? "Following" : "Follow"}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const BOARD_BY = [["pnl7d", "7d PnL"], ["pnl30d", "30d PnL"], ["winRate", "Win rate"], ["points", "Points"], ["streak", "Streak"]] as const;

function GroupBoard({ slug }: { slug: string }) {
  const [by, setBy] = useState<(typeof BOARD_BY)[number][0]>("pnl7d");
  const q = useQuery({ queryKey: ["group-board", slug, by], queryFn: () => api<{ rows: (GroupMemberRow & { rank: number })[] }>(`/api/groups/${slug}/leaderboard?by=${by}`).then((r) => r.rows), refetchInterval: 30_000 });
  return (
    <div className="space-y-2" data-testid="group-board">
      <span className="seg">
        {BOARD_BY.map(([k, label]) => (
          <button key={k} className={`seg-item h-7 ${by === k ? "seg-active" : ""}`} onClick={() => setBy(k)}>{label}</button>
        ))}
      </span>
      <section className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={5} h={48} />}
        {!!q.data?.length && (
          <table className="w-full text-[13px]">
            <thead className="text-[11px] text-dim">
              <tr className="border-b border-line">
                <th className="text-left font-medium px-4 py-2.5 w-12">#</th>
                <th className="text-left font-medium px-3 py-2.5">Trader</th>
                <th className="text-right font-medium px-3 py-2.5">7d PnL</th>
                <th className="text-right font-medium px-3 py-2.5">30d PnL</th>
                <th className="text-right font-medium px-3 py-2.5">Win rate</th>
                <th className="text-right font-medium px-3 py-2.5">Trades</th>
                <th className="text-right font-medium px-3 py-2.5">Points</th>
                <th className="text-right font-medium px-4 py-2.5">Streak</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`board-${r.user.address}`}>
                  <td className={`num px-4 py-2.5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</td>
                  <td className="px-3 py-2.5">
                    <Link href={userPath(r.user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                      <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={26} />
                      <span className="font-medium">{userLabel(r.user)}</span>
                    </Link>
                  </td>
                  <td className="text-right px-3"><Pnl value={r.stats.pnl7d} compact className="font-semibold" /></td>
                  <td className="text-right px-3"><Pnl value={r.stats.pnl30d} compact /></td>
                  <td className="num text-right px-3">{r.stats.winRate === null ? "–" : fmtPct(r.stats.winRate, 0, false)}</td>
                  <td className="num text-right px-3 text-muted">{r.stats.closedTrades}</td>
                  <td className="num text-right px-3">{r.user.points ?? 0}</td>
                  <td className="num text-right px-4">{r.streak >= 2 ? <span className="text-warn">🔥 {r.streak}</span> : <span className="text-dim">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
