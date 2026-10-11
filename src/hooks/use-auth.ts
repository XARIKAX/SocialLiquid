"use client";
import { useCallback, useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { useMe } from "./use-me";

/** connect wallet -> sign a nonce -> session cookie. the signature authorises nothing else. */
export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { me, refresh } = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = !!me?.user && !!address && me.user.address === address.toLowerCase();
  const needsSignIn = isConnected && !!address && !signedIn;

  const signIn = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await api<{ message: string }>(`/api/auth/nonce?address=${address}`);
      const signature = await signMessageAsync({ message });
      await api("/api/auth/verify", { method: "POST", json: { address, signature } });
      await refresh();
      qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync, refresh, qc]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    disconnect();
    await refresh();
    qc.invalidateQueries();
  }, [disconnect, refresh, qc]);

  return { address, isConnected, signedIn, needsSignIn, signIn, signOut, busy, error, me };
}
