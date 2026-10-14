import { handler, json } from "@/lib/api";
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, INVITE_REQUIRED, IS_TESTNET, HL_MOCK } from "@/lib/env";
import { hasInvite, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({
    user: user
      ? {
          id: user.id,
          address: user.address,
          handle: user.handle,
          displayName: user.displayName,
          xHandle: user.xHandle,
          tgHandle: user.tgHandle,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          bannerUrl: user.bannerUrl,
          style: user.style,
          pinnedThesisId: user.pinnedThesisId,
          pinnedPositionId: user.pinnedPositionId,
          agent: user.agentKey
            ? { agentAddress: user.agentKey.agentAddress, approved: !!user.agentKey.approvedAt, builderApproved: !!user.agentKey.builderApprovedAt }
            : null,
        }
      : null,
    invite: { required: INVITE_REQUIRED, ok: await hasInvite() },
    network: HL_MOCK ? "mock" : IS_TESTNET ? "testnet" : "mainnet",
    builder: { address: BUILDER_ADDRESS, feeTenthsBp: BUILDER_FEE_TENTHS_BP },
  });
});
