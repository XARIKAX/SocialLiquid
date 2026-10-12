import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createThesis } from "@/lib/thesis";

/** post a thesis on the caller's current open position in `coin` (without a new trade) */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { coin, text, positionId } = await body(req, z.object({ coin: z.string().min(1).max(20), text: z.string().trim().min(1).max(280), positionId: z.string().optional() }));
  const position = positionId
    ? await prisma.position.findFirst({ where: { id: positionId, address: s.address } })
    : await prisma.position.findFirst({ where: { address: s.address, coin, closedAt: null }, orderBy: { openedAt: "desc" } });
  const thesis = await createThesis({ userId: s.userId, address: s.address, coin, text, position });
  return json({ thesis });
});

/** the caller's own theses that are still live: bound to an open position, or unbound. newest first, for the Positions tab */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const rows = await prisma.thesis.findMany({
    where: { userId: s.userId, OR: [{ position: { is: { closedAt: null } } }, { positionId: null }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, coin: true, text: true, createdAt: true, positionId: true, _count: { select: { likes: true, replies: true } } },
  });
  return json({ theses: rows.map((t) => ({ id: t.id, coin: t.coin, text: t.text, createdAt: t.createdAt, positionId: t.positionId, likes: t._count.likes, replies: t._count.replies })) });
});
