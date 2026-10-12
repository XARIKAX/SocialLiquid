"use client";
/**
 * profile setup and editing. mandatory after the first sign-in (no handle yet), reopened later via openProfileEditor().
 * images are resized in the browser and stored as data urls, so no object storage is needed.
 * styles: ./chrome.css (.tm-chrome-modal, .tm-chrome-banner, .tm-chrome-avatar-*).
 */
import "./chrome.css";
import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import { Avatar, Icon } from "./ui";
import { useModalFocus } from "./connect-modal";

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
const BIO_MAX = 160;

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

const closeIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

function ProfileEditor({ mandatory, onClose }: { mandatory: boolean; onClose: () => void }) {
  const { me, signOut } = useAuth();
  const u = me!.user!;
  const qc = useQueryClient();
  const [handle, setHandle] = useState(u.handle ?? "");
  const [displayName, setDisplayName] = useState(u.displayName ?? "");
  const [bio, setBio] = useState(u.bio ?? "");
  const [x, setX] = useState(u.xHandle ?? "");
  const [tg, setTg] = useState(u.tgHandle ?? "");
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
  const [banner, setBanner] = useState<string | null | undefined>(undefined);
  const [avail, setAvail] = useState<null | "checking" | "ok" | "taken" | "invalid">(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const avatarIn = useRef<HTMLInputElement>(null);
  const bannerIn = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(ref);

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
      await api("/api/me/profile", { method: "POST", json: { handle: handle.trim().toLowerCase(), displayName: displayName.trim(), bio: bio.trim() || null, xHandle: x.trim() || null, tgHandle: tg.trim() || null, avatar, banner } });
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
    <div className="tm-chrome-overlay" data-layer="top" onClick={mandatory ? undefined : onClose} role="presentation">
      <div ref={ref} className="pop tm-chrome-modal tm-chrome-profile" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <span className="tm-chrome-modal-spec" aria-hidden />
        {/* banner + avatar */}
        <div className="relative">
          <button type="button" className="tm-chrome-banner" data-has={bannerSrc ? "" : undefined} onClick={() => bannerIn.current?.click()} aria-label={bannerSrc ? "Change banner" : "Add a banner"}>
            {bannerSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerSrc} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              // the wallet's own hue, lit like the terminal (deep on ink, pastel on paper: the gradient lives in chrome.css)
              <span className="tm-chrome-banner-fill" style={{ "--h1": hue, "--h2": (hue + 60) % 360 } as React.CSSProperties} />
            )}
            <span className="tm-chrome-banner-cta" aria-hidden>
              <span className="tm-chrome-glasschip">
                <Icon.camera />
                {bannerSrc ? "Change banner" : "Add a banner"}
              </span>
            </span>
          </button>
          <input ref={bannerIn} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0], "banner")} />
          {bannerSrc && (
            <button type="button" className="tm-chrome-glasschip tm-chrome-banner-remove" onClick={() => setBanner(null)}>
              Remove
            </button>
          )}
          <button type="button" className="tm-chrome-avatar-btn" onClick={() => avatarIn.current?.click()} aria-label="Change photo" title="Change photo">
            <span className="block rounded-full">
              <Avatar address={u.address} url={avatarSrc} handle={displayName || handle} size={84} />
            </span>
            <span className="tm-chrome-avatar-cam" aria-hidden>
              <Icon.camera />
            </span>
            <span className="tm-chrome-avatar-badge" aria-hidden>
              <Icon.camera />
            </span>
          </button>
          <input ref={avatarIn} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0], "avatar")} />
        </div>

        <div className="px-5 pt-14 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="tm-chrome-modal-title">
                {mandatory ? "Set up your profile" : "Edit profile"}
              </h2>
              <p className="tm-chrome-modal-sub">{mandatory ? "One time. Your Hyperliquid history is already attached to this wallet." : "Shown on your profile, the feed and the leaderboard."}</p>
            </div>
            {!mandatory && (
              <button type="button" className="tm-chrome-close -mr-1 -mt-1" onClick={onClose} aria-label="Close">
                {closeIcon}
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            <label className="block">
              <span className="tm-chrome-form-label">
                <span className="label-caps">Name</span>
              </span>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How you want to be known" maxLength={32} data-autofocus />
            </label>
            <label className="block">
              <span className="tm-chrome-form-label">
                <span className="label-caps">Handle</span>
                <Availability state={avail} mine={!!u.handle && handle.trim().toLowerCase() === u.handle} />
              </span>
              <span className="relative block">
                <span className="tm-chrome-input-ico text-[13px]" aria-hidden>
                  @
                </span>
                <input className="input pl-7 lowercase" value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="handle" maxLength={20} aria-invalid={avail === "taken" || avail === "invalid" || undefined} />
              </span>
            </label>
          </div>
          <p className="tm-chrome-url">
            socialliquid.fun/t/<b>{handle.toLowerCase() || "handle"}</b>
          </p>

          <label className="block mt-4">
            <span className="tm-chrome-form-label">
              <span className="label-caps">
                Bio <em>· optional</em>
              </span>
              <span className="tm-chrome-count-chars" data-near={bio.length > BIO_MAX - 20 || undefined}>
                {bio.length}/{BIO_MAX}
              </span>
            </span>
            <textarea className="input h-[72px] py-2.5 resize-none leading-snug" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What you trade, how you trade it." maxLength={BIO_MAX} />
          </label>

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <label className="block">
              <span className="tm-chrome-form-label">
                <span className="label-caps">
                  X <em>· optional</em>
                </span>
              </span>
              <span className="relative block">
                <span className="tm-chrome-input-ico" aria-hidden>
                  <Icon.x />
                </span>
                <input className="input pl-8" value={x} onChange={(e) => setX(e.target.value)} placeholder="username" maxLength={16} />
              </span>
            </label>
            <label className="block">
              <span className="tm-chrome-form-label">
                <span className="label-caps">
                  Telegram <em>· optional</em>
                </span>
              </span>
              <span className="relative block">
                <span className="tm-chrome-input-ico" aria-hidden>
                  <Icon.send />
                </span>
                <input className="input pl-8" value={tg} onChange={(e) => setTg(e.target.value)} placeholder="username" maxLength={33} />
              </span>
            </label>
          </div>

          {err && (
            <p className="tm-chrome-err" role="alert">
              {err}
            </p>
          )}
          <div className="flex items-center gap-2 mt-5">
            <button type="button" className={`btn btn-primary h-11 flex-1 text-[14px] ${canSave ? "btn-glow" : ""}`} onClick={save} disabled={!canSave}>
              {busy ? "Saving…" : mandatory ? "Create profile" : "Save changes"}
            </button>
            {mandatory && (
              <button type="button" className="btn btn-ghost h-11 px-3 text-xs text-muted" onClick={() => signOut()}>
                Sign out
              </button>
            )}
          </div>
          <p className="tm-chrome-note">
            <Icon.users />
            <span>Your name and photo appear on the feed and the leaderboard. Followers see your opens, closes and theses the second they hit chain.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Availability({ state, mine }: { state: null | "checking" | "ok" | "taken" | "invalid"; mine?: boolean }) {
  if (!state) return null;
  return (
    <span className="tm-chrome-avail" data-s={state} role="status">
      {state === "ok" && (
        <>
          <Icon.check />
          {mine ? "Yours" : "Available"}
        </>
      )}
      {state === "taken" && "Taken"}
      {state === "invalid" && "3–20 of a–z 0–9 _"}
      {state === "checking" && (
        <>
          <span className="tm-chrome-spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} aria-hidden />
          Checking
        </>
      )}
    </span>
  );
}
