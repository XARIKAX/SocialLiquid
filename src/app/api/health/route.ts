import { json } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, HL_API_URL, HL_MOCK, IS_TESTNET } from "@/lib/env";
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
    const zero = /^0x0{40}$/i.test(BUILDER_ADDRESS);
    const builder: Record<string, unknown> = { address: BUILDER_ADDRESS, feePerSide: `${BUILDER_FEE_TENTHS_BP / 1000}%`, configured: !zero };
    if (zero) {
      ok = false;
      builder.problem = "BUILDER_ADDRESS is the zero address: set it (and NEXT_PUBLIC_BUILDER_ADDRESS) to a wallet you control";
    } else {
      try {
        const st = await HL.clearinghouseState(BUILDER_ADDRESS);
        const value = Number(st.marginSummary.accountValue);
        builder.accountValue = value;
        builder.eligible = value >= 100;
        if (value < 100) {
          ok = false;
          builder.problem = `builder account holds $${value.toFixed(2)}; hyperliquid requires at least 100 USDC in the perps account before users can approve the builder fee`;
        }
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
  // native-asset deposits (BTC, ETH, SOL…) ask Unit for addresses; the browser asks first, the server is the fallback
  {
    const u = await unitHealth();
    out.unit = u.ok ? u.detail : `${u.detail} (the browser still asks Unit directly; this only affects the server fallback)`;
  }
  return json({ ok, ...out }, { status: ok ? 200 : 503 });
}
