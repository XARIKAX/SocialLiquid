import { builderEligibility } from "@/lib/trade";
import { getHlBoardStatus } from "@/lib/indexer";
import { json } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { BUILDER_ADDRESS, BUILDER_ENABLED, BUILDER_FEE_TENTHS_BP, HL_API_URL, HL_MOCK, IS_TESTNET } from "@/lib/env";
import { unitHealth } from "@/lib/unit-server";

export const dynamic = "force-dynamic";

/** deploy diagnostics: db reachable, schema present, hyperliquid reachable */
export async function GET() {
  const out: Record<string, unknown> = {
    network: HL_MOCK ? "mock" : IS_TESTNET ? "testnet" : "mainnet",
    hlApi: HL_API_URL,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? "set" : "MISSING",
      AGENT_KEY_SECRET: process.env.AGENT_KEY_SECRET ? "set" : "MISSING",
      SESSION_SECRET: process.env.SESSION_SECRET ? "set" : "MISSING",
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "MISSING",
      NEXT_PUBLIC_WALLETCONNECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_ID ? "set" : "MISSING (WalletConnect row shows as not configured)",
    },
  };
  let ok = true;
  // builder code: the fee only accrues to a configured address, and hyperliquid only lets users approve a builder
  // whose perps account holds at least 100 USDC. report both so a misconfiguration is visible before launch.
  {
    const builder: Record<string, unknown> = BUILDER_ENABLED
      ? { address: BUILDER_ADDRESS, feePerSide: `${BUILDER_FEE_TENTHS_BP / 1000}%`, configured: true }
      : { configured: false, note: "running without a builder code: orders carry no builder field and enabling trading needs one signature, not two. Set BUILDER_ADDRESS (funded with 100 USDC in its perps account) and BUILDER_FEE_TENTHS_BP to collect a fee." };
    // a deployment can legitimately run with no builder code, so only a configured one is checked
    if (BUILDER_ENABLED) {
      try {
        const b = await builderEligibility({ fresh: true });
        builder.accountValue = b.accountValue;
        builder.spotUsdc = b.spotUsdc ?? null;
        builder.eligible = b.ok;
        // not a failure: the app drops the builder field and trades on, it just earns nothing until funded
        builder.collecting = b.ok;
        if (!b.ok) builder.problem = `${b.reason} Until then no fee is being charged.`;
      } catch (e) {
        builder.eligible = null;
        builder.problem = `could not read the builder account: ${(e as Error).message}`;
      }
    }
    out.builder = builder;
  }
  try {
    await prisma.$queryRaw`select 1`;
    out.db = "ok";
  } catch (e) {
    ok = false;
    out.db = `error: ${(e as Error).message.split("\n").filter(Boolean).slice(-1)[0]}`;
  }
  try {
    const n = await prisma.trackedAddress.count();
    out.schema = `ok (${n} tracked addresses)`;
  } catch (e) {
    ok = false;
    out.schema = `error: ${(e as Error).message.split("\n").filter(Boolean).slice(-1)[0]} (run: pnpm prisma db push)`;
  }
  try {
    const mids = await HL.allMids();
    out.hyperliquid = `ok (${Object.keys(mids).length} markets)`;
  } catch (e) {
    ok = false;
    out.hyperliquid = `error: ${(e as Error).message}`;
  }
  // the leaderboard mirror: where the rows came from and why the fallback is showing, if it is
  try {
    const [n, first] = await Promise.all([prisma.hlLeaderboardEntry.count(), prisma.hlLeaderboardEntry.findFirst({ orderBy: { rank: "asc" }, select: { source: true, updatedAt: true } })]);
    const st = getHlBoardStatus();
    out.leaderboard = { rows: n, source: first?.source ?? null, updatedAt: first?.updatedAt ?? null, lastError: st.lastError, lastAttemptAt: st.lastAttemptAt ? new Date(st.lastAttemptAt).toISOString() : null, note: first?.source === "portfolio" ? "fallback: featured traders rebuilt from the portfolio api because the leaderboard feed failed; the worker retries hourly" : null };
  } catch (e) {
    out.leaderboard = `error: ${(e as Error).message}`;
  }
  // native-asset deposits (BTC, ETH, SOL…) ask Unit for addresses; the browser asks first, the server is the fallback
  {
    const u = await unitHealth();
    out.unit = u.ok ? u.detail : `${u.detail} (the browser still asks Unit directly; this only affects the server fallback)`;
  }
  return json({ ok, ...out }, { status: ok ? 200 : 503 });
}
