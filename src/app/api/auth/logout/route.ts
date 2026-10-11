import { handler, json } from "@/lib/api";
import { clearSession } from "@/lib/session";

export const POST = handler(async () => {
  await clearSession();
  return json({ ok: true });
});
