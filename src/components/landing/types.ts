import type { FeedItem } from "@/lib/queries";

/** everything the landing page renders, fetched once on the server in app/page.tsx */
export type LandingData = {
  stats: {
    markets: number;
    volume24h: number;
    openInterest: number;
    maxLeverage: number;
    traders: number;
  };
  btc: { markPx: number; change24h: number; volume24h: number; openInterestUsd: number; funding: number; maxLeverage: number } | null;
  /** btc 1h candles for the last 48h (t = open time ms) */
  candles: { t: number; o: number; h: number; l: number; c: number }[];
  /** top markets by 24h volume, for the tape */
  tape: { coin: string; markPx: number; change24h: number; volume24h: number; maxLeverage: number }[];
  items: FeedItem[];
  traders: { address: string; displayName: string | null }[];
  testnet: boolean;
};
