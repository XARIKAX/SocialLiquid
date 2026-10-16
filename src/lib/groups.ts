import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { HttpError } from "./api";
import { streaksBulk } from "./points";
import { traderStatsBulk, type TraderStats, type UserLite } from "./queries";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function mintJoinCode(): string {
  const b = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "group";
}

const RESERVED = new Set(["new", "mine", "public", "api"]);

/** a slug nobody holds yet: the name, then name-2, name-3 … */
export async function freeSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (RESERVED.has(slug)) continue;
    if (!(await prisma.group.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export type GroupLite = { id: string; slug: string; name: string; description: string | null; isPublic: boolean; createdAt: string; members: number; owner: { address: string; handle: string | null; displayName: string | null; avatarUrl: string | null }; isMember: boolean; role: "OWNER" | "MEMBER" | null; preview: { address: string; avatarUrl: string | null; handle: string | null }[] };

export type GroupMemberRow = { user: UserLite; role: string; joinedAt: string; stats: TraderStats; streak: number; isFollowing: boolean };

export async function groupBySlug(slug: string) {
  const g = await prisma.group.findUnique({ where: { slug }, include: { owner: { select: { address: true, handle: true, displayName: true, avatarUrl: true } }, _count: { select: { members: true } } } });
  if (!g) throw new HttpError(404, "group not found");
  return g;
}

export async function membershipOf(groupId: string, userId: string | undefined) {
  if (!userId) return null;
  return prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
}

/** private groups show nothing to outsiders */
export async function requireReadable(slug: string, userId: string | undefined) {
  const g = await groupBySlug(slug);
  const m = await membershipOf(g.id, userId);
  if (!g.isPublic && !m) throw new HttpError(403, "members only");
  return { group: g, membership: m };
}

export async function memberAddresses(groupId: string): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({ where: { groupId }, select: { user: { select: { address: true } } } });
  return rows.map((r) => r.user.address);
}

export async function groupLite(g: Awaited<ReturnType<typeof groupBySlug>>, membership: { role: string } | null): Promise<GroupLite> {
  const preview = await prisma.groupMember.findMany({ where: { groupId: g.id }, take: 5, orderBy: { joinedAt: "asc" }, select: { user: { select: { address: true, avatarUrl: true, handle: true } } } });
  return { id: g.id, slug: g.slug, name: g.name, description: g.description, isPublic: g.isPublic, createdAt: g.createdAt.toISOString(), members: g._count.members, owner: g.owner, isMember: !!membership, role: (membership?.role as "OWNER" | "MEMBER" | undefined) ?? null, preview: preview.map((p) => p.user) };
}

/** members with stats, streak and whether the viewer follows them; ranked by the caller */
export async function groupMembers(groupId: string, viewerId: string | undefined): Promise<GroupMemberRow[]> {
  const rows = await prisma.groupMember.findMany({ where: { groupId }, orderBy: { joinedAt: "asc" }, include: { user: { select: { id: true, address: true, handle: true, displayName: true, xHandle: true, avatarUrl: true, claimedAt: true, style: true, winStreak: true, points: true } } } });
  const addrs = rows.map((r) => r.user.address);
  const [stats, streaks, following] = await Promise.all([
    traderStatsBulk(addrs),
    streaksBulk(addrs),
    viewerId ? prisma.follow.findMany({ where: { followerId: viewerId, followingId: { in: rows.map((r) => r.userId) } }, select: { followingId: true } }) : [],
  ]);
  const f = new Set(following.map((x) => x.followingId));
  return rows.map((r) => ({
    user: { id: r.user.id, address: r.user.address, handle: r.user.handle, displayName: r.user.displayName, xHandle: r.user.xHandle, avatarUrl: r.user.avatarUrl, claimed: !!r.user.claimedAt, style: r.user.style, winStreak: r.user.winStreak, points: r.user.points },
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
    stats: stats.get(r.user.address)!,
    streak: streaks.get(r.user.address)?.current ?? 0,
    isFollowing: f.has(r.userId),
  }));
}
