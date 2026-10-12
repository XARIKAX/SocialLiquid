import { handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import * as HL from "@/lib/hl";
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, HL_MOCK } from "@/lib/env";
import { getSession } from "@/lib/session";
import { approvalStatus, builderActive, builderEligibility } from "@/lib/trade";
import { decrypt } from "@/lib/crypto";
import { privateKeyToAccount } from "viem/accounts";

export const dynamic = "force-dynamic";

/** everything that decides whether this account can trade, read live from hyperliquid: paste it when something refuses */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const out: Record<string, unknown> = { address: s.address, network: HL_MOCK ? "mock" : "mainnet", builder: BUILDER_ADDRESS, builderFeeTenthsBp: BUILDER_FEE_TENTHS_BP };
  try {
    const ch = await HL.clearinghouseState(s.address);
    out.perps = { accountValue: Number(ch.marginSummary.accountValue), withdrawable: Number(ch.withdrawable), positions: ch.assetPositions.length };
  } catch (e) {
    out.perps = `error: ${(e as Error).message}`;
  }
  const abstraction = await HL.userAbstraction(s.address);
  out.abstraction = abstraction ?? "unknown";
  out.unified = HL.isUnified(abstraction);
  try {
    out.spot = await HL.spotBalances(s.address);
  } catch (e) {
    out.spot = `error: ${(e as Error).message}`;
  }
  const agent = await prisma.agentKey.findUnique({ where: { userId: s.userId } });
  if (!agent) out.agent = "none yet (prepare has not run)";
  else {
    let signer: string | null = null;
    let keyOk = true;
    try {
      signer = privateKeyToAccount(decrypt(agent.encryptedPrivKey) as `0x${string}`).address.toLowerCase();
    } catch (e) {
      keyOk = false;
      out.agentKeyError = `cannot decrypt the agent key: ${(e as Error).message} (AGENT_KEY_SECRET changed since the agent was created?)`;
    }
    const st = await approvalStatus(s.address, agent.agentAddress).catch((e) => ({ error: (e as Error).message }));
    let onChainAgents: unknown = null;
    try {
      onChainAgents = await HL.extraAgents(s.address);
    } catch (e) {
      onChainAgents = `error: ${(e as Error).message}`;
    }
    out.agent = { address: agent.agentAddress, signerMatchesStoredAddress: keyOk ? signer === agent.agentAddress.toLowerCase() : false, dbApprovedAt: agent.approvedAt, dbBuilderApprovedAt: agent.builderApprovedAt, onChain: st, onChainAgents };
  }
  const builder = await builderEligibility({ fresh: true });
  const builderOn = await builderActive();
  out.builderEligible = builderOn
    ? `ok${builder.accountValue === null ? "" : ` ($${builder.accountValue.toFixed(2)} in the builder perps account)`}`
    : `off, so no fee is charged and nothing needs approving${builder.ok ? "" : ` — ${builder.reason}`}`;
  const perps = out.perps as { accountValue?: number } | string;
  const spotUsdc = Array.isArray(out.spot) ? (out.spot as { coin: string; total: number }[]).find((b) => b.coin === "USDC")?.total ?? 0 : null;
  const spotCoins = Array.isArray(out.spot) ? (out.spot as { coin: string; total: number }[]).filter((b) => b.coin !== "USDC" && b.total > 0).map((b) => b.coin) : [];
  out.verdict = typeof perps === "string"
      ? "hyperliquid did not answer for this address"
      : HL.isUnified(abstraction)
        ? "unified account: spot and perps share one margin pool, so nothing needs moving and usdClassTransfer is refused by design"
        : (perps.accountValue ?? 0) < 0.5 && (spotUsdc ?? 0) >= 0.5
          ? "USDC is in spot, not perps: move it to perps first (the enable-trading step now does this)"
        : (perps.accountValue ?? 0) < 0.5 && spotCoins.length > 0
          ? `spot-only account (${spotCoins.join(", ")}): enable trading, then Sell for USDC (agent-signed) and the USDC moves to perps`
          : (perps.accountValue ?? 0) < 0.5
            ? "no balance in perps or spot: deposit first"
          : "funds are in perps; approvals should register";
  return json(out);
});
