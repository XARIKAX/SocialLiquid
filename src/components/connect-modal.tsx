"use client";
import "./chrome.css";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useAccount, useConnect, type Connector } from "wagmi";
import { Icon } from "./ui";

/* =====================================================================
   connect a wallet: a glass modal rising out of a blurred, dimmed room.
   detected wallets first (lit "Detected" pill), then the ones worth
   installing, then the rest. styles: ./chrome.css (.tm-chrome-wallet*).
   ===================================================================== */

type Ctx = { open: () => void; close: () => void; isOpen: boolean };
const ConnectCtx = createContext<Ctx>({ open: () => {}, close: () => {}, isOpen: false });
export const useConnectModal = () => useContext(ConnectCtx);

export function ConnectModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo<Ctx>(() => ({ open: () => setOpen(true), close: () => setOpen(false), isOpen }), [isOpen]);
  const close = useCallback(() => setOpen(false), []);
  return (
    <ConnectCtx.Provider value={value}>
      {children}
      {isOpen && <ConnectModal onClose={close} />}
    </ConnectCtx.Provider>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** dialog plumbing: focus moves in (to [data-autofocus] if there is one), Tab stays inside, focus goes back on close, the page behind holds still */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        a.focus();
      } else if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const body = document.body;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = overflow;
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

const DEV = process.env.NODE_ENV !== "production";

const LABEL: Record<string, string> = { injected: "Browser wallet", walletConnect: "WalletConnect", coinbaseWallet: "Coinbase Wallet", coinbaseWalletSDK: "Coinbase Wallet" };
const HINT: Record<string, string> = { injected: "Any EVM browser extension", walletConnect: "Phantom, Rainbow, Trust, Zerion, Ledger and 400+ mobile wallets", coinbaseWallet: "Smart wallet or extension", coinbaseWalletSDK: "Smart wallet or extension" };

/** the wallets we want visible even before they are installed. rdns is what the extension announces via eip-6963. */
const FEATURED = [
  { id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"], color: "#f6851b", url: "https://metamask.io/download/", hint: "Browser extension or mobile" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], color: "#ab9ff2", url: "https://phantom.com/download", hint: "Solana wallet with EVM support · Arbitrum works" },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], color: "#7084ff", url: "https://rabby.io/", hint: "Multi-chain extension by DeBank" },
] as const;

const goIcon = (
  <svg className="tm-chrome-wallet-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
const closeIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

function WalletIcon({ src, name, color }: { src?: string; name: string; color?: string }) {
  if (src)
    return (
      <span className="tm-chrome-wallet-ico">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" />
      </span>
    );
  const c = color ?? "#3a4650";
  return (
    <span className="tm-chrome-wallet-ico" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${c} 62%, #fff) 0%, ${c} 48%, color-mix(in srgb, ${c} 72%, #000) 100%)` }}>
      {name.slice(0, 1)}
    </span>
  );
}

function WalletRow({ icon, name, hint, right, onClick, href, pending, disabled, inert, autoFocus }: { icon: ReactNode; name: string; hint: string; right?: ReactNode; onClick?: () => void; href?: string; pending?: boolean; disabled?: boolean; inert?: boolean; autoFocus?: boolean }) {
  const inner = (
    <>
      {icon}
      <span className="tm-chrome-wallet-text">
        <span className="tm-chrome-wallet-name">{name}</span>
        <span className="tm-chrome-wallet-hint">{hint}</span>
      </span>
      <span className="tm-chrome-wallet-end">
        {right}
        {!inert && goIcon}
      </span>
    </>
  );
  if (inert)
    return (
      <div className="tm-chrome-wallet" aria-disabled="true">
        {inner}
      </div>
    );
  return href ? (
    <a className="tm-chrome-wallet" href={href} target="_blank" rel="noreferrer" data-autofocus={autoFocus || undefined}>
      {inner}
    </a>
  ) : (
    <button type="button" className="tm-chrome-wallet" onClick={onClick} disabled={disabled} data-pending={pending || undefined} aria-busy={pending || undefined} data-autofocus={autoFocus || undefined}>
      {inner}
    </button>
  );
}

const checking = (
  <span className="inline-flex items-center gap-2 tm-chrome-mint font-medium">
    <span className="tm-chrome-spinner" aria-hidden />
    Check wallet…
  </span>
);

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { connectors, connectAsync, isPending, variables, error, reset } = useConnect();
  const { isConnected } = useAccount();
  const [hasInjected, setHasInjected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalFocus(ref);
  useEffect(() => setHasInjected(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum), []);
  useEffect(() => {
    if (isConnected) onClose();
  }, [isConnected, onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const pick = useCallback(
    async (c: Connector) => {
      reset();
      try {
        await connectAsync({ connector: c });
      } catch {
        /* surfaced via `error` */
      }
    },
    [connectAsync, reset],
  );

  // wagmi creates one injected connector per wallet announced through eip-6963 (id = the wallet's rdns),
  // plus the generic "injected" one for window.ethereum. show each detected wallet with its own icon.
  const detected = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = connectors.find((c) => c.id === "injected");
  const others = connectors.filter((c) => c.type !== "injected");
  const detectedRdns = new Set(detected.map((c) => c.id));
  const missing = FEATURED.filter((w) => !w.rdns.some((r) => detectedRdns.has(r)));
  const showGeneric = hasInjected && detected.length === 0 && generic;
  const pendingOn = (c: Connector) => isPending && variables?.connector === c;
  const noWalletConnect = !others.some((c) => c.type === "walletConnect");
  let first = true;
  const takeFirst = () => {
    const f = first;
    first = false;
    return f;
  };

  return (
    <div className="tm-chrome-overlay" onClick={onClose} role="presentation">
      <div ref={ref} className="pop tm-chrome-modal tm-chrome-connect" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <span className="tm-chrome-modal-spec" aria-hidden />
        <div className="tm-chrome-connect-head">
          <span className="tm-chrome-mark" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.webp" alt="" width={21} height={26} decoding="async" draggable={false} className="logo-mark" />
          </span>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 id={titleId} className="tm-chrome-modal-title">
              Connect a wallet
            </h2>
            <p id={descId} className="tm-chrome-modal-sub">
              Trade Hyperliquid perps beside the traders you follow.
            </p>
          </div>
          <button type="button" className="tm-chrome-close -mr-1 -mt-1" onClick={onClose} aria-label="Close">
            {closeIcon}
          </button>
        </div>

        <div className="tm-chrome-wallets">
          {(detected.length > 0 || showGeneric) && (
            <div className="tm-chrome-wallets-label">
              <span className="label-caps">In this browser</span>
            </div>
          )}
          {detected.map((c) => (
            <WalletRow key={c.uid} icon={<WalletIcon src={c.icon} name={c.name} />} name={c.name} hint="Detected in this browser" onClick={() => pick(c)} disabled={isPending} pending={pendingOn(c)} autoFocus={takeFirst()} right={pendingOn(c) ? checking : <span className="pill pill-brand">Detected</span>} />
          ))}
          {showGeneric && generic && (
            <WalletRow icon={<WalletIcon src={generic.icon} name="Browser wallet" color="#4de3c1" />} name={LABEL.injected} hint={HINT.injected} onClick={() => pick(generic)} disabled={isPending} pending={pendingOn(generic)} autoFocus={takeFirst()} right={pendingOn(generic) ? checking : undefined} />
          )}
          {missing.length > 0 && (
            <div className="tm-chrome-wallets-label">
              <span className="label-caps">Popular</span>
            </div>
          )}
          {missing.map((w) => (
            <WalletRow
              key={w.id}
              icon={<WalletIcon name={w.name} color={w.color} />}
              name={w.name}
              hint={w.hint}
              href={w.url}
              autoFocus={takeFirst()}
              right={
                <span className="inline-flex items-center gap-1">
                  Install <Icon.external />
                </span>
              }
            />
          ))}
          {(noWalletConnect || others.length > 0) && (
            <div className="tm-chrome-wallets-label">
              <span className="label-caps">More</span>
            </div>
          )}
          {noWalletConnect && (
            // the setup hint is for whoever runs the app; a trader just sees that mobile wallets are on the way
            <WalletRow
              inert
              icon={<WalletIcon name="WalletConnect" color="#3b99fc" />}
              name="WalletConnect"
              hint={DEV ? "Needs NEXT_PUBLIC_WALLETCONNECT_ID (free at cloud.reown.com)" : "Mobile wallets by QR code"}
              right={<span className="pill pill-neutral">{DEV ? "Not configured" : "Soon"}</span>}
            />
          )}
          {others.map((c) => (
            <WalletRow
              key={c.uid}
              icon={<WalletIcon src={c.icon} name={LABEL[c.type] ?? c.name} color={c.type === "walletConnect" ? "#3b99fc" : "#0052ff"} />}
              name={LABEL[c.type] ?? c.name}
              hint={HINT[c.type] ?? ""}
              onClick={() => pick(c)}
              disabled={isPending}
              pending={pendingOn(c)}
              autoFocus={takeFirst()}
              right={pendingOn(c) ? checking : undefined}
            />
          ))}
        </div>
        {error && (
          <p className="tm-chrome-err" role="alert">
            {error.message.split("\n")[0]}
          </p>
        )}
        <p className="tm-chrome-note">
          <Icon.lock />
          <span>Connecting only reads your address. Trading needs two more signatures, explained in the trade panel. Hyperliquid runs on EVM addresses, so Phantom connects with its Ethereum account.</span>
        </p>
      </div>
    </div>
  );
}
