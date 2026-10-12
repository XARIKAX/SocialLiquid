import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { fmtPx, fmtUsd, shortAddr } from "@/lib/format";

export const runtime = "nodejs";
export const alt = "thesis on socialLiquid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OUTCOME: Record<string, { label: string; color: string }> = {
  OPEN: { label: "held", color: "#4cc9f0" },
  PROFIT: { label: "closed in profit", color: "#22c55e" },
  LOSS: { label: "closed at loss", color: "#ef4444" },
  LIQUIDATED: { label: "liquidated", color: "#ef4444" },
  DUMPED: { label: "dumped <1h", color: "#f59e0b" },
};

/** the glass "S" mark, inlined once; the card falls back to the wordmark alone if the file is missing */
let MARK: string | null = null;
try {
  MARK = `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "brand", "mark-128.png")).toString("base64")}`;
} catch {}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await prisma.thesis.findUnique({ where: { id }, include: { user: true, position: true } });
  const who = t ? (t.user.handle ?? shortAddr(t.user.address)) : "socialLiquid";
  const p = t?.position;
  const pnl = p ? Number(p.closedAt ? p.realisedPnl ?? 0 : p.unrealisedPnl) : null;
  const o = OUTCOME[t?.outcome ?? "OPEN"];
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
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 48, fontSize: 40 }}>
          <span style={{ fontWeight: 700 }}>{who}</span>
          {p && <span style={{ color: p.side === "LONG" ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{p.side.toLowerCase()} {t?.coin} {p.leverage}x</span>}
          {!p && <span style={{ color: "#8c8c98" }}>{t?.coin}</span>}
        </div>
        <div style={{ display: "flex", fontSize: 44, lineHeight: 1.25, marginTop: 32, flex: 1, overflow: "hidden" }}>{t?.text ?? "thesis not found"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 32, color: "#8c8c98" }}>
          <span style={{ color: o.color, fontWeight: 700 }}>{o.label}</span>
          {p && <span>entry {fmtPx(Number(p.entryPx))}</span>}
          {p && <span>{fmtUsd(Number(p.sizeUsd), { compact: true })}</span>}
          {pnl !== null && <span style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700, marginLeft: "auto" }}>{fmtUsd(pnl, { sign: true })}</span>}
        </div>
      </div>
    ),
    { ...size },
  );
}
