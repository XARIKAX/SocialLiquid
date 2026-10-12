"use client";
import { useAccount, useWalletClient } from "wagmi";

const NAMES: Record<number, string> = { 1: "Ethereum", 42161: "Arbitrum", 8453: "Base", 10: "Optimism", 137: "Polygon", 43114: "Avalanche", 999: "HyperEVM", 143: "Monad", 56: "BNB Chain" };
export const chainLabel = (id?: number | null) => (id ? `${NAMES[id] ?? "chain"} (${id})` : "unknown network");

/** is the connected extension Phantom? by connector name, else by Phantom owning window.ethereum with no other wallet named */
export function isPhantomWallet(connectorName?: string | null): boolean {
  if (/phantom/i.test(connectorName ?? "")) return true;
  if (typeof window === "undefined") return false;
  const w = window as unknown as { phantom?: { ethereum?: { isPhantom?: boolean } }; ethereum?: { isPhantom?: boolean } };
  return !!w.phantom?.ethereum && !!w.ethereum?.isPhantom && !/metamask|rabby|coinbase|walletconnect|okx|trust/i.test(connectorName ?? "");
}

/**
 * the wallet client used for hyperliquid message signing (approvals, transfers, withdrawals). wagmi normally refuses to
 * hand one over while the extension sits on a chain the site does not list (`ConnectorChainMismatchError`), which showed
 * up as "wallet not ready". hyperliquid signatures carry the wallet's live chain id and accept any chain, so signing
 * never needs a chain switch: `assertChainId: false` gives us the client wherever the wallet is.
 */
export function useSigner() {
  const { connector, chainId } = useAccount();
  const q = useWalletClient({ assertChainId: false });
  const walletName = connector?.name ?? null;
  return { wallet: q.data, walletName, phantom: isPhantomWallet(walletName), liveChainId: chainId ?? null };
}
