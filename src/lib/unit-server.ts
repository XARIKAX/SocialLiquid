/** server side of the Unit integration: the proxy's target and a reachability probe for /api/health */
export const UNIT_API = process.env.UNIT_API_URL ?? "https://api.hyperunit.xyz";
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://socialliquid.fun";
/** Unit's api sits behind a WAF that is happier with browser-shaped requests; these are what a browser would send */
export const UNIT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  origin: APP,
  referer: `${APP}/`,
};

/** can the server reach Unit at all? uses the fee-estimate endpoint, which generates nothing */
export async function unitHealth(): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${UNIT_API}/estimate-fees`, { signal: ctrl.signal, headers: UNIT_HEADERS, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: `${UNIT_API} answered ${res.status}: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)}` };
    return { ok: true, detail: `ok (${UNIT_API})` };
  } catch (e) {
    return { ok: false, detail: `error: ${(e as Error).name === "AbortError" ? "timeout" : (e as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}
