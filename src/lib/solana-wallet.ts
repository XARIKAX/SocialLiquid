"use client";
/**
 * Solana wallets for keys, through the Wallet Standard every current Solana wallet implements (Phantom, Solflare,
 * Backpack, …). the keys section asks for one only when a key is bought, sold, claimed or listed; the hyperliquid
 * wallet that signs in stays the account. the chosen wallet is remembered so the next visit reconnects silently.
 */
import { useSyncExternalStore } from "react";
import { SOLANA_CLUSTER } from "./keys";

type Account = { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] };
export type StandardWallet = {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly Account[];
  features: {
    "standard:connect"?: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly Account[] }> };
    "standard:disconnect"?: { disconnect(): Promise<void> };
    "solana:signAndSendTransaction"?: { signAndSendTransaction(...inputs: { account: Account; chain: string; transaction: Uint8Array; options?: { commitment?: string; skipPreflight?: boolean } }[]): Promise<{ signature: Uint8Array }[]> };
    "solana:signTransaction"?: { signTransaction(...inputs: { account: Account; chain?: string; transaction: Uint8Array }[]): Promise<{ signedTransaction: Uint8Array }[]> };
    "solana:signMessage"?: { signMessage(...inputs: { account: Account; message: Uint8Array }[]): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }[]> };
    [k: string]: unknown;
  };
};

export const SOLANA_CHAIN = `solana:${SOLANA_CLUSTER}`;
const STORE = "sl:solana-wallet";

type State = { wallet: StandardWallet | null; account: Account | null };
let state: State = { wallet: null, account: null };
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  listeners.forEach((f) => f());
};

const usable = (w: StandardWallet) =>
  !!w.features["standard:connect"] && (!!w.features["solana:signAndSendTransaction"] || !!w.features["solana:signTransaction"]) && w.chains.some((c) => c.startsWith("solana:"));

/** the Solana wallets installed in this browser */
export async function solanaWallets(): Promise<StandardWallet[]> {
  const { getWallets } = await import("@wallet-standard/app");
  return (getWallets().get() as unknown as StandardWallet[]).filter(usable);
}

/**
 * the connected Solana wallet, connecting one if needed: the one used last time, else Phantom, else the first
 * found. throws a message to show when there is none.
 */
export async function connectSolana(): Promise<{ wallet: StandardWallet; account: Account }> {
  if (state.wallet && state.account) return { wallet: state.wallet, account: state.account };
  const wallets = await solanaWallets();
  if (!wallets.length) throw new Error("No Solana wallet found. Install Phantom (or Solflare or Backpack) and reload.");
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {
    /* no storage */
  }
  const wallet = wallets.find((w) => w.name === saved) ?? wallets.find((w) => /phantom/i.test(w.name)) ?? wallets[0];
  const { accounts } = await wallet.features["standard:connect"]!.connect();
  const account = accounts[0] ?? wallet.accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account.`);
  try {
    localStorage.setItem(STORE, wallet.name);
  } catch {
    /* no storage */
  }
  set({ wallet, account });
  return { wallet, account };
}

export async function disconnectSolana() {
  await state.wallet?.features["standard:disconnect"]?.disconnect().catch(() => {});
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* no storage */
  }
  set({ wallet: null, account: null });
}

/** sign a message (the link proof): the signature, base64 */
export async function signSolanaMessage(message: string): Promise<string> {
  const { wallet, account } = await connectSolana();
  const f = wallet.features["solana:signMessage"];
  if (!f) throw new Error(`${wallet.name} cannot sign messages; use Phantom, Solflare or Backpack.`);
  const [r] = await f.signMessage({ account, message: new TextEncoder().encode(message) });
  let bin = "";
  for (const b of r.signature) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * have the wallet sign and send a serialized transaction. returns the signature bytes when the wallet sent it, or
 * the signed transaction for the caller to send when the wallet only signs.
 */
export async function walletSend(transaction: Uint8Array): Promise<{ signature: Uint8Array } | { signed: Uint8Array }> {
  const { wallet, account } = await connectSolana();
  const send = wallet.features["solana:signAndSendTransaction"];
  if (send) {
    const [r] = await send.signAndSendTransaction({ account, chain: SOLANA_CHAIN, transaction, options: { commitment: "confirmed" } });
    return { signature: r.signature };
  }
  const [r] = await wallet.features["solana:signTransaction"]!.signTransaction({ account, chain: SOLANA_CHAIN, transaction });
  return { signed: r.signedTransaction };
}

/** the connected Solana wallet's address and name, for display */
export function useSolanaWallet(): { address: string | null; name: string | null } {
  const s = useSyncExternalStore(
    (f) => (listeners.add(f), () => void listeners.delete(f)),
    () => state,
    () => state,
  );
  return { address: s.account?.address ?? null, name: s.wallet?.name ?? null };
}

export type { Account as SolanaAccount };
