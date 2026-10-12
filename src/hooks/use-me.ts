"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";

export type Me = {
  user: {
    id: string;
    address: string;
    handle: string | null;
    displayName: string | null;
    xHandle: string | null;
    tgHandle: string | null;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    agent: { agentAddress: string; approved: boolean; builderApproved: boolean } | null;
  } | null;
  invite: { required: boolean; ok: boolean };
  network: "mock" | "testnet" | "mainnet";
  builder: { address: string; feeTenthsBp: number };
};

export function useMe() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 15_000 });
  return { ...q, me: q.data, refresh: () => qc.invalidateQueries({ queryKey: ["me"] }) };
}

export type Balance = {
  /** builder dex these perps numbers are for; "" = main */
  dex?: string;
  /** hip-3 dex abstraction on (main USDC usable on builder dexes); only asked for when dex is set */
  dexAbstraction?: boolean | null;
  totalNtlPos?: number;
  /** cross maintenance margin used; null if hyperliquid did not report it */
  maintenanceMargin?: number | null;
  /** spot balances (native deposits through Unit land here); null if the spot read failed */
  spot: { coin: string; total: number; hold: number }[] | null;
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
  positions: { coin: string; szi: number; entryPx: number; positionValue: number; unrealizedPnl: number; leverage: number; liquidationPx: number | null; returnOnEquity: number }[];
};

export function useBalance(address: string | null | undefined, dex = "") {
  return useQuery({
    queryKey: ["balance", address, dex],
    queryFn: () => api<Balance>(`/api/balance?address=${address}${dex ? `&dex=${encodeURIComponent(dex)}` : ""}`),
    enabled: !!address,
    refetchInterval: 5000,
  });
}
