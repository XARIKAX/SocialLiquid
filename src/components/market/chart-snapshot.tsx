import type { IChartApi, ISeriesApi, SeriesType, Time } from "lightweight-charts";
import type { chartPalette } from "@/lib/theme";
import { fmtFixed } from "./chart-lib";
import { withAlpha } from "./chart-series";

/* =====================================================================
   snapshot: the chart on its own glass. the library's canvas (with the
   series markers) gets the card gradient and the teal pool behind it,
   the drawings (serialized svg, at rest), the last-price tag, and a
   header line with the market, the interval and the brand.
   ===================================================================== */

type Pal = ReturnType<typeof chartPalette>;

export async function downloadSnapshot(o: {
  chart: IChartApi;
  host: HTMLElement;
  /** the drawing layer, or null when drawings are hidden or empty */
  svg: SVGSVGElement | null;
  pal: Pal;
  light: boolean;
  main: ISeriesApi<SeriesType, Time> | null;
  live: { close: number; dir: "up" | "down" } | null;
  prec: number;
  title: string;
  subtitle: string;
  fileName: string;
}) {
  const { chart: c, pal: p } = o;
  const shot = c.takeScreenshot(true);
  const k = shot.width / Math.max(1, o.host.clientWidth);
  const head = Math.round(44 * k);
  const out = document.createElement("canvas");
  out.width = shot.width;
  out.height = shot.height + head;
  const ctx = out.getContext("2d");
  if (!ctx) return;
  const g = ctx.createLinearGradient(0, 0, 0, out.height);
  g.addColorStop(0, p.bgTop);
  g.addColorStop(1, p.bgBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, out.width, out.height);
  const cx = out.width * 0.8;
  const cy = head + shot.height * 0.42;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, out.width * 0.55);
  rg.addColorStop(0, withAlpha(p.brand, o.light ? 0.05 : 0.08));
  rg.addColorStop(1, withAlpha(p.brand, 0));
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(shot, 0, head);
  if (o.svg) {
    try {
      const sw = o.svg.clientWidth;
      const sh = o.svg.clientHeight;
      const clone = o.svg.cloneNode(true) as SVGSVGElement;
      // drawings at rest: no handles, no selection tint
      clone.querySelectorAll(".tm-chart-dw-handle").forEach((el) => el.remove());
      clone.querySelectorAll("[data-sel] .tm-chart-dw-ink").forEach((el) => el.setAttribute("stroke", p.thesis));
      clone.querySelectorAll("[data-sel] .tm-chart-dw-pill").forEach((el) => el.setAttribute("fill", p.thesis));
      clone.setAttribute("width", String(sw));
      clone.setAttribute("height", String(sh));
      clone.setAttribute("viewBox", `0 0 ${sw} ${sh}`);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
      await img.decode();
      ctx.drawImage(img, 0, head, sw * k, sh * k);
    } catch {}
  }
  const root = getComputedStyle(document.documentElement);
  const mono = root.getPropertyValue("--font-geist-mono").trim() || "monospace";
  const sans = root.getPropertyValue("--font-geist-sans").trim() || "sans-serif";
  if (o.live && o.main) {
    const y = o.main.priceToCoordinate(o.live.close);
    if (y !== null) {
      const aw = c.priceScale("right").width();
      const pw = c.paneSize().width;
      ctx.fillStyle = o.live.dir === "up" ? p.up : p.down;
      ctx.beginPath();
      ctx.roundRect?.((pw + 3) * k, head + (y - 10) * k, (aw - 6) * k, 20 * k, 6 * k);
      ctx.fill();
      ctx.fillStyle = o.light ? "#ffffff" : "#04120d";
      ctx.font = `600 ${11 * k}px ${mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fmtFixed(o.live.close, o.prec), (pw + aw / 2) * k, head + y * k);
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.textStrong;
  ctx.font = `600 ${14 * k}px ${sans}`;
  ctx.fillText(o.title, 16 * k, head / 2);
  const tw = ctx.measureText(o.title).width;
  ctx.fillStyle = p.text;
  ctx.font = `500 ${11 * k}px ${mono}`;
  ctx.fillText(`${o.subtitle}  ·  ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, 16 * k + tw + 12 * k, head / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = p.brand;
  ctx.font = `600 ${12 * k}px ${sans}`;
  ctx.fillText("socialLiquid", out.width - 16 * k, head / 2);
  ctx.fillStyle = p.border;
  ctx.fillRect(0, head - Math.max(1, Math.round(k)), out.width, Math.max(1, Math.round(k)));
  const a = document.createElement("a");
  a.href = out.toDataURL("image/png");
  a.download = o.fileName;
  a.click();
}
