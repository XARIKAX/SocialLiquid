import { handler, json, HttpError } from "@/lib/api";
import { BUILDER_ADDRESS, BUILDER_FEE_CHARGED, IS_TESTNET } from "@/lib/env";
import { getSession, hasInvite } from "@/lib/session";
import { AGENT_NAME, approvalStatus, builderActive, getOrCreateAgent } from "@/lib/trade";
import { prisma } from "@/lib/db";

/** step 1 of onboarding: mint (or reuse) the agent wallet and report which approvals are still missing */
export const POST = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  if (!(await hasInvite())) throw new HttpError(403, "invite required");
  const agent = await getOrCreateAgent(s.userId);
  const status = await approvalStatus(s.address, agent.agentAddress);
  // a builder hyperliquid will not accept is never asked for: approvalStatus already reports it as nothing to
  // approve, and orders go out without a builder field, so trading works while the fee quietly stays off
  const active = await builderActive();
  const now = new Date();
  if (status.agentApproved && !agent.approvedAt) await prisma.agentKey.update({ where: { id: agent.id }, data: { approvedAt: now } });
  if (status.builderApproved && !agent.builderApprovedAt) await prisma.agentKey.update({ where: { id: agent.id }, data: { builderApprovedAt: now } });
  return json({
    agentAddress: agent.agentAddress,
    agentName: AGENT_NAME,
    needsAgentApproval: !status.agentApproved,
    needsBuilderApproval: !status.builderApproved,
    builder: BUILDER_ADDRESS,
    builderEnabled: active,
    builderFeeTenthsBp: active ? BUILDER_FEE_CHARGED : 0,
    maxFeeRate: "0.1%",
    hyperliquidChain: IS_TESTNET ? "Testnet" : "Mainnet",
  });
});
