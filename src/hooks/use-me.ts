"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";

export type Me = {
  user: {
    id: string;
    address: string;
    handle: string | null;
    xHandle: string | null;
    avatarUrl: string | null;
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
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
  positions: { coin: string; szi: number; entryPx: number; positionValue: number; unrealizedPnl: number; leverage: number; liquidationPx: number | null; returnOnEquity: number }[];
};

export function useBalance(address: string | null | undefined) {
  return useQuery({
    queryKey: ["balance", address],
    queryFn: () => api<Balance>(`/api/balance?address=${address}`),
    enabled: !!address,
    refetchInterval: 5000,
  });
}
