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
const HINT: Record<string, string> = { injected: "MetaMask, Rabby, Phantom (EVM), any extension", walletConnect: "Scan a QR with a mobile wallet", coinbaseWalletSDK: "Smart wallet or extension" };

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
  // dedupe: wagmi may list the injected connector once per detected eip-6963 wallet plus the generic one
  const list = connectors.filter((c, i, arr) => (c.type === "injected" ? hasInjected && arr.findIndex((x) => x.type === "injected") === i : true));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="connect a wallet">
      <div className="card w-full max-w-sm p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold">Connect a wallet</h2>
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="space-y-1.5">
          {list.map((c) => {
            const busy = isPending && variables?.connector === c;
            return (
              <button key={c.uid} className="w-full card hover:bg-panel-2 p-3 flex items-center gap-3 text-left" onClick={() => pick(c)} disabled={isPending}>
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="w-7 h-7 rounded" />
                ) : (
                  <span className="w-7 h-7 rounded bg-panel-2 inline-flex items-center justify-center text-xs">{(LABEL[c.type] ?? c.name).slice(0, 1)}</span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{c.type === "injected" ? (hasInjected && c.name !== "Injected" ? c.name : LABEL.injected) : (LABEL[c.type] ?? c.name)}</span>
                  <span className="block text-[11px] text-muted truncate">{HINT[c.type] ?? ""}</span>
                </span>
                {busy && <span className="text-[11px] text-brand">Check wallet…</span>}
              </button>
            );
          })}
          {!hasInjected && (
            <p className="text-[11px] text-dim px-1">No browser wallet detected. Install MetaMask or Rabby, or use WalletConnect from your phone.</p>
          )}
        </div>
        {error && <p className="text-down text-xs mt-3">{error.message.split("\n")[0]}</p>}
        <p className="text-[11px] text-dim mt-3">Connecting only reads your address. Trading needs two more signatures, explained in the trade panel.</p>
      </div>
    </div>
  );
}
