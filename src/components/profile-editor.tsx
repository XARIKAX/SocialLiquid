"use client";
import { STYLES } from "@/lib/styles";
import type { Profile } from "./trader/profile";
/**
 * profile setup and editing. mandatory after the first sign-in (no handle yet), reopened later via openProfileEditor().
 * images are resized in the browser and stored as data urls, so no object storage is needed.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import { Avatar, Icon } from "./ui";

const EVT = "sl:profile-editor";
export function openProfileEditor() {
  window.dispatchEvent(new Event(EVT));
}

/** mount once in the shell: forces profile creation for new sign-ins and hosts the edit dialog */
export function ProfileHost() {
  const { me, signedIn } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  const mandatory = signedIn && !!me?.user && !me.user.handle;
  if (!signedIn || !me?.user) return null;
  if (!mandatory && !open) return null;
  return <ProfileEditor mandatory={mandatory} onClose={() => setOpen(false)} />;
}

const AVATAR_PX = 320;
const BANNER_W = 1500;
const BANNER_H = 500;

/** cover-crop to w×h and encode as jpeg, stepping quality down until it fits */
async function toDataUrl(file: File, w: number, h: number, maxChars: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  const s = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * s;
  const dh = bmp.height * s;
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  let q = 0.86;
  let url = canvas.toDataURL("image/jpeg", q);
  while (url.length > maxChars && q > 0.4) {
    q -= 0.1;
    url = canvas.toDataURL("image/jpeg", q);
  }
  if (url.length > maxChars) throw new Error("image is too large even after compression");
  return url;
}

function ProfileEditor({ mandatory, onClose }: { mandatory: boolean; onClose: () => void }) {
  const { me, signOut } = useAuth();
  const u = me!.user!;
  const qc = useQueryClient();
  const [handle, setHandle] = useState(u.handle ?? "");
  const [displayName, setDisplayName] = useState(u.displayName ?? "");
  const [bio, setBio] = useState(u.bio ?? "");
  const [style, setStyle] = useState<string>(u.style ?? "");
  const [pinnedThesisId, setPinnedThesisId] = useState<string>(u.pinnedThesisId ?? "");
  const [pinnedPositionId, setPinnedPositionId] = useState<string>(u.pinnedPositionId ?? "");
  // what can be pinned: this trader's theses and trades, from their own profile payload
  const mine = useQuery({ queryKey: ["trader", u.address.toLowerCase()], queryFn: () => api<Profile>(`/api/trader/${u.address}`), staleTime: 30_000 });
  const [x, setX] = useState(u.xHandle ?? "");
  const [tg, setTg] = useState(u.tgHandle ?? "");
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
  const [banner, setBanner] = useState<string | null | undefined>(undefined);
  const [avail, setAvail] = useState<null | "checking" | "ok" | "taken" | "invalid">(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const avatarIn = useRef<HTMLInputElement>(null);
  const bannerIn = useRef<HTMLInputElement>(null);

  const avatarSrc = avatar === undefined ? u.avatarUrl : avatar;
  const bannerSrc = banner === undefined ? u.bannerUrl : banner;
  const hue = parseInt(u.address.slice(2, 8), 16) % 360;

  // live handle availability
  useEffect(() => {
    const h = handle.trim().toLowerCase();
    if (!h) return setAvail(null);
    if (!/^[a-z0-9_]{3,20}$/.test(h)) return setAvail("invalid");
    if (h === u.handle) return setAvail("ok");
    setAvail("checking");
    const t = setTimeout(() => {
      api<{ available: boolean }>(`/api/me/profile?handle=${encodeURIComponent(h)}`)
        .then((r) => setAvail(r.available ? "ok" : "taken"))
        .catch(() => setAvail(null));
    }, 350);
    return () => clearTimeout(t);
  }, [handle, u.handle]);

  useEffect(() => {
    if (mandatory) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mandatory, onClose]);

  const pick = async (file: File | undefined, kind: "avatar" | "banner") => {
    if (!file) return;
    setErr(null);
    try {
      const url = kind === "avatar" ? await toDataUrl(file, AVATAR_PX, AVATAR_PX, 150_000) : await toDataUrl(file, BANNER_W, BANNER_H, 650_000);
      if (kind === "avatar") setAvatar(url);
      else setBanner(url);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/me/profile", { method: "POST", json: { handle: handle.trim().toLowerCase(), displayName: displayName.trim(), bio: bio.trim() || null, xHandle: x.trim() || null, tgHandle: tg.trim() || null, avatar, banner, style: style || null, pinnedThesisId: pinnedThesisId || null, pinnedPositionId: pinnedPositionId || null } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["trader"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSave = displayName.trim().length > 0 && avail === "ok" && !busy;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/75 p-3" onClick={mandatory ? undefined : onClose} role="dialog" aria-modal="true" aria-label="profile">
      <div className="card w-full max-w-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* banner + avatar */}
        <div className="relative">
          <button type="button" className="group relative block w-full h-36 bg-panel-2 overflow-hidden" onClick={() => bannerIn.current?.click()} title="Change banner">
            {bannerSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerSrc} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className="absolute inset-0" style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 16%), hsl(${(hue + 60) % 360} 50% 10%) 60%, #0b0b0e)` }} />
            )}
            <span className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-sm font-medium"><Icon.camera /> {bannerSrc ? "Change banner" : "Add a banner"}</span>
          </button>
          <input ref={bannerIn} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0], "banner")} />
          {bannerSrc && (
            <button type="button" className="absolute top-2 right-2 btn btn-ghost h-7 px-2 text-[11px] bg-black/50" onClick={() => setBanner(null)}>Remove</button>
          )}
          <div className="absolute left-5 -bottom-10">
            <button type="button" className="group relative rounded-full" onClick={() => avatarIn.current?.click()} title="Change photo">
              <Avatar address={u.address} url={avatarSrc} handle={displayName || handle} size={84} ring />
              <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Icon.camera /></span>
            </button>
            <input ref={avatarIn} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0], "avatar")} />
          </div>
        </div>

        <div className="px-5 pt-12 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold">{mandatory ? "Set up your profile" : "Edit profile"}</h2>
              <p className="text-xs text-muted mt-0.5">{mandatory ? "One time. Your Hyperliquid history is already attached to this wallet." : "Shown on your profile, the feed and the leaderboard."}</p>
            </div>
            {!mandatory && <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>}
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <label className="block">
              <span className="text-[11px] text-muted">Name</span>
              <input className="input mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How you want to be known" maxLength={32} autoFocus={mandatory} />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">Handle</span>
              <span className="relative block mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim">@</span>
                <input className="input pl-7 pr-8 lowercase" value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="handle" maxLength={20} />
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] ${avail === "ok" ? "text-up" : avail === "taken" || avail === "invalid" ? "text-down" : "text-dim"}`}>
                  {avail === "ok" ? <Icon.check /> : avail === "taken" ? "taken" : avail === "invalid" ? "3-20 a-z 0-9 _" : avail === "checking" ? "…" : ""}
                </span>
              </span>
            </label>
          </div>
          <p className="text-[11px] text-dim mt-1 num">socialliquid.fun/t/{handle.toLowerCase() || "handle"}</p>

          <label className="block mt-3">
            <span className="text-[11px] text-muted">Bio <span className="text-dim">· optional</span></span>
            <textarea className="input mt-1 h-16 py-2 resize-none" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What you trade, how you trade it." maxLength={160} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">Trading style <span className="text-dim">· shows next to your name</span></span>
            <select className="input mt-1 h-10" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="trading style">
              <option value="">none</option>
              {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">Pinned thesis <span className="text-dim">· top of your profile</span></span>
            <select className="input mt-1 h-10" value={pinnedThesisId} onChange={(e) => setPinnedThesisId(e.target.value)} aria-label="pinned thesis">
              <option value="">most liked (default)</option>
              {(mine.data?.theses ?? []).map((t) => <option key={t.id} value={t.id}>{t.coin} · {t.text.slice(0, 60)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">Pinned trade</span>
            <select className="input mt-1 h-10" value={pinnedPositionId} onChange={(e) => setPinnedPositionId(e.target.value)} aria-label="pinned trade">
              <option value="">none</option>
              {(mine.data?.open ?? []).filter((o) => o.id).map((o) => <option key={o.id!} value={o.id!}>{o.coin} {o.side === "LONG" ? "long" : "short"} {o.leverage}x · open</option>)}
              {(mine.data?.recentClosed ?? []).slice(0, 30).map((c) => <option key={c.id} value={c.id}>{c.coin} {c.side === "LONG" ? "long" : "short"} {c.leverage}x · {c.realisedPnl !== null ? (c.realisedPnl >= 0 ? "+" : "") + Math.round(c.realisedPnl) : "closed"}</option>)}
            </select>
          </label>

          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className="text-[11px] text-muted">X <span className="text-dim">· optional</span></span>
              <span className="relative block mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"><Icon.x /></span>
                <input className="input pl-8" value={x} onChange={(e) => setX(e.target.value)} placeholder="username" maxLength={16} />
              </span>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">Telegram <span className="text-dim">· optional</span></span>
              <span className="relative block mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"><Icon.send /></span>
                <input className="input pl-8" value={tg} onChange={(e) => setTg(e.target.value)} placeholder="username" maxLength={33} />
              </span>
            </label>
          </div>

          {err && <p className="text-down text-xs mt-3">{err}</p>}
          <div className="flex items-center gap-2 mt-5">
            <button className="btn btn-primary h-11 flex-1 text-[14px]" onClick={save} disabled={!canSave}>{busy ? "Saving…" : mandatory ? "Create profile" : "Save changes"}</button>
            {mandatory && <button className="btn btn-ghost h-11 px-3 text-xs text-muted" onClick={() => signOut()}>Sign out</button>}
          </div>
          <p className="text-[11px] text-dim mt-3 leading-snug">Your name and photo appear on the feed and the leaderboard. Followers see your opens, closes and theses the second they hit chain.</p>
        </div>
      </div>
    </div>
  );
}
