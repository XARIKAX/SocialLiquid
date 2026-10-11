import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

const RESERVED = new Set(["m", "t", "api", "leaderboard", "tokens", "admin", "socialliquid", "me"]);

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { handle, xHandle } = await body(
    req,
    z.object({
      handle: z.string().regex(/^[a-z0-9_]{3,20}$/, "3-20 chars, a-z 0-9 _").transform((h) => h.toLowerCase()),
      xHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).optional().nullable(),
    }),
  );
  if (RESERVED.has(handle) || handle.startsWith("0x")) throw new HttpError(400, "that handle is reserved");
  const taken = await prisma.user.findFirst({ where: { handle, NOT: { id: s.userId } } });
  if (taken) throw new HttpError(409, "handle taken");
  const user = await prisma.user.update({ where: { id: s.userId }, data: { handle, xHandle: xHandle ?? null } });
  return json({ user: { id: user.id, address: user.address, handle: user.handle, xHandle: user.xHandle } });
});
