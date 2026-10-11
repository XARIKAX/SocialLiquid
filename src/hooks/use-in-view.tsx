"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** render children once the placeholder scrolls near the viewport. keeps below-the-fold cards off the hydration path on mobile. */
export function Deferred({ children, minHeight = 200, className = "" }: { children: ReactNode; minHeight?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    if (!("IntersectionObserver" in window)) return setShow(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);
  return (
    <div ref={ref} className={className} style={show ? undefined : { minHeight }}>
      {show ? children : <div className="card skeleton h-full" style={{ minHeight }} />}
    </div>
  );
}
