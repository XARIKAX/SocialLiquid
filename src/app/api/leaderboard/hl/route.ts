import { handler, json } from "@/lib/api";
import { hlLeaderboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** hyperliquid's own leaderboard (30D window), mirrored by the worker. figures are hyperliquid's, not ours. */
export const GET = handler(async () => json(await hlLeaderboard()));
