/**
 * hand-verified traders that are always tracked, polled ahead of discovered addresses (source MANUAL).
 * copied from app.hyperliquid.xyz/leaderboard (30D) by hand; keep the rank/date note so the list can be audited.
 * extra addresses can be added without a deploy via PINNED_ADDRESSES=0x...,0x... on the worker.
 */
export const FEATURED_ADDRESSES: { address: `0x${string}`; note: string }[] = [
  { address: "0x393d0b87ed38fc779fd9611144ae649ba6082109", note: "hyperliquid leaderboard #1 by 30D pnl, 2026-10-12" },
  { address: "0x488d2a9b70cc18ef66057a48ab3d59da1c59fe08", note: "hyperliquid leaderboard #2 by 30D pnl, 2026-10-12" },
  { address: "0x77375a8c9d13bf79afb2a87f1b0ac1dfd5f5bf66", note: "hyperliquid leaderboard #3 by 30D pnl, 2026-10-12" },
  { address: "0xeadc152ac1014ace57c6b353f89adf5faffe9d55", note: "hyperliquid leaderboard #4 by 30D pnl, 2026-10-12" },
  { address: "0x4eb8d907136189a34c9b087950211b6a566f7819", note: "hyperliquid leaderboard #5 by 30D pnl, 2026-10-12" },
  { address: "0x05cafe987297448f21a3c7ae0ae815fddecac655", note: "hyperliquid leaderboard #6 by 30D pnl, 2026-10-12" },
  { address: "0x85530f0ff6496c72a619f37a60f3c1a59077737f", note: "hyperliquid leaderboard #7 by 30D pnl, 2026-10-12" },
  { address: "0x1ab185be5ff61f7b678d6a871d439307cd0752e3", note: "hyperliquid leaderboard #8 (screenshot showed it #9) by 30D pnl, 2026-10-12" },
  { address: "0x30afce2f6842bf183c7e3fe7162e279ff0b6393e", note: "hyperliquid leaderboard #9 (screenshot showed it #8) by 30D pnl, 2026-10-12" },
  { address: "0x493db0ed7514c975e9abcc110bd40c473b6763e3", note: "hyperliquid leaderboard #10 (screenshot showed 0xb83d...6e36 here; unverified) by 30D pnl, 2026-10-12" },
];

const ADDR = /^0x[0-9a-f]{40}$/;

/** lowercased, deduplicated: committed list + PINNED_ADDRESSES env */
export function featuredAddresses(): string[] {
  const env = (process.env.PINNED_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase());
  const all = [...FEATURED_ADDRESSES.map((f) => f.address.toLowerCase()), ...env].filter((a) => ADDR.test(a));
  return [...new Set(all)];
}
