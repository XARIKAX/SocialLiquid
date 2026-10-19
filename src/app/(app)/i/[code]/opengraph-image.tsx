import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { inviterByCode, normaliseCode } from "@/lib/invites";
import { traderStats } from "@/lib/queries";
import { fmtUsd, shortAddr } from "@/lib/format";

export const runtime = "nodejs";
export const alt = "invite to socialLiquid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

let MARK: string | null = null;
try {
  MARK = `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "brand", "mark-128.png")).toString("base64")}`;
} catch {}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const u = await inviterByCode(code);
  const who = u ? (u.displayName ?? u.handle ?? shortAddr(u.address)) : "a trader";
  const st = u ? await traderStats(u.address).catch(() => null) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0a0a0c", color: "#e8e8ec", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700 }}>
          {MARK && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={MARK} width={40} height={49} alt="" style={{ marginRight: 14 }} />
          )}
          <span>social</span>
          <span style={{ color: "#4cc9f0" }}>Liquid</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 72, flex: 1 }}>
          <div style={{ display: "flex", fontSize: 40, color: "#8c8c98" }}>{who} invited you to</div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1, marginTop: 8 }}>the social layer for perpetual markets</div>
          <div style={{ display: "flex", fontSize: 32, color: "#8c8c98", marginTop: 28 }}>see what traders open in real time · copy in one tap · perps and spot in one terminal</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 30, color: "#8c8c98" }}>
          {st && st.closedTrades > 0 && <span>{st.closedTrades} trades</span>}
          {st && st.winRate !== null && <span>{Math.round(st.winRate * 100)}% win rate</span>}
          {st && <span style={{ color: st.pnl30d >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{fmtUsd(st.pnl30d, { sign: true, compact: true })} 30d</span>}
          <span style={{ marginLeft: "auto", color: "#4cc9f0", fontWeight: 700 }}>code {normaliseCode(code)}</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
