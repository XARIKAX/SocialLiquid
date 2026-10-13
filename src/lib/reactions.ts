import { prisma } from "./db";

export const EMOJIS = ["fire", "skull", "eyes"] as const;
export type Emoji = (typeof EMOJIS)[number];
export const EMOJI_CHAR: Record<Emoji, string> = { fire: "🔥", skull: "💀", eyes: "👀" };
export type ReactionSummary = { fire: number; skull: number; eyes: number; mine: Emoji[] };

/** per-emoji counts for a set of feed events, plus the viewer's own reactions */
export async function reactionCounts(eventIds: string[], viewerId?: string): Promise<Map<string, ReactionSummary>> {
  const out = new Map<string, ReactionSummary>();
  for (const id of eventIds) out.set(id, { fire: 0, skull: 0, eyes: 0, mine: [] });
  if (!eventIds.length) return out;
  const [rows, mine] = await Promise.all([
    prisma.reaction.groupBy({ by: ["eventId", "emoji"], where: { eventId: { in: eventIds } }, _count: { _all: true } }),
    viewerId ? prisma.reaction.findMany({ where: { eventId: { in: eventIds }, userId: viewerId }, select: { eventId: true, emoji: true } }) : [],
  ]);
  for (const r of rows) {
    const o = out.get(r.eventId);
    if (o && (EMOJIS as readonly string[]).includes(r.emoji)) o[r.emoji as Emoji] = r._count._all;
  }
  for (const m of mine) out.get(m.eventId)?.mine.push(m.emoji as Emoji);
  return out;
}
