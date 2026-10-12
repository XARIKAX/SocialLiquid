"use client";
import { useMemo } from "react";
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

/** a market as people see it, from its hyperliquid id: name ("SOL/USDC", "GOLD"), icon symbol and page. until the
    market list has loaded it falls back to the id, minus a builder dex's "xyz:" prefix */
export function marketIdentity(coin: string, m?: MarketSummary | null): { name: string; base: string; icon: string; href: string; market?: MarketSummary } {
  const bare = coin.includes(":") ? coin.slice(coin.indexOf(":") + 1) : coin;
  return { name: m?.name ?? bare, base: m?.base ?? bare, icon: m ? iconOf(m) : coin.includes(":") ? coin : bare, href: `/m/${encodeURIComponent(m?.slug ?? coin)}`, market: m ?? undefined };
}

/** the key of a market's icon in hyperliquid's set: builder-dex markets go by their full id ("xyz:GOLD"), the rest by symbol */
export const iconOf = (m: Pick<MarketSummary, "kind" | "coin" | "base">) => (m.kind === "hip3" ? m.coin : m.base);

/** resolve hyperliquid ids to their identity over the shared market list (one query for the whole page) */
export function useMarketIdentity(): (coin: string) => ReturnType<typeof marketIdentity> {
  const markets = useMarkets();
  return useMemo(() => {
    const by = new Map((markets.data ?? []).map((m) => [m.coin, m] as const));
    return (coin: string) => marketIdentity(coin, by.get(coin));
  }, [markets.data]);
}

/** live pnl for a position given the current mid */
export function livePnl(p: { side: string; size: number; entryPx: number }, mid: number | undefined): number | null {
  if (!mid || !p.size) return null;
  const sign = p.side === "LONG" ? 1 : -1;
  return (mid - p.entryPx) * p.size * sign;
}
