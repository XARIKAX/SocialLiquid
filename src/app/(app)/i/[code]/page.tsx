import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { inviterByCode, normaliseCode } from "@/lib/invites";
import { traderStats } from "@/lib/queries";
import { InviteLanding } from "@/components/invite/invite-landing";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const u = await inviterByCode(code);
  const who = u ? (u.displayName ?? (u.handle ? `@${u.handle}` : "a trader")) : "a trader";
  return { title: `${who} invited you to socialLiquid`, description: "the social layer for hyperliquid. see what traders open in real time, copy them in one tap, trade perps and spot in the same terminal." };
}

export default async function InviteLandingPage({ params }: Props) {
  const { code } = await params;
  const u = await inviterByCode(code);
  if (!u) notFound();
  const [stats, followers, invited] = await Promise.all([traderStats(u.address), prisma.follow.count({ where: { followingId: u.id } }), prisma.user.count({ where: { invitedById: u.id } })]);
  return <InviteLanding code={normaliseCode(code)} inviter={{ address: u.address, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl }} stats={{ closedTrades: stats.closedTrades, winRate: stats.winRate, pnl30d: stats.pnl30d, copiers: stats.copiers, followers, invited }} />;
}
