"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { useAuth } from "./use-auth";

export type OpenOrder = { oid: number; coin: string; side: "B" | "A"; type: string; limitPx: number; sz: number; origSz: number; isTrigger: boolean; triggerPx: number; triggerCondition: string; reduceOnly: boolean; isPositionTpsl: boolean; tif: string | null; time: number };
export type HistOrder = Omit<OpenOrder, "triggerCondition" | "isPositionTpsl" | "tif"> & { status: string };
export type AccountFill = { tid: number; coin: string; side: "B" | "A"; dir: string; px: number; sz: number; fee: number; builderFee: number; closedPnl: number; time: number; hash: string; liquidation: boolean };
export type FundingRow = { time: number; coin: string; usdc: number; szi: number; rate: number };
export type TwapRow = { twapId: number | null; coin: string; side: "B" | "A"; sz: number; executedSz: number; executedNtl: number; minutes: number; reduceOnly: boolean; randomize: boolean; status: string; error: string | null; time: number };

function useAcct<T>(key: string, path: string, pick: (r: never) => T, interval = 4000) {
  const { signedIn } = useAuth();
  return useQuery({ queryKey: ["account", key], queryFn: () => api<never>(path).then(pick), enabled: signedIn, refetchInterval: interval });
}

export const useOpenOrders = () => useAcct("orders", "/api/account/orders", (r: { orders: OpenOrder[] }) => r.orders, 3000);
export const useOrderHistory = () => useAcct("history", "/api/account/history", (r: { orders: HistOrder[] }) => r.orders, 8000);
export const useAccountFills = () => useAcct("fills", "/api/account/fills", (r: { fills: AccountFill[] }) => r.fills, 5000);
export const useFundingPayments = () => useAcct("funding", "/api/account/funding", (r: { rows: FundingRow[] }) => r.rows, 30_000);
export const useTwaps = () => useAcct("twap", "/api/account/twap", (r: { twaps: TwapRow[] }) => r.twaps, 4000);

/** ticket bus: clicking a book level or an order price fills the ticket */
export const TICKET_PRICE_EVENT = "sl:ticket-price";
export function pushTicketPrice(px: number) {
  window.dispatchEvent(new CustomEvent(TICKET_PRICE_EVENT, { detail: px }));
}

export type MyThesis = { id: string; coin: string; text: string; createdAt: string; positionId: string | null; likes: number; replies: number };
/** the signed-in user's live theses (open positions or unbound), newest first */
export function useMyTheses(enabled = true) {
  return useQuery({ queryKey: ["my-theses"], queryFn: () => api<{ theses: MyThesis[] }>("/api/thesis").then((r) => r.theses), enabled, staleTime: 10_000 });
}
