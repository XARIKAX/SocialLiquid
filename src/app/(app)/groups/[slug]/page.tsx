import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { GroupView } from "@/components/groups/group-view";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const g = await prisma.group.findUnique({ where: { slug }, select: { name: true, description: true, _count: { select: { members: true } } } });
  return { title: g ? `${g.name} · group` : "Group", description: g?.description ?? (g ? `${g._count.members} traders sharing their trades on socialLiquid` : undefined) };
}

export default async function GroupPage({ params }: Props) {
  const { slug } = await params;
  return <GroupView slug={slug} />;
}
