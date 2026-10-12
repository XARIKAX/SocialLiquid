"use client";

import { useState } from "react";

/* the ticker moves on its own and carries real prices, so it gets a real pause (wcag 2.2.2).
   the strip reads the pressed state through a sibling selector: no ancestor mutation */
export function TapeToggle() {
  const [paused, setPaused] = useState(false);
  return (
    <button type="button" className="lp-tape-toggle" aria-pressed={paused} aria-label="Pause market ticker" onClick={() => setPaused((p) => !p)}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        {paused ? (
          <path d="M3 1.8v6.4L8.2 5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        ) : (
          <path d="M3.2 2v6M6.8 2v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
