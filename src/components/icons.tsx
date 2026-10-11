
/* ---------- icons (inline, 16px) ---------- */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  bell: (p: { className?: string }) => <svg width="15" height="15" viewBox="0 0 24 24" {...P} className={p.className}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>,
  search: (p: { className?: string }) => <svg width="15" height="15" viewBox="0 0 24 24" {...P} className={p.className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  heart: (p: { className?: string; filled?: boolean }) => <svg width="14" height="14" viewBox="0 0 24 24" {...P} fill={p.filled ? "currentColor" : "none"} className={p.className}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>,
  share: (p: { className?: string }) => <svg width="15" height="15" viewBox="0 0 24 24" {...P} className={p.className}><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" /></svg>,
  clock: (p: { className?: string }) => <svg width="13" height="13" viewBox="0 0 24 24" {...P} className={p.className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  users: (p: { className?: string }) => <svg width="14" height="14" viewBox="0 0 24 24" {...P} className={p.className}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>,
  filter: (p: { className?: string }) => <svg width="13" height="13" viewBox="0 0 24 24" {...P} className={p.className}><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>,
  star: (p: { className?: string }) => <svg width="15" height="15" viewBox="0 0 24 24" {...P} className={p.className}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>,
  x: (p: { className?: string }) => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className={p.className}><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.4l8.1-9.3L.9 2h7.2l5 6.6L18.9 2zm-1.2 18h1.9L6.4 3.9H4.4L17.7 20z" /></svg>,
  external: (p: { className?: string }) => <svg width="13" height="13" viewBox="0 0 24 24" {...P} className={p.className}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>,
  spark: (p: { className?: string }) => <svg width="16" height="16" viewBox="0 0 24 24" {...P} className={p.className}><path d="M3 17l5-6 4 4 5-8 4 5" /></svg>,
  gear: (p: { className?: string }) => <svg width="15" height="15" viewBox="0 0 24 24" {...P} className={p.className}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  chevron: (p: { className?: string }) => <svg width="14" height="14" viewBox="0 0 24 24" {...P} className={p.className}><path d="m6 9 6 6 6-6" /></svg>,
  collapse: (p: { className?: string }) => <svg width="14" height="14" viewBox="0 0 24 24" {...P} className={p.className}><path d="m11 17-5-5 5-5M18 17l-5-5 5-5" /></svg>,
  drop: (p: { className?: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={p.className}><path d="M12 2.5s-6.5 7.2-6.5 12a6.5 6.5 0 0 0 13 0c0-4.8-6.5-12-6.5-12z" /></svg>,
  wallet: (p: { className?: string }) => <svg width="15" height="15" viewBox="0 0 24 24" {...P} className={p.className}><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" /><circle cx="16.5" cy="14.5" r="1" fill="currentColor" /></svg>,
  check: (p: { className?: string }) => <svg width="13" height="13" viewBox="0 0 24 24" {...P} className={p.className}><path d="m5 12 5 5L20 7" /></svg>,
  menu: (p: { className?: string }) => <svg width="18" height="18" viewBox="0 0 24 24" {...P} className={p.className}><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  layers: (p: { className?: string }) => <svg width="14" height="14" viewBox="0 0 24 24" {...P} className={p.className}><path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" /></svg>,
};

