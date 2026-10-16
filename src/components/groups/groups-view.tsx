"use client";
/** /groups: your circles, a create form and public groups to discover */
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import type { GroupLite } from "@/lib/groups";
import { userLabel } from "@/lib/format";
import { Avatar, Empty, Icon, Skeleton, Toggle } from "../ui";
import { useConnectModal } from "../connect-modal";

export function GroupsView() {
  const { signedIn, needsSignIn, signIn, busy } = useAuth();
  const connect = useConnectModal();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["groups", !!signedIn], queryFn: () => api<{ mine: GroupLite[]; discover: GroupLite[] }>("/api/groups"), refetchInterval: 30_000 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [pub, setPub] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const create = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await api<{ group: GroupLite }>("/api/groups", { method: "POST", json: { name, description: desc, isPublic: pub } });
      await qc.invalidateQueries({ queryKey: ["groups"] });
      window.location.assign(`/groups/${r.group.slug}`);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };
  return (
    <div className="max-w-4xl space-y-4 pb-6" data-testid="groups-page">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Groups</h1>
          <p className="text-[13px] text-muted mt-0.5">A shared feed of your people&apos;s trades and a leaderboard among yourselves. No chat, just the tape.</p>
        </div>
        {signedIn ? (
          <button className="btn btn-primary h-9 px-4 ml-auto" onClick={() => setCreating((v) => !v)} data-testid="group-new">{creating ? "Cancel" : "New group"}</button>
        ) : (
          <button className="btn btn-primary h-9 px-4 ml-auto" onClick={needsSignIn ? signIn : connect.open} disabled={busy}>{needsSignIn ? "Sign in" : "Connect wallet"}</button>
        )}
      </div>
      {creating && (
        <section className="card p-4 space-y-3" data-testid="group-create">
          <label className="block">
            <span className="text-[11px] text-muted">Name</span>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HYPE maxis" maxLength={40} autoFocus />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">Description (optional)</span>
            <input className="input mt-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="who is this for" maxLength={200} />
          </label>
          <div className="flex items-center gap-3">
            <Toggle on={pub} onChange={setPub} label="Public" />
            <span className="text-[12px] text-muted">{pub ? "Listed here; anyone can join and read the feed." : "Invite link only; outsiders see the name and member count."}</span>
          </div>
          {err && <p className="text-down text-xs">{err}</p>}
          <button className="btn btn-primary h-10 px-5" onClick={create} disabled={saving || name.trim().length < 2} data-testid="group-create-submit">{saving ? "Creating…" : "Create group"}</button>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-[11px] text-muted uppercase tracking-wide">Your groups</h2>
        {q.isLoading && <Skeleton rows={2} h={72} />}
        {q.data && q.data.mine.length === 0 && <Empty title={signedIn ? "You are not in a group yet" : "Sign in to see your groups"} hint="Create one and send the invite link to the traders you want on one feed." />}
        <div className="grid sm:grid-cols-2 gap-3" data-testid="groups-mine">
          {q.data?.mine.map((g) => <GroupCard key={g.id} g={g} />)}
        </div>
      </section>
      {!!q.data?.discover.length && (
        <section className="space-y-2">
          <h2 className="text-[11px] text-muted uppercase tracking-wide">Public groups</h2>
          <div className="grid sm:grid-cols-2 gap-3" data-testid="groups-discover">
            {q.data.discover.map((g) => <GroupCard key={g.id} g={g} />)}
          </div>
        </section>
      )}
    </div>
  );
}

export function GroupCard({ g }: { g: GroupLite }) {
  return (
    <Link href={`/groups/${g.slug}`} className="card p-4 hover:bg-panel-2 transition-colors block" data-testid={`group-card-${g.slug}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold truncate">{g.name}</span>
        {g.role === "OWNER" && <span className="pill pill-brand">Owner</span>}
        {!g.isPublic && <span className="pill pill-neutral">Private</span>}
        <span className="ml-auto text-[12px] text-muted num inline-flex items-center gap-1"><Icon.users /> {g.members}</span>
      </div>
      {g.description && <p className="text-[12.5px] text-fg-2 mt-1 line-clamp-2">{g.description}</p>}
      <div className="flex items-center gap-2 mt-3">
        <span className="flex -space-x-1.5">
          {g.preview.map((p) => (
            <span key={p.address} className="ring-2 ring-bg rounded-full"><Avatar address={p.address} url={p.avatarUrl} handle={p.handle} size={20} /></span>
          ))}
        </span>
        <span className="text-[11px] text-dim">by {userLabel(g.owner)}</span>
      </div>
    </Link>
  );
}
