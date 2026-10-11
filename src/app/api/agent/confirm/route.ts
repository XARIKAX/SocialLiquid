import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HL_MOCK } from "@/lib/env";
import * as mock from "@/lib/hl-mock";
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP } from "@/lib/env";
import { getSession } from "@/lib/session";
import { AGENT_NAME, approvalStatus } from "@/lib/trade";

/** step 2: after the main wallet signed approveAgent / approveBuilderFee, verify on chain and persist */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { agentSigned, builderSigned } = await body(req, z.object({ agentSigned: z.boolean().optional(), builderSigned: z.boolean().optional() }));
  const agent = await prisma.agentKey.findUnique({ where: { userId: s.userId } });
  if (!agent) throw new HttpError(404, "no agent, call prepare first");
  if (HL_MOCK) {
    // the mock has no wallet to sign with: the client's claim is the approval
    if (agentSigned) await mock.mockApproveAgent(s.address, agent.agentAddress, AGENT_NAME);
    if (builderSigned) await mock.mockApproveBuilderFee(s.address, BUILDER_ADDRESS, 100);
  }
  // give the chain a moment to reflect the user-signed actions
  let status = await approvalStatus(s.address, agent.agentAddress);
  for (let i = 0; i < 3 && ((agentSigned && !status.agentApproved) || (builderSigned && !status.builderApproved)); i++) {
    await new Promise((r) => setTimeout(r, 800));
    status = await approvalStatus(s.address, agent.agentAddress);
  }
  const now = new Date();
  const updated = await prisma.agentKey.update({
    where: { id: agent.id },
    data: {
      approvedAt: status.agentApproved ? (agent.approvedAt ?? now) : null,
      builderApprovedAt: status.builderApproved ? (agent.builderApprovedAt ?? now) : null,
    },
  });
  return json({
    agentApproved: !!updated.approvedAt,
    builderApproved: !!updated.builderApprovedAt,
    approvedFeeTenthsBp: status.approvedFeeTenthsBp,
    requiredFeeTenthsBp: BUILDER_FEE_TENTHS_BP,
  });
});
