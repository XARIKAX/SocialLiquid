import { json } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { HL_API_URL, HL_MOCK, IS_TESTNET } from "@/lib/env";

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
    },
  };
  let ok = true;
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
  return json({ ok, ...out }, { status: ok ? 200 : 503 });
}
