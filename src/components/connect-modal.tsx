"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useConnect, type Connector } from "wagmi";

type Ctx = { open: () => void; close: () => void; isOpen: boolean };
const ConnectCtx = createContext<Ctx>({ open: () => {}, close: () => {}, isOpen: false });
export const useConnectModal = () => useContext(ConnectCtx);

export function ConnectModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo<Ctx>(() => ({ open: () => setOpen(true), close: () => setOpen(false), isOpen }), [isOpen]);
  return (
    <ConnectCtx.Provider value={value}>
      {children}
      {isOpen && <ConnectModal onClose={() => setOpen(false)} />}
    </ConnectCtx.Provider>
  );
}

const LABEL: Record<string, string> = { injected: "Browser wallet", walletConnect: "WalletConnect", coinbaseWalletSDK: "Coinbase Wallet" };
const HINT: Record<string, string> = { injected: "Any EVM browser extension", walletConnect: "Phantom, Rainbow, Trust, Zerion, Ledger and 400+ mobile wallets", coinbaseWalletSDK: "Smart wallet or extension" };

/** the wallets we want visible even before they are installed. rdns is what the extension announces via eip-6963. */
const FEATURED = [
  { id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"], color: "#f6851b", url: "https://metamask.io/download/", hint: "Browser extension or mobile" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], color: "#ab9ff2", url: "https://phantom.com/download", hint: "Solana wallet with EVM support · Arbitrum works" },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], color: "#7084ff", url: "https://rabby.io/", hint: "Multi-chain extension by DeBank" },
] as const;

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { connectors, connectAsync, isPending, variables, error, reset } = useConnect();
  const { isConnected } = useAccount();
  const [hasInjected, setHasInjected] = useState(false);
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

  const Row = ({ icon, name, hint, right, onClick, href }: { icon: React.ReactNode; name: string; hint: string; right?: React.ReactNode; onClick?: () => void; href?: string }) => {
    const inner = (
      <>
        {icon}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-[11px] text-muted truncate">{hint}</span>
        </span>
        {right}
      </>
    );
    const cls = "w-full card hover:bg-panel-2 p-3 flex items-center gap-3 text-left disabled:opacity-60";
    return href ? (
      <a className={cls} href={href} target="_blank" rel="noreferrer">{inner}</a>
    ) : (
      <button className={cls} onClick={onClick} disabled={isPending}>{inner}</button>
    );
  };
  const WalletIcon = ({ src, name, color }: { src?: string; name: string; color?: string }) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="w-8 h-8 rounded-lg" />
    ) : (
      <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[13px] font-bold text-black" style={{ background: color ?? "var(--color-panel-3)" }}>{name.slice(0, 1)}</span>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="connect a wallet">
      <div className="card w-full max-w-sm p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold">Connect a wallet</h2>
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-0.5">
          {detected.map((c) => (
            <Row key={c.uid} icon={<WalletIcon src={c.icon} name={c.name} />} name={c.name} hint="Detected in this browser" onClick={() => pick(c)} right={isPending && variables?.connector === c ? <span className="text-[11px] text-brand">Check wallet…</span> : <span className="pill pill-brand">Detected</span>} />
          ))}
          {showGeneric && generic && (
            <Row icon={<WalletIcon src={generic.icon} name="Browser wallet" />} name={LABEL.injected} hint={HINT.injected} onClick={() => pick(generic)} right={isPending && variables?.connector === generic ? <span className="text-[11px] text-brand">Check wallet…</span> : undefined} />
          )}
          {missing.map((w) => (
            <Row key={w.id} icon={<WalletIcon name={w.name} color={w.color} />} name={w.name} hint={w.hint} href={w.url} right={<span className="text-[11px] text-muted">Install ↗</span>} />
          ))}
          {!others.some((c) => c.type === "walletConnect") && (
            <Row icon={<WalletIcon name="WalletConnect" color="#3b99fc" />} name="WalletConnect" hint="Needs NEXT_PUBLIC_WALLETCONNECT_ID (free at cloud.reown.com)" right={<span className="text-[11px] text-dim">Not configured</span>} onClick={() => {}} />
          )}
          {others.map((c) => (
            <Row key={c.uid} icon={<WalletIcon src={c.icon} name={LABEL[c.type] ?? c.name} color={c.type === "walletConnect" ? "#3b99fc" : "#0052ff"} />} name={LABEL[c.type] ?? c.name} hint={HINT[c.type] ?? ""} onClick={() => pick(c)} right={isPending && variables?.connector === c ? <span className="text-[11px] text-brand">Check wallet…</span> : undefined} />
          ))}
        </div>
        {error && <p className="text-down text-xs mt-3">{error.message.split("\n")[0]}</p>}
        <p className="text-[11px] text-dim mt-3">Connecting only reads your address. Trading needs two more signatures, explained in the trade panel. Hyperliquid runs on EVM addresses, so Phantom connects with its Ethereum account.</p>
      </div>
    </div>
  );
}
