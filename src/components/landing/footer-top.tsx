"use client";

/**
 * back to top. a plain "#" link without js; with js it scrolls (smoothly unless the
 * reader asked for less motion) and takes keyboard focus up with the page, onto the
 * nav's logo, so the next tab continues from the top instead of leaving the document.
 */
export function FooterTop() {
  return (
    <a
      href="#"
      className="lp-footer-up"
      aria-label="Back to top"
      onClick={(e) => {
        e.preventDefault();
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
        const first = document.querySelector<HTMLElement>(".lp-nav-logo") ?? document.querySelector<HTMLElement>(".lp a[href], .lp button");
        first?.focus({ preventScroll: true });
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    </a>
  );
}
