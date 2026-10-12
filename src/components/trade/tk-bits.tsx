"use client";
/** small pieces shared by the ticket region (ticket, funds, onboarding, trade panel): its icon set and the grouped-number field */
import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

/* ---------- icons for the ticket region (inline, rounded, 24 grid) ---------- */
type IcoProps = { size?: number; sw?: number; className?: string };
function Svg({ size = 14, sw = 1.8, className, children }: IcoProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}
export const TkIcon = {
  pen: (p: IcoProps) => <Svg {...p}><path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>,
  lock: (p: IcoProps) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  swap: (p: IcoProps) => <Svg {...p}><path d="M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8" /></Svg>,
  key: (p: IcoProps) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="m10.9 12.1 8.6-8.6M16.5 6.5l2.5 2.5M14 9l2 2" /></Svg>,
  ticket: (p: IcoProps) => <Svg {...p}><path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z" /><path d="M14 6.5v2M14 11v2M14 15.5v2" /></Svg>,
  at: (p: IcoProps) => <Svg {...p}><circle cx="12" cy="12" r="3.6" /><path d="M15.6 8.4v4.8a2.7 2.7 0 0 0 5.4 0V12a9 9 0 1 0-3.6 7.2" /></Svg>,
  bolt: (p: IcoProps) => <Svg {...p}><path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12z" /></Svg>,
  down: (p: IcoProps) => <Svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Svg>,
  up: (p: IcoProps) => <Svg {...p}><path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" /></Svg>,
  close: (p: IcoProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  check: (p: IcoProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7" /></Svg>,
  alert: (p: IcoProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.2M12 16.4v.1" /></Svg>,
  spin: (p: IcoProps) => <Svg {...p}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></Svg>,
  arrow: (p: IcoProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>,
  minus: (p: IcoProps) => <Svg {...p}><path d="M6 12h12" /></Svg>,
  plus: (p: IcoProps) => <Svg {...p}><path d="M12 6v12M6 12h12" /></Svg>,
  chev: (p: IcoProps) => <Svg {...p}><path d="m7 10 5 5 5-5" /></Svg>,
};

/* ---------- numbers that read like the mock: "$12,500", "112,231.1" ---------- */
/** groups the integer part of a typed number for reading; anything that is not a plain number is left alone */
export const groupDigits = (raw: string) => raw.replace(/^\d+/, (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ","));

/** a numeric field that shows grouped digits at rest and the raw value while it is being edited,
    so typing, the caret and the value the order is built from are exactly what they were */
export function TkNum({ value, onValue, ref, onFocus, onBlur, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onValue: (v: string) => void; ref?: Ref<HTMLInputElement> }) {
  const [editing, setEditing] = useState(false);
  return (
    <input
      {...rest}
      ref={ref}
      value={editing ? value : groupDigits(value)}
      onChange={(e) => onValue(e.target.value)}
      onFocus={(e) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setEditing(false);
        onBlur?.(e);
      }}
    />
  );
}

