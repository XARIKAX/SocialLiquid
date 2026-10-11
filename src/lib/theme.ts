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

export function chartPalette(theme: Theme) {
  return theme === "light"
    ? { bg: "#ffffff", text: "#6b7080", grid: "#eef0f3", border: "#e3e5ea", up: "#16a34a", down: "#e5484d", brand: "#0ea5a0", vol: "#d3d6dd", upSoft: "rgba(22,163,74,0.18)", downSoft: "rgba(229,72,77,0.18)" }
    : { bg: "#0b0b0e", text: "#8b8b98", grid: "#131317", border: "#1b1b21", up: "#22d36b", down: "#ff4d4f", brand: "#4de3c1", vol: "#26262e", upSoft: "rgba(34,211,107,0.22)", downSoft: "rgba(255,77,79,0.22)" };
}
