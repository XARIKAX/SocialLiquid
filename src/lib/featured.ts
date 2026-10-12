/**
 * hand-verified traders that are always tracked, polled ahead of discovered addresses (source MANUAL).
 * copied from app.hyperliquid.xyz/leaderboard (30D) by hand; keep the rank/date note so the list can be audited.
 * extra addresses can be added without a deploy via PINNED_ADDRESSES=0x...,0x... on the worker.
 */
export const FEATURED_ADDRESSES: { address: `0x${string}`; note: string }[] = [
  { address: "0x393d0b87ed38fc779fd9611144ae649ba6082109", note: "hyperliquid leaderboard #1 by 30D pnl, 2026-10-12" },
];

const ADDR = /^0x[0-9a-f]{40}$/;

/** lowercased, deduplicated: committed list + PINNED_ADDRESSES env */
export function featuredAddresses(): string[] {
  const env = (process.env.PINNED_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase());
  const all = [...FEATURED_ADDRESSES.map((f) => f.address.toLowerCase()), ...env].filter((a) => ADDR.test(a));
  return [...new Set(all)];
}
