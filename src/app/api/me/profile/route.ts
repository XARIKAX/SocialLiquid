import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const RESERVED = new Set(["m", "t", "api", "leaderboard", "tokens", "admin", "socialliquid", "me", "trade", "settings", "login"]);
const HANDLE = /^[a-z0-9_]{3,20}$/;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/** optional social username: trims, drops a leading @, empty → null */
const social = (re: RegExp, msg: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/^@/, "") : null))
    .pipe(z.string().regex(re, msg).nullable());

/** GET ?handle=foo → { available } */
export const GET = handler(async (req: Request) => {
  const s = await getSession();
  const h = (new URL(req.url).searchParams.get("handle") ?? "").toLowerCase();
  if (!HANDLE.test(h) || RESERVED.has(h) || h.startsWith("0x")) return json({ available: false, reason: "invalid" });
  const taken = await prisma.user.findFirst({ where: { handle: h, ...(s ? { NOT: { id: s.userId } } : {}) }, select: { id: true } });
  return json({ available: !taken, reason: taken ? "taken" : null });
});

/** create or update the signed-in user's profile. images arrive as data urls already resized by the client. */
export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const b = await body(
    req,
    z.object({
      handle: z.string().transform((h) => h.trim().toLowerCase()).pipe(z.string().regex(HANDLE, "3-20 characters: a-z, 0-9, _")),
      displayName: z.string().trim().min(1, "add a name").max(32),
      bio: z.string().trim().max(160).optional().nullable(),
      xHandle: social(/^[A-Za-z0-9_]{1,15}$/, "invalid X username"),
      tgHandle: social(/^[A-Za-z0-9_]{5,32}$/, "invalid Telegram username"),
      /** undefined = unchanged, null = remove */
      avatar: z.string().regex(IMAGE, "bad image").max(160_000, "avatar too large").optional().nullable(),
      banner: z.string().regex(IMAGE, "bad image").max(700_000, "banner too large").optional().nullable(),
    }),
  );
  if (RESERVED.has(b.handle) || b.handle.startsWith("0x")) throw new HttpError(400, "that handle is reserved");
  const taken = await prisma.user.findFirst({ where: { handle: b.handle, NOT: { id: s.userId } }, select: { id: true } });
  if (taken) throw new HttpError(409, "handle taken");
  const user = await prisma.user.update({
    where: { id: s.userId },
    data: {
      handle: b.handle,
      displayName: b.displayName,
      bio: b.bio ?? null,
      xHandle: b.xHandle ?? null,
      tgHandle: b.tgHandle ?? null,
      ...(b.avatar !== undefined ? { avatarUrl: b.avatar } : {}),
      ...(b.banner !== undefined ? { bannerUrl: b.banner } : {}),
    },
  });
  return json({ user: { id: user.id, address: user.address, handle: user.handle, displayName: user.displayName, xHandle: user.xHandle, tgHandle: user.tgHandle, bio: user.bio, avatarUrl: user.avatarUrl, bannerUrl: user.bannerUrl } });
});
