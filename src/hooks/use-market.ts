"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { MarketSummary } from "@/lib/hl-types";

export function useMids() {
  return useQuery({
    queryKey: ["mids"],
    queryFn: () => api<Record<string, string>>("/api/mids"),
    refetchInterval: 3000,
    staleTime: 2000,
  });
}

export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => api<{ markets: MarketSummary[] }>("/api/markets").then((r) => r.markets),
    refetchInterval: 15_000,
  });
}

/** live pnl for a position given the current mid */
export function livePnl(p: { side: string; size: number; entryPx: number }, mid: number | undefined): number | null {
  if (!mid || !p.size) return null;
  const sign = p.side === "LONG" ? 1 : -1;
  return (mid - p.entryPx) * p.size * sign;
}
