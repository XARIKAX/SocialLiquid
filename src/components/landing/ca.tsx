"use client";
import { useState } from "react";

/** the $SOLIQUID contract address on Solana; set NEXT_PUBLIC_TOKEN_CA to change it, empty to hide the pill */
export const TOKEN_CA = process.env.NEXT_PUBLIC_TOKEN_CA ?? "B4GbDpyWLAEsCzsdpL7eyAcX1NybXFocVnKLxV21pump";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** a pill with the token contract address: click copies the full address, shows "Copied" for a moment */
export function CaPill() {
  const [copied, setCopied] = useState(false);
  if (!TOKEN_CA) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_CA);
    } catch {
      const el = document.createElement("textarea");
      el.value = TOKEN_CA;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" className="lp-btn lp-btn-ghost lp-ca" onClick={copy} title={TOKEN_CA} aria-label={`copy contract address ${TOKEN_CA}`} data-testid="hero-ca">
      <span className="lp-ca-label">CA</span>
      <span className="lp-ca-addr">{short(TOKEN_CA)}</span>
      <span className="lp-ca-copy" aria-live="polite">
        {copied ? (
          "Copied"
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}
