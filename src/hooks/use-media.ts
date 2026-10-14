"use client";
import { useEffect, useState } from "react";

/** true / false once mounted, undefined during ssr and the first paint */
export function useMediaQuery(q: string): boolean | undefined {
  const [m, setM] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}
