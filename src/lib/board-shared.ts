/** leaderboard vocabulary shared by the server queries and the client boards. free of prisma and node built-ins so client bundles can import it */

/** how the account trades, from hold time and activity. "bot" covers market makers and HFT: not something a human copies */
export type TradeStyle = "bot" | "scalper" | "day" | "swing" | "position" | null;
export const TRADE_STYLE_LABEL: Record<Exclude<TradeStyle, null>, string> = { bot: "market maker / bot", scalper: "scalper", day: "day trader", swing: "swing", position: "position" };

export type SizeBucket = "s" | "m" | "l" | "xl";
export const SIZE_BUCKETS: { key: SizeBucket; label: string; min: number; max: number }[] = [
  { key: "s", label: "under $10K", min: 0, max: 10_000 },
  { key: "m", label: "$10K to $100K", min: 10_000, max: 100_000 },
  { key: "l", label: "$100K to $1M", min: 100_000, max: 1_000_000 },
  { key: "xl", label: "$1M and up", min: 1_000_000, max: Number.POSITIVE_INFINITY },
];
export const inSizeBucket = (v: number | null | undefined, b: SizeBucket | undefined) => {
  if (!b) return true;
  if (v === null || v === undefined) return false;
  const r = SIZE_BUCKETS.find((x) => x.key === b)!;
  return v >= r.min && v < r.max;
};
