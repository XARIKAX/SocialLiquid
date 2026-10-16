"use client";
/** replies under a thesis: the list plus a composer for signed-in, claimed accounts. styles: ./feed.css (.tm-rail-thread*) */
import "./feed.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import { timeAgo, userLabel, userPath } from "@/lib/format";
import { useConnectModal } from "../connect-modal";
import { openProfileEditor } from "../profile-editor";
import { Avatar } from "../ui";

export type Reply = { id: string; text: string; createdAt: string; user: { id: string; address: string; handle: string | null; displayName: string | null; avatarUrl: string | null } };

const MAX = 280;

/** the one step that unlocks a social action: connect a wallet, or sign the nonce if one is connected */
export function useSignInPrompt() {
  const { isConnected, needsSignIn, signIn } = useAuth();
  const connect = useConnectModal();
  return () => {
    if (needsSignIn) void signIn();
    else if (!isConnected) connect.open();
  };
}

/** ⌘ on apple keyboards, Ctrl elsewhere: read after mount, so the server and the first client render agree */
function useModKey() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return mac ? "⌘" : "Ctrl";
}

/**
 * the same thread under a thesis (`thesisId`) or under a trade event (`eventId`).
 * `compact` is the rail's style (inside a feed card); without it the slightly larger thesis-page style.
 * `onNavigate` (optional) runs when a reply's author is opened, so the rail can bring the page forward on a phone.
 */
export function ThesisThread({ thesisId, eventId, onCount, compact = false, autoFocus = false, onNavigate }: { thesisId?: string; eventId?: string; onCount?: (n: number) => void; compact?: boolean; autoFocus?: boolean; onNavigate?: () => void }) {
  const base = thesisId ? `/api/thesis/${thesisId}/replies` : `/api/feed/${eventId}/replies`;
  const key = thesisId ? ["replies", thesisId] : ["event-replies", eventId];
  const { signedIn, me, needsSignIn, busy: authBusy } = useAuth();
  const prompt = useSignInPrompt();
  const mod = useModKey();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => api<{ replies: Reply[] }>(base).then((r) => r.replies) });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canPost = signedIn && !!me?.user?.handle;
  const none = q.data?.length === 0;
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
  const av = compact ? 22 : 28;
  return (
    <div className={`tm-rail-thread ${compact ? "" : "tm-rail-thread-page"}`}>
      {q.isLoading && (
        <div aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="tm-rail-reply" style={{ opacity: 1 - i * 0.35 }}>
              <span className="skeleton tm-rail-skel-dot" style={{ width: av, height: av }} />
              <span className="flex flex-col gap-1.5 pt-1">
                <span className="skeleton" style={{ height: 9, width: "38%", borderRadius: 5 }} />
                <span className="skeleton" style={{ height: 9, width: "76%", borderRadius: 5 }} />
              </span>
            </div>
          ))}
        </div>
      )}
      {q.isError && (
        <p className="tm-rail-thread-note">
          Replies did not load.
          <button type="button" onClick={() => q.refetch()}>
            Try again
          </button>
        </p>
      )}
      {!!q.data?.length && (
        <ul className="tm-rail-thread-list">
          {q.data.map((r) => {
            const label = userLabel(r.user);
            return (
              <li key={r.id} className="tm-rail-reply">
                {/* the name beside it is the link people tab to; the avatar is the same door for the pointer */}
                <Link href={userPath(r.user)} onClick={onNavigate} className="tm-rail-av self-start" tabIndex={-1} aria-hidden>
                  <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={av} />
                </Link>
                <div className="min-w-0">
                  <div className="tm-rail-reply-head">
                    <Link href={userPath(r.user)} onClick={onNavigate}>
                      {label}
                    </Link>
                    {r.user.handle && r.user.handle !== label && <span>@{r.user.handle}</span>}
                    <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
                      {timeAgo(r.createdAt)}
                    </time>
                  </div>
                  <p className="tm-rail-reply-text">{r.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canPost ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          {none && <p className="tm-rail-thread-note">{thesisId ? "No replies yet. Be the first." : "No comments yet. Be the first."}</p>}
          <div className="tm-rail-compose">
            <div className="tm-rail-compose-field">
              <textarea
                rows={1}
                placeholder={thesisId ? "Add a reply…" : "Add a comment…"}
                aria-label={thesisId ? "Reply" : "Comment"}
                value={text}
                maxLength={MAX}
                autoFocus={autoFocus}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void post();
                  }
                }}
              />
            </div>
            <button className="btn btn-primary" disabled={busy || !text.trim()}>
              {busy ? "Posting…" : "Reply"}
            </button>
          </div>
          <div className="tm-rail-compose-meta">
            <span>
              <span className="kbd">{mod}</span> <span className="kbd">↵</span> to send
            </span>
            {text.length > 0 && (
              <span className="ml-auto num" data-warn={text.length > MAX - 20 ? "" : undefined}>
                {text.length}/{MAX}
              </span>
            )}
          </div>
        </form>
      ) : (
        !q.isLoading && (
          // one quiet line: whether anyone has replied, and the one step that lets you
          <p className="tm-rail-thread-note">
            {none && <span>No replies yet.</span>}
            {signedIn ? (
              <span>
                <button type="button" onClick={openProfileEditor}>
                  Claim a handle
                </button>{" "}
                to reply
              </span>
            ) : (
              <span>
                <button type="button" onClick={prompt} disabled={authBusy}>
                  {needsSignIn ? (authBusy ? "Check your wallet…" : "Sign in") : "Connect wallet"}
                </button>{" "}
                to reply
              </span>
            )}
          </p>
        )
      )}
      {err && <p className="tm-rail-thread-err">{err}</p>}
    </div>
  );
}
