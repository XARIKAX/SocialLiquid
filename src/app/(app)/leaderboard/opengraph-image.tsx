import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { hlLeaderboard } from "@/lib/queries";
import { fmtUsd, shortAddr } from "@/lib/format";

export const runtime = "nodejs";
/** rendered on request, never at build: the board changes hourly */
export const dynamic = "force-dynamic";
export const alt = "this week's top traders on socialLiquid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

let MARK: string | null = null;
try {
  MARK = `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "brand", "mark-128.png")).toString("base64")}`;
} catch {}

/** the week's top 10 by pnl, shareable: /leaderboard unfurls to this */
export default async function Image() {
  const board = await hlLeaderboard({ window: "week", limit: 10 }).catch(() => null);
  const rows = board?.rows ?? [];
  const name = (r: (typeof rows)[number]) => r.user.displayName ?? (r.user.handle ? `@${r.user.handle}` : shortAddr(r.user.address));
  const top = rows[0];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0a0a0c", color: "#e8e8ec", padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 32, fontWeight: 700 }}>
          {MARK && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={MARK} width={34} height={42} alt="" style={{ marginRight: 12 }} />
          )}
          <span>social</span>
          <span style={{ color: "#4cc9f0" }}>Liquid</span>
          <span style={{ color: "#8c8c98", fontWeight: 400, marginLeft: 18 }}>this week on Hyperliquid</span>
        </div>
        <div style={{ display: "flex", flex: 1, gap: 40, marginTop: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 420 }}>
            <div style={{ display: "flex", fontSize: 22, color: "#8c8c98" }}>Trader of the week</div>
            <div style={{ display: "flex", fontSize: 54, fontWeight: 700, lineHeight: 1.05, marginTop: 8 }}>{top ? name(top) : "—"}</div>
            {top && <div style={{ display: "flex", fontSize: 48, fontWeight: 700, color: "#22c55e", marginTop: 14 }}>{fmtUsd(top.pnl, { sign: true, compact: true })}</div>}
            {top && <div style={{ display: "flex", fontSize: 22, color: "#8c8c98", marginTop: 8 }}>ROI {(top.roi * 100).toFixed(1)}% · {fmtUsd(top.vlm, { compact: true })} volume</div>}
            <div style={{ display: "flex", fontSize: 20, color: "#8c8c98", marginTop: "auto" }}>Follow them and copy their next trade in one click. socialliquid.fun</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, fontSize: 24 }}>
            {rows.slice(0, 10).map((r, i) => (
              <div key={r.user.address} style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #1f1f26" }}>
                <span style={{ width: 44, color: i < 3 ? "#4cc9f0" : "#8c8c98", fontWeight: 700 }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{name(r)}</span>
                <span style={{ color: "#22c55e", fontWeight: 700 }}>{fmtUsd(r.pnl, { sign: true, compact: true })}</span>
              </div>
            ))}
            {!rows.length && <div style={{ display: "flex", color: "#8c8c98" }}>board warming up</div>}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
