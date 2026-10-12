/**
 * print hyperliquid's leaderboard top N (30D), full addresses, same rule and order as app.hyperliquid.xyz/leaderboard.
 * run: pnpm hl:top            (top 10)
 *      pnpm hl:top 25         (top 25)
 * needs network access to stats-data.hyperliquid.xyz. HL_MOCK must not be set.
 */
import "dotenv/config";
import * as HL from "../src/lib/hl";
import { hlLeaderboardRanked } from "../src/lib/indexer";

const n = Number(process.argv[2] ?? 10);
const usd = (v: string | number) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const rows = hlLeaderboardRanked(await HL.leaderboard()).slice(0, n);
console.log(["rank", "address", "name", "accountValue", "pnl30d", "roi30d", "vlm30d"].join("\t"));
for (const [i, r] of rows.entries()) {
  const m = r.windowPerformances.find(([k]) => k === "month")?.[1] ?? { pnl: "0", roi: "0", vlm: "0" };
  console.log([i + 1, r.ethAddress, r.displayName ?? "", usd(r.accountValue), usd(m.pnl), (Number(m.roi) * 100).toFixed(2) + "%", usd(m.vlm)].join("\t"));
}
console.log("\nSEED_ADDRESSES=" + rows.map((r) => r.ethAddress.toLowerCase()).join(","));
