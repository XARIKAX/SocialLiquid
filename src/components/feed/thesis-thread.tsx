"use client";
/** replies under a thesis: the list plus a composer for signed-in, claimed accounts */
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import { timeAgo, userLabel, userPath } from "@/lib/format";
import { Avatar } from "../ui";

export type Reply = { id: string; text: string; createdAt: string; user: { id: string; address: string; handle: string | null; displayName: string | null; avatarUrl: string | null } };

/** the same thread under a thesis (`thesisId`) or under a trade event (`eventId`) */
export function ThesisThread({ thesisId, eventId, onCount, compact = false, autoFocus = false }: { thesisId?: string; eventId?: string; onCount?: (n: number) => void; compact?: boolean; autoFocus?: boolean }) {
  const base = thesisId ? `/api/thesis/${thesisId}/replies` : `/api/feed/${eventId}/replies`;
  const key = thesisId ? ["replies", thesisId] : ["event-replies", eventId];
  const { signedIn, me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => api<{ replies: Reply[] }>(base).then((r) => r.replies) });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canPost = signedIn && !!me?.user?.handle;
  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ reply: Reply; count: number }>(base, { method: "POST", json: { text: body } });
      qc.setQueryData<Reply[]>(key, (d) => [...(d ?? []), r.reply]);
      onCount?.(r.count);
      setText("");
      qc.invalidateQueries({ queryKey: ["feed"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={compact ? "mt-2 pl-2 border-l-2 border-line" : "mt-3"}>
      {q.isLoading && <div className="text-xs text-dim px-2 py-1">Loading replies…</div>}
      {q.data?.length === 0 && <div className="text-xs text-dim px-2 py-1">No replies yet. {canPost ? "Be the first." : signedIn ? "Set up your profile to reply." : "Sign in to reply."}</div>}
      <ul className="space-y-2">
        {q.data?.map((r) => (
          <li key={r.id} className="flex items-start gap-2 px-2">
            <Link href={userPath(r.user)} className="shrink-0 mt-0.5"><Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={24} /></Link>
            <div className="min-w-0 leading-snug">
              <div className="flex items-center gap-1.5 text-[12px]">
                <Link href={userPath(r.user)} className="font-semibold hover:underline truncate max-w-[12rem]">{userLabel(r.user)}</Link>
                {r.user.handle && <span className="text-dim">@{r.user.handle}</span>}
                <span className="text-dim num">· {timeAgo(r.createdAt)}</span>
              </div>
              <p className="text-[13px] whitespace-pre-wrap break-words">{r.text}</p>
            </div>
          </li>
        ))}
      </ul>
      {canPost && (
        <form
          className="flex items-end gap-2 px-2 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          <textarea
            className="input flex-1 min-h-[38px] h-[38px] py-2 resize-none text-[13px]"
            placeholder={thesisId ? "Reply…" : "Comment…"}
            value={text}
            maxLength={280}
            autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void post();
            }}
          />
          <button className="btn btn-primary h-[38px] px-3 text-[13px]" disabled={busy || !text.trim()}>{busy ? "…" : "Reply"}</button>
        </form>
      )}
      {err && <p className="text-down text-[11px] px-2 mt-1">{err}</p>}
    </div>
  );
}
