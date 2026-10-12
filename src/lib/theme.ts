"use client";
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "sl:theme";
const EVT = "sl:theme-change";

export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVT, { detail: t }));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>("dark");
  useEffect(() => {
    // fallback for pages whose inline init script did not run (e.g. streamed not-found shells)
    try {
      const stored = localStorage.getItem(KEY) === "light" ? "light" : "dark";
      if (stored !== getTheme()) document.documentElement.dataset.theme = stored;
    } catch {}
    setT(getTheme());
    const h = (e: Event) => setT((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  return [t, setTheme];
}

/** runs before paint so the first frame already has the stored theme */
export const THEME_INIT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t==="light"){document.documentElement.dataset.theme="light"}}catch(e){}})();`;

/**
 * chart colors, per theme. dark follows the landing terminal mock: lit gradient candles
 * (pale crown, saturated body, deep foot), translucent wicks, near-invisible grid, glass
 * crosshair labels. light is the same structure on paper, with quieter glows.
 */
export function chartPalette(theme: Theme) {
  return theme === "light"
    ? {
        bg: "#f7f7f4",
        bgTop: "#fbfbf8",
        bgBot: "#f3f3ef",
        text: "#666a74",
        textStrong: "#3a3c43",
        grid: "rgba(28,29,33,0.055)",
        gridV: "rgba(28,29,33,0.035)",
        border: "rgba(28,29,33,0.09)",
        up: "#1f9d55",
        down: "#d9444a",
        upTop: "#5fd394",
        upBot: "#16773f",
        downTop: "#f08f93",
        downBot: "#b3333a",
        wickUp: "rgba(31,157,85,0.78)",
        wickDown: "rgba(217,68,74,0.75)",
        glowUp: "rgba(31,157,85,0.35)",
        glowDown: "rgba(217,68,74,0.3)",
        brand: "#0f9f98",
        brand2: "#12b3a8",
        thesis: "#3f6ae0",
        warn: "#a8721c",
        vol: "#d6d6cf",
        upSoft: "rgba(31,157,85,0.14)",
        downSoft: "rgba(217,68,74,0.13)",
        cross: "rgba(28,29,33,0.32)",
        crossLabel: "#2b2e35",
        ink: "#25272d",
        areaTop: "rgba(15,159,152,0.2)",
        areaBot: "rgba(15,159,152,0)",
        fundUp: "rgba(15,159,152,0.18)",
        fundDown: "rgba(217,68,74,0.16)",
        ind: { ema20: "#0f9f98", ema50: "#8b5cf6", sma20: "#c98a12", sma50: "#3f6ae0", sma200: "#d9547a", bb: "#7d828c", vwap: "#1593c9" },
      }
    : {
        bg: "#0b1014",
        bgTop: "#0f161b",
        bgBot: "#0a0e12",
        text: "#7f8b97",
        textStrong: "#c3ccd3",
        grid: "rgba(255,255,255,0.042)",
        gridV: "rgba(255,255,255,0.026)",
        border: "rgba(255,255,255,0.065)",
        up: "#45e3a6",
        down: "#ff5a5c",
        upTop: "#b4ffe2",
        upBot: "#169c57",
        downTop: "#ffb0b1",
        downBot: "#b3292b",
        wickUp: "rgba(125,245,190,0.72)",
        wickDown: "rgba(255,125,127,0.7)",
        glowUp: "rgba(69,227,166,0.75)",
        glowDown: "rgba(255,90,92,0.65)",
        brand: "#4de3c1",
        brand2: "#97fce4",
        thesis: "#6b93ff",
        warn: "#f5b236",
        vol: "#26262e",
        upSoft: "rgba(69,227,166,0.15)",
        downSoft: "rgba(255,90,92,0.14)",
        cross: "rgba(195,204,211,0.36)",
        crossLabel: "#1e2930",
        ink: "#e6f4f0",
        areaTop: "rgba(77,227,193,0.24)",
        areaBot: "rgba(77,227,193,0)",
        fundUp: "rgba(77,227,193,0.22)",
        fundDown: "rgba(255,90,92,0.2)",
        ind: { ema20: "#4de3c1", ema50: "#c084fc", sma20: "#f5b236", sma50: "#6b93ff", sma200: "#ff8fa0", bb: "#8b98a5", vwap: "#5ccfff" },
      };
}
