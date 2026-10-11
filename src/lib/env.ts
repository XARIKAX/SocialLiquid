/** server-side env access. keep NEXT_PUBLIC_* reads in sync with the client bundle. */
export const IS_TESTNET = process.env.NEXT_PUBLIC_HL_TESTNET === "true";
export const HL_MOCK = process.env.HL_MOCK === "true";

export const BUILDER_ADDRESS = (process.env.BUILDER_ADDRESS ??
  process.env.NEXT_PUBLIC_BUILDER_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** builder fee in tenths of a basis point. 50 = 0.05% per side. hard cap 100 (0.1%) on perps. */
export const BUILDER_FEE_TENTHS_BP = Math.min(
  100,
  Math.max(0, Number(process.env.BUILDER_FEE_TENTHS_BP ?? 50)),
);

export const INVITE_CODE = process.env.INVITE_CODE ?? "";
/** mainnet is gated behind an invite code when one is configured. testnet is always open. */
export const INVITE_REQUIRED = !IS_TESTNET && INVITE_CODE.length > 0;

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const HL_API_URL = IS_TESTNET
  ? "https://api.hyperliquid-testnet.xyz"
  : "https://api.hyperliquid.xyz";
export const HL_APP_URL = IS_TESTNET
  ? "https://app.hyperliquid-testnet.xyz"
  : "https://app.hyperliquid.xyz";
export const HL_LEADERBOARD_URL = IS_TESTNET
  ? "https://stats-data.hyperliquid-testnet.xyz/Testnet/leaderboard"
  : "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
