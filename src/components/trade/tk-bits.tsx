"use client";
/**
 * small pieces shared by the ticket region (ticket, funds, onboarding, convert, trade panel): its icon set, the
 * grouped-number field, and the money dialogs' shell (overlay, focus, Escape), picker, chain marks and route line.
 * styles: ticket.css (.tm-tk-*) for the shared language, funds.css (.tm-fd-*) for the dialogs' own parts.
 */
import "./ticket.css";
import "./funds.css";
import { Fragment, useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { CoinIcon } from "../ui";

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
  copy: (p: IcoProps) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></Svg>,
  ext: (p: IcoProps) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Svg>,
  retry: (p: IcoProps) => <Svg {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3M3.5 4v5h5" /></Svg>,
  wallet: (p: IcoProps) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" /><circle cx="16.5" cy="14.5" r="0.6" fill="currentColor" /></Svg>,
  shield: (p: IcoProps) => <Svg {...p}><path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6z" /><path d="m9 12 2.2 2.2L15 10.4" /></Svg>,
  info: (p: IcoProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.4M12 7.7v.1" /></Svg>,
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

/* ---------- the money dialogs' shell (funds, sell for USDC) ---------- */
/** open dialogs, oldest first: Escape answers for the top one only (sell-for-USDC can open over the funds dialog) */
const dialogs: symbol[] = [];
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * portalled to the body so no ancestor's stacking context can sit above the overlay. focus moves into the dialog and
 * goes back to whatever opened it; Tab stays inside; Escape or a press on the scrim closes it (a text selection
 * dragged out of the dialog, say from a deposit address, does not).
 */
export function TkModal({ labelledBy, onClose, className = "", children }: { labelledBy: string; onClose: () => void; className?: string; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<symbol | null>(null);
  const downOnScrim = useRef(false);

  useEffect(() => {
    const id = Symbol("tk-dialog");
    idRef.current = id;
    dialogs.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    return () => {
      const i = dialogs.indexOf(id);
      if (i > -1) dialogs.splice(i, 1);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && dialogs[dialogs.length - 1] === idRef.current) onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  /** tab stays inside the dialog */
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !boxRef.current) return;
    const items = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === boxRef.current || !boxRef.current.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="tm-tk-overlay tm-fd-overlay"
      onPointerDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnScrim.current) onClose();
      }}
    >
      <div ref={boxRef} className={`pop tm-tk-scope tm-tk-modal tm-fd tm-fd-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={trap}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** the dialog's close button */
export function TkClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="tm-tk-close" onClick={onClose} aria-label="Close">
      <TkIcon.close size={15} />
    </button>
  );
}

/* ---------- picker: a field that opens a listbox under its row ---------- */
/** `section` starts a labelled group in the list at its first option (options keep their order) */
export type TkPickOption = { value: string; text: string; label?: ReactNode; sub?: ReactNode; icon?: ReactNode; tag?: ReactNode; section?: string };

/**
 * the funds dialog's asset and chain pickers. the list floats under the whole picker row (the row is the positioned
 * parent), arrows / Home / End / a typed letter move through it, Enter picks, Escape or leaving closes it.
 * `listLabel` names the listbox the way production's selects were named ("asset", "deposit chain", ...).
 */
export function TkPicker({ label, value, options, onPick, disabled, listLabel, grid, face, className = "" }: { label: string; value: string; options: TkPickOption[]; onPick: (v: string) => void; disabled?: boolean; listLabel: string; grid?: boolean; face?: ReactNode; className?: string }) {
  const [want, setOpen] = useState(false);
  /** a busy dialog disables the picker, which also folds an open list */
  const open = want && !disabled;
  const uid = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sel = options.find((o) => o.value === value);

  // the open list takes focus on its picked option; a press anywhere outside closes it
  useEffect(() => {
    if (!open) return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const at = items.find((b) => b.getAttribute("aria-selected") === "true") ?? items[0];
    at?.focus({ preventScroll: true });
    at?.scrollIntoView({ block: "nearest" });
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const shut = () => {
    setOpen(false);
    btnRef.current?.focus({ preventScroll: true });
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      // the dialog's own Escape handler sees defaultPrevented and stays open
      e.preventDefault();
      shut();
      return;
    }
    let to = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") to = Math.min(items.length - 1, i + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") to = Math.max(0, i - 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
      const hit = order.find((b) => (b.dataset.text ?? "").toLowerCase().startsWith(k));
      if (hit) to = items.indexOf(hit);
    }
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={`tm-fd-pickwrap ${className}`}
      onBlur={(e) => {
        // keyboard: tabbing on past the list closes it (pointer presses are handled above)
        const to = e.relatedTarget as Node | null;
        if (open && to && !e.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="tm-fd-pick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-labelledby={`${uid}-k ${uid}-v`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={`${uid}-k`} className="tm-fd-pick-k">
          {label}
        </span>
        <span id={`${uid}-v`} className="tm-fd-pick-v">
          {face ?? (
            <>
              {sel?.icon}
              <span className="tm-fd-pick-t">{sel?.label ?? sel?.text ?? value}</span>
            </>
          )}
        </span>
        <TkIcon.chev size={14} sw={2} className="tm-fd-pick-chev" />
      </button>
      {open && (
        <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label={listLabel} className={`pop tm-fd-menu ${grid ? "tm-fd-menu-grid" : ""}`} onKeyDown={onListKey}>
          {options.map((o, i) => (
            <Fragment key={o.value}>
              {o.section && o.section !== options[i - 1]?.section && (
                <span className="tm-fd-menu-sec" aria-hidden>
                  {o.section}
                </span>
              )}
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                data-text={o.text}
                className="tm-fd-opt"
                onClick={() => {
                  onPick(o.value);
                  shut();
                }}
              >
                {o.icon}
                <span className="tm-fd-opt-main">
                  <b>{o.label ?? o.text}</b>
                  {o.sub && <small>{o.sub}</small>}
                  {o.section && <span className="sr-only"> · {o.section}</span>}
                </span>
                {o.tag}
                <TkIcon.check size={13} sw={2.4} className="tm-fd-opt-check" />
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** a fixed value in the picker row (a native asset's own chain): the same field, nothing to open */
export function TkPickStatic({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tm-fd-pick" data-static="">
      <span className="tm-fd-pick-k">{label}</span>
      <span className="tm-fd-pick-v">{children}</span>
      <TkIcon.lock size={12} sw={2} className="tm-fd-pick-chev" />
    </div>
  );
}

/* ---------- chain marks ---------- */
/** chains by the coin hyperliquid draws them with (the ARB, OP, POL, AVAX, HYPE glyphs are those chains' own marks) */
const CHAIN_COIN: [RegExp, string][] = [
  [/arbitrum/i, "ARB"],
  [/ethereum/i, "ETH"],
  [/optimism|^op\b/i, "OP"],
  [/polygon/i, "POL"],
  [/avalanche/i, "AVAX"],
  [/hyperevm/i, "HYPE"],
  [/bitcoin/i, "BTC"],
  [/solana/i, "SOL"],
  [/monad/i, "MON"],
  [/plasma/i, "XPL"],
  [/zcash/i, "ZEC"],
];
export function TkChain({ name, size = 18 }: { name: string; size?: number }) {
  // hyperliquid has no glyph for Base: its mark is drawn here (the blue disc with the slot)
  if (/\bbase\b/i.test(name))
    return (
      <svg className="tm-fd-chain" width={size} height={size} viewBox="0 0 111 111" aria-hidden>
        <circle cx="55.5" cy="55.5" r="55.5" fill="#fff" />
        <path d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z" fill="#0052ff" />
      </svg>
    );
  const coin = CHAIN_COIN.find(([re]) => re.test(name))?.[1] ?? name.slice(0, 3).toUpperCase();
  return <CoinIcon coin={coin} size={size} className="tm-fd-chain" />;
}

/* ---------- the route the money takes ---------- */
type RouteEnd = { name: string; sub?: string; tone?: "peri" | "mint" };
/** two lit ends and the rail between them; a dot travels the rail while the money moves */
export function TkRoute({ from, to, moving }: { from: RouteEnd; to: RouteEnd; moving?: boolean }) {
  const end = (p: RouteEnd) => (
    <span className="tm-tk-route-end">
      <i className="tm-tk-route-dot" data-tone={p.tone === "peri" ? "peri" : undefined} />
      {p.name}
      {p.sub && <small>{p.sub}</small>}
    </span>
  );
  return (
    <div className="tm-tk-route tm-fd-route" aria-hidden>
      {end(from)}
      <span className="tm-tk-route-line">{moving ? <i /> : <TkIcon.arrow size={12} sw={2} />}</span>
      {end(to)}
    </div>
  );
}

/** a warning / note line in the dialogs' language */
export function TkMsg({ tone, children, testid, role }: { tone: "warn" | "err" | "ok"; children: ReactNode; testid?: string; role?: "alert" | "status" }) {
  return (
    <p className="tm-tk-msg" data-tone={tone} data-testid={testid} role={role}>
      {tone === "ok" ? <TkIcon.check size={13} sw={2.2} /> : <TkIcon.alert size={13} />}
      <span>{children}</span>
    </p>
  );
}
