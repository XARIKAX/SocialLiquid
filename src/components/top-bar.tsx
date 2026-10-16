"use client";
import "./chrome.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/use-auth";
import { useBalance, type Balance, type Me } from "@/hooks/use-me";
import { iconOf, useMarkets, useMids } from "@/hooks/use-market";
import { api } from "@/lib/client";
import { fmtPct, fmtPx, fmtUsd, shortAddr } from "@/lib/format";
import { Avatar, CoinIcon, Icon, Logo } from "./ui";
import { useConnectModal, useModalFocus } from "./connect-modal";
import { useTheme } from "@/lib/theme";
import { AlertsBell } from "./alerts";
import { openFunds } from "./trade/funds";
import { openConvert } from "./trade/convert";
import { cashTotal, fmtQty, spotRows, usdcSpotAvail } from "@/lib/spot";
import { openProfileEditor } from "./profile-editor";

/* =====================================================================
   the app bar: brand, the three routes with a mint underline that glows
   under the one you are on, the environment, search, the bell, the
   theme, and the account. it is transparent at rest and frosts once
   content slides beneath it. styles: ./chrome.css (.tm-chrome-*).
   ===================================================================== */

type SearchResult = {
  coins: { coin: string; slug?: string; name?: string; base?: string; kind?: "perp" | "spot" | "hip3"; category?: string | null; markPx: number; change24h: number }[];
  traders: { address: string; handle: string | null; avatarUrl: string | null }[];
};
/** a market's page: its slug ("spot:USOL", "xyz:S&P500") encoded, falling back to the id */
const marketPath = (c: { coin: string; slug?: string }) => `/m/${encodeURIComponent(c.slug ?? c.coin)}`;

const ENV: Partial<Record<Me["network"], { label: string; title: string }>> = {
  mock: { label: "Mock", title: "Mock mode: synthetic Hyperliquid data, nothing reaches a real exchange" },
  testnet: { label: "Testnet", title: "Hyperliquid testnet: test funds only" },
};

/* the majors, offered as quick picks while the search is empty */
const QUICK = ["BTC", "ETH", "SOL", "HYPE"];

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Ico = {
  user: <svg width="15" height="15" viewBox="0 0 24 24" {...S} aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>,
  edit: <svg width="15" height="15" viewBox="0 0 24 24" {...S} aria-hidden><path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3" /></svg>,
  out: <svg width="15" height="15" viewBox="0 0 24 24" {...S} aria-hidden><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" /></svg>,
  close: <svg width="15" height="15" viewBox="0 0 24 24" {...S} aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>,
  go: <svg width="14" height="14" viewBox="0 0 24 24" {...S} aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  chev: <svg width="13" height="13" viewBox="0 0 24 24" {...S} strokeWidth={2} aria-hidden className="tm-chrome-acct-chev"><path d="m6 9 6 6 6-6" /></svg>,
};

function isEditable(el: EventTarget | Element | null) {
  const h = el as HTMLElement | null;
  return !!h && (h.tagName === "INPUT" || h.tagName === "TEXTAREA" || h.tagName === "SELECT" || h.isContentEditable);
}

const isMacLike = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** the trading routes carry their own call to action (the ticket), so the bar's button stays lit but stops breathing there */
const isTradingRoute = (path: string) => path === "/trade" || path.startsWith("/m/");

export function TopBar({ onToggleFeed }: { onToggleFeed?: () => void }) {
  // the phone tab bar (shell.tsx) switches between feed and trade, so the bar no longer needs a menu button for it
  void onToggleFeed;
  const { address, isConnected, signedIn, needsSignIn, signIn, busy, me, signOut } = useAuth();
  const bal = useBalance(signedIn ? address : null);
  const connect = useConnectModal();
  const ref = useRef<HTMLElement>(null);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  const env = me?.network ? ENV[me.network] : undefined;
  const quiet = isTradingRoute(usePathname()) || undefined;

  // frosted once content slides beneath the bar: the window on phones, the main column on desktop
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = document.getElementById("tm-main");
    let raf = 0;
    const check = () => {
      raf = 0;
      const on = window.scrollY > 2 || (main?.scrollTop ?? 0) > 2;
      if (on !== el.hasAttribute("data-scrolled")) el.toggleAttribute("data-scrolled", on);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    main?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      main?.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header ref={ref} className="tm-chrome-bar" data-auth={(signedIn && !!address) || undefined}>
      <span className="tm-chrome-frost" aria-hidden />
      <span className="tm-chrome-spec" aria-hidden />
      <Link href="/trade" className="tm-chrome-brand" aria-label="socialLiquid">
        <Logo size="sm" />
      </Link>
      <nav className="tm-chrome-nav" aria-label="Main">
        <NavTab href="/trade" label="Trade" match={["/trade", "/m/"]} />
        <NavTab href="/tokens" label="Tokens" match={["/tokens"]} />
        <NavTab href="/leaderboard" label="Leaderboard" match={["/leaderboard"]} />
        <NavTab href="/keys" label="Keys" match={["/keys"]} />
        <NavTab href="/portfolio" label="Portfolio" match={["/portfolio"]} />
        <NavTab href="/groups" label="Groups" match={["/groups", "/groups/"]} />
        {signedIn && <NavTab href="/invite" label="Invite" match={["/invite"]} />}
      </nav>
      {env && (
        <span className="pill pill-warn tm-chrome-env" title={env.title}>
          <i aria-hidden />
          {env.label}
        </span>
      )}

      <Search />

      <div className="tm-chrome-actions">
        <button type="button" className="tm-chrome-iconbtn tm-chrome-iconbtn-phone" onClick={() => setSheet(true)} aria-label="Search markets and traders" aria-expanded={sheet} aria-haspopup="dialog">
          <Icon.search />
        </button>
        {signedIn && <AlertsBell />}
        <ThemeToggle />
        {signedIn && address ? (
          <>
            <button type="button" className="btn btn-sm tm-chrome-deposit hidden xl:inline-flex" onClick={() => openFunds("deposit")}>
              <Icon.plus className="tm-chrome-mint" />
              Deposit
            </button>
            <AccountMenu address={address} me={me} bal={bal.data} onSignOut={signOut} />
          </>
        ) : needsSignIn ? (
          <button type="button" className="btn btn-primary btn-glow tm-chrome-cta" data-quiet={quiet} onClick={signIn} disabled={busy}>
            {busy ? (
              "Signing…"
            ) : (
              <>
                Sign in<span className="hidden sm:inline tm-chrome-mono text-[11px] font-medium opacity-80">· {shortAddr(address!)}</span>
              </>
            )}
          </button>
        ) : isConnected ? (
          <button type="button" className="btn tm-chrome-cta" onClick={signOut}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-glow tm-chrome-cta" data-quiet={quiet} onClick={connect.open}>
            <Icon.wallet />
            Connect
          </button>
        )}
      </div>
      {sheet && <Search sheet onClose={closeSheet} />}
    </header>
  );
}

function NavTab({ href, label, match }: { href: string; label: string; match: string[] }) {
  const path = usePathname();
  const active = match.some((m) => path === m || (m.endsWith("/") && path.startsWith(m)));
  return (
    <Link href={href} className="tm-chrome-nav-link" aria-current={active ? "page" : undefined}>
      <span>{label}</span>
    </Link>
  );
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "light" ? "dark" : "light";
  // the new theme opens as a circle of light from the toggle (a view transition; instant where unsupported or reduced)
  const flip = (e: React.MouseEvent<HTMLButtonElement>) => {
    const doc = document as ViewTransitionDoc;
    if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setTheme(next);
    const b = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || b.left + b.width / 2;
    const y = e.clientY || b.top + b.height / 2;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = doc.startViewTransition(() => setTheme(next));
    t.ready
      .then(() =>
        document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 620, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" }),
      )
      .catch(() => {});
  };
  return (
    <button type="button" className="tm-chrome-iconbtn tm-chrome-theme" onClick={flip} aria-label={`Switch to ${next} theme`} title={next === "light" ? "Light mode" : "Dark mode"}>
      <span data-i="sun" aria-hidden>
        <Icon.sun />
      </span>
      <span data-i="moon" aria-hidden>
        <Icon.moon />
      </span>
    </button>
  );
}

/* ---------- account: one pill, a menu with the money and the doors ---------- */
function AccountMenu({ address, me, bal, onSignOut }: { address: string; me: Me | undefined; bal: Balance | undefined; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const handle = me?.user?.handle ?? null;
  const name = me?.user?.displayName || (handle ? `@${handle}` : shortAddr(address));
  const upnl = bal?.positions.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
  const hasPos = !!bal && bal.positions.some((p) => p.szi !== 0);
  /* spot counts too: the total is perps plus spot, cash is perps withdrawable plus spot USDC. spot money that cannot
     trade perps yet gets a door: USDC moves to perps (unless the account is unified), coins sell for USDC */
  const mids = useMids();
  const spot = spotRows(bal?.spot, mids.data).filter((r) => r.name !== "USDC");
  const spotUsd = spot.reduce((a, r) => a + (r.usd ?? 0), 0);
  const spotUsdc = usdcSpotAvail(bal?.spot);
  const total = bal ? bal.accountValue + spotUsd + spotUsdc : null;
  const totalTitle = bal && spotUsd + spotUsdc > 0 ? `perps ${fmtUsd(bal.accountValue)} + spot ${fmtUsd(spotUsd + spotUsdc)}` : undefined;
  const spotNote: "move" | "unified" | "sell" | null = spotUsdc > 0.01 ? (bal?.unified ? "unified" : "move") : spot.length > 0 ? "sell" : null;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    menu.current?.querySelector<HTMLElement>("[data-first]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  const copy = () =>
    navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative" ref={wrap}>
      <button ref={btn} type="button" className="tm-chrome-acct" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)} aria-label={`Account ${name}`}>
        <span className="tm-chrome-av">
          <Avatar address={address} url={me?.user?.avatarUrl} handle={handle} size={24} />
        </span>
        <span className="tm-chrome-acct-id hidden lg:inline">{handle ? `@${handle}` : shortAddr(address)}</span>
        <span className="tm-chrome-acct-bal tm-chrome-num" data-testid="topbar-total" title={totalTitle}>
          {total !== null ? fmtUsd(total) : <span className="skeleton tm-chrome-acct-sk" aria-hidden />}
          {hasPos && <span className={`tm-chrome-acct-pnl hidden 2xl:inline ${upnl >= 0 ? "tm-chrome-up" : "tm-chrome-down"}`}>{fmtUsd(upnl, { sign: true })}</span>}
        </span>
        {(spotNote === "move" || spotNote === "sell") && <i className="tm-chrome-acct-dot" aria-hidden title={spotNote === "move" ? "USDC in spot: move it to perps to trade" : "Spot coins: sell for USDC to trade perps"} />}
        {Ico.chev}
      </button>
      {open && (
        <div ref={menu} id={menuId} className="pop tm-chrome-menu" role="menu" aria-label="Account" onKeyDown={onMenuKey}>
          <div className="tm-chrome-menu-head">
            <span className="tm-chrome-av">
              <Avatar address={address} url={me?.user?.avatarUrl} handle={handle} size={40} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="tm-chrome-menu-name">{name}</div>
              <div className="tm-chrome-menu-addr">{shortAddr(address)}</div>
            </div>
          </div>
          <div className="tm-chrome-menu-bal">
            <div className="label-caps">Account value</div>
            <div className="tm-chrome-menu-big tm-chrome-num" title={totalTitle}>{total !== null ? fmtUsd(total) : <span className="skeleton tm-chrome-menu-sk" aria-hidden />}</div>
            <div className="tm-chrome-menu-stats">
              <div>
                <span className="label-caps">Cash</span>
                <b className="tm-chrome-num" title="Perps withdrawable plus USDC in spot">{bal ? fmtUsd(cashTotal(bal)) : "…"}</b>
              </div>
              <div>
                <span className="label-caps">Open PnL</span>
                <b className={`tm-chrome-num ${!hasPos ? "text-muted" : upnl >= 0 ? "tm-chrome-up glow-up" : "tm-chrome-down glow-down"}`}>{hasPos ? fmtUsd(upnl, { sign: true }) : "–"}</b>
              </div>
            </div>
          </div>
          {spotNote === "move" ? (
            <button type="button" role="menuitem" className="tm-chrome-menu-spot" data-act="" data-testid="topbar-move-usdc" onClick={run(() => openConvert("USDC"))}>
              <span className="min-w-0">
                <b className="tm-chrome-num">{fmtUsd(spotUsdc)} in spot</b>
                <small>Move to perps to trade</small>
              </span>
              {Ico.go}
            </button>
          ) : spotNote === "unified" ? (
            <div className="tm-chrome-menu-spot" role="none">
              <span className="min-w-0">
                <b className="tm-chrome-num">{fmtUsd(spotUsdc)} USDC</b>
                <small>Unified account, ready to trade</small>
              </span>
            </div>
          ) : spotNote === "sell" ? (
            <button type="button" role="menuitem" className="tm-chrome-menu-spot" data-act="" data-testid="topbar-spot" title="Sell for USDC to trade perps with it" onClick={run(() => openConvert(spot[0].coin))}>
              <span className="min-w-0">
                <b className="tm-chrome-num">
                  {fmtQty(spot[0].total)} {spot[0].name}
                  {spot.length > 1 ? ` +${spot.length - 1}` : ""}
                </b>
                <small>Spot{spotUsd > 0 ? ` ≈ ${fmtUsd(spotUsd)}` : ""} · Sell for USDC</small>
              </span>
              {Ico.go}
            </button>
          ) : null}
          <div className="tm-chrome-menu-actions">
            <button type="button" role="menuitem" className="btn btn-primary btn-sm" data-first onClick={run(() => openFunds("deposit"))}>
              <Icon.plus />
              Deposit
            </button>
            <button type="button" role="menuitem" className="btn btn-sm" onClick={run(() => openFunds("withdraw"))}>
              Withdraw
            </button>
          </div>
          <div className="tm-chrome-menu-sep" role="none" />
          <Link role="menuitem" href={`/t/${handle ?? address}`} className="tm-chrome-menu-item" onClick={() => setOpen(false)}>
            {Ico.user}
            View profile
          </Link>
          <button type="button" role="menuitem" className="tm-chrome-menu-item" onClick={run(openProfileEditor)}>
            {Ico.edit}
            Edit profile
          </button>
          <button type="button" role="menuitem" className="tm-chrome-menu-item" data-done={copied || undefined} onClick={copy}>
            {copied ? <Icon.check /> : <Icon.copy />}
            {copied ? "Address copied" : "Copy address"}
          </button>
          <div className="tm-chrome-menu-sep" role="none" />
          <button type="button" role="menuitem" className="tm-chrome-menu-item" data-tone="down" onClick={run(onSignOut)}>
            {Ico.out}
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- search: tokens and traders, from the keyboard or the pointer ---------- */
function Search({ sheet, onClose }: { sheet?: boolean; onClose?: () => void }) {
  // on the terminal, ⌘K opens the market picker in the header, so the field does not advertise it there
  const terminal = isTradingRoute(usePathname() ?? "");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(!!sheet);
  const [active, setActive] = useState(-1);
  const [mac, setMac] = useState(true);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const listId = useId();
  const markets = useMarkets();
  const query = q.trim();

  useEffect(() => {
    if (!query) {
      setRes(null);
      setFailed(false);
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        api<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`)
          .then((r) => {
            if (!live) return;
            setRes(r);
            setFailed(false);
          })
          .catch(() => {
            if (!live) return;
            setRes(null);
            setFailed(true);
          }),
      120,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, query]);

  useEffect(() => setMac(isMacLike()), []);

  // the phone sheet is a real dialog: focus lands in the field, Tab stays inside, focus goes back to the button on close
  useModalFocus(ref, !!sheet);
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current?.();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [sheet]);

  useEffect(() => {
    if (sheet) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // ⌘K (Ctrl K off Mac) from anywhere, and "/" wherever nothing else claims it (market pages give "/" to the symbol search).
    // only the platform's own modifier: Ctrl K on a Mac is "delete to end of line" inside text fields
    const macLike = isMacLike();
    const key = (e: KeyboardEvent) => {
      const mod = macLike ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const cmdK = mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(document.activeElement);
      if (!(cmdK || slash) || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]') || document.fullscreenElement) return;
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      input.focus();
      input.select();
      setOpen(true);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [sheet]);

  const coins = res?.coins ?? [];
  const traders = res?.traders ?? [];
  const quick = query ? [] : QUICK.map((c) => markets.data?.find((m) => m.coin === c)).filter((m): m is NonNullable<typeof m> => !!m);
  const hrefs = query ? [...coins.map(marketPath), ...traders.map((t) => `/t/${t.handle ?? t.address}`)] : quick.map(marketPath);
  // the first keystroke keeps the panel open on a quiet "searching" state instead of collapsing it until the answer lands
  const loading = !!query && !res && !failed;
  const empty = !!query && !!res && hrefs.length === 0;
  const show = open && (query ? true : quick.length > 0);

  // a new result set lights its first row, so enter opens it; quick picks wait for an arrow key
  useEffect(() => setActive(query ? 0 : -1), [res, query]);
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    onClose?.();
    router.push(href);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hrefs.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % hrefs.length : a <= 0 ? hrefs.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      const href = hrefs[active] ?? (query ? hrefs[0] : undefined);
      if (href) go(href);
    } else if (e.key === "Escape") {
      if (sheet) return;
      e.preventDefault();
      if (open && (show || q)) setOpen(false);
      else inputRef.current?.blur();
    }
  };
  const optId = (i: number) => `${listId}-o${i}`;
  let idx = -1;
  const option = (href: string, children: ReactNode, key: string, cls = "tm-chrome-result") => {
    idx += 1;
    const i = idx;
    return (
      <button
        key={key}
        id={optId(i)}
        type="button"
        role="option"
        aria-selected={active === i}
        tabIndex={-1}
        data-active={active === i || undefined}
        className={cls}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => go(href)}
      >
        {children}
      </button>
    );
  };

  const field = (
    <div className="tm-chrome-field" onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
      <Icon.search />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={show}
        aria-controls={show ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? optId(active) : undefined}
        aria-label="Search tokens and traders"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search tokens or traders…"
        value={q}
        data-autofocus={sheet || undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      <button
        type="button"
        className="tm-chrome-paste"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          navigator.clipboard
            ?.readText()
            .then((t) => {
              setQ(t.trim());
              setOpen(true);
              inputRef.current?.focus();
            })
            .catch(() => {})
        }
        title="Paste an address or ticker"
      >
        Paste
      </button>
      {!sheet && (
        <>
          {!terminal && (
            <kbd className="tm-chrome-key" data-k="slash" aria-hidden title={`${mac ? "⌘" : "Ctrl "}K to search`}>
              {mac ? "⌘K" : "Ctrl K"}
            </kbd>
          )}
          <kbd className="tm-chrome-key" data-k="esc" aria-hidden>
            esc
          </kbd>
        </>
      )}
    </div>
  );

  const list = show && (
    <div ref={listRef} className={sheet ? "tm-chrome-results" : "pop tm-chrome-results"}>
      <div id={listId} role="listbox" aria-label="Search results">
        {quick.length > 0 && (
          <div role="group" aria-label="Majors">
            <div className="tm-chrome-results-label" aria-hidden>
              <span className="label-caps">Majors</span>
              <span className="label-caps">24h</span>
            </div>
            <div className="tm-chrome-quick">
              {quick.map((m) =>
                option(
                  marketPath(m),
                  <>
                    <CoinIcon coin={iconOf(m)} size={20} className="tm-chrome-coin" />
                    <span className="flex flex-col leading-tight min-w-0">
                      <b>{m.name}</b>
                      <span className="tm-chrome-num tm-chrome-quick-px">{fmtPx(m.markPx)}</span>
                    </span>
                    <span className={`tm-chrome-result-chg tm-chrome-num ${m.change24h >= 0 ? "tm-chrome-up" : "tm-chrome-down"}`}>{fmtPct(m.change24h)}</span>
                  </>,
                  m.coin,
                  "tm-chrome-quick-chip",
                ),
              )}
            </div>
          </div>
        )}
        {coins.length > 0 && (
          <div role="group" aria-label="Markets">
            <div className="tm-chrome-results-label" aria-hidden>
              <span className="label-caps">Markets</span>
              <span className="label-caps">Mark · 24h</span>
            </div>
            {coins.map((c) =>
              option(
                marketPath(c),
                <>
                  <CoinIcon coin={c.kind === "hip3" ? c.coin : (c.base ?? c.coin)} size={22} className="tm-chrome-coin" />
                  <span className="tm-chrome-result-name">{c.name ?? c.coin}</span>
                  <span className="tm-chrome-result-tag">{c.kind === "spot" ? "Spot" : c.kind === "hip3" ? (c.category ?? "Tradfi") : "Perp"}</span>
                  <span className="tm-chrome-result-px tm-chrome-num">{fmtPx(c.markPx)}</span>
                  <span className={`tm-chrome-result-chg tm-chrome-num ${c.change24h >= 0 ? "tm-chrome-up" : "tm-chrome-down"}`}>{fmtPct(c.change24h)}</span>
                </>,
                c.coin,
              ),
            )}
          </div>
        )}
        {traders.length > 0 && (
          <div role="group" aria-label="Traders">
            <div className="tm-chrome-results-label" aria-hidden>
              <span className="label-caps">Traders</span>
            </div>
            {traders.map((t) =>
              option(
                `/t/${t.handle ?? t.address}`,
                <>
                  <span className="tm-chrome-av">
                    <Avatar address={t.address} url={t.avatarUrl} handle={t.handle} size={22} />
                  </span>
                  <span className="tm-chrome-result-name truncate">{t.handle ? `@${t.handle}` : shortAddr(t.address)}</span>
                  {t.handle && <span className="tm-chrome-result-sub">{shortAddr(t.address)}</span>}
                  <span className="tm-chrome-result-go">{Ico.go}</span>
                </>,
                t.address,
              ),
            )}
          </div>
        )}
      </div>
      {loading && (
        <div className="tm-chrome-results-loading" role="status" aria-label="Searching">
          {[0, 1, 2].map((i) => (
            <span key={i} className="tm-chrome-results-sk" style={{ opacity: 1 - i * 0.22 }}>
              <i className="skeleton" />
              <i className="skeleton" />
              <i className="skeleton" />
            </span>
          ))}
        </div>
      )}
      {failed && !!query && (
        <div className="tm-chrome-results-empty" role="status">
          <b>Search is unavailable</b>
          <span>Check your connection and try again in a moment.</span>
        </div>
      )}
      {empty && (
        <div className="tm-chrome-results-empty" role="status">
          <span className="tm-chrome-results-empty-ico" aria-hidden>
            <Icon.search />
          </span>
          <b>No tokens or traders match “{query}”</b>
          <span>Try a ticker like BTC, a handle like @nightowl, or paste a 0x address.</span>
        </div>
      )}
      {!sheet && hrefs.length > 0 && (
        <div className="tm-chrome-results-foot" aria-hidden>
          <span>
            <kbd className="tm-chrome-key">↑</kbd>
            <kbd className="tm-chrome-key">↓</kbd>
            move
          </span>
          <span>
            <kbd className="tm-chrome-key">↵</kbd>
            open
          </span>
          <span>
            <kbd className="tm-chrome-key">esc</kbd>
            close
          </span>
        </div>
      )}
    </div>
  );

  if (sheet) {
    return createPortal(
      <>
        <div className="tm-chrome-sheet-scrim" onClick={onClose} aria-hidden />
        <div ref={ref} className="pop tm-chrome-sheet" role="dialog" aria-modal="true" aria-label="Search">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">{field}</div>
            <button type="button" className="tm-chrome-close" onClick={onClose} aria-label="Close search">
              {Ico.close}
            </button>
          </div>
          {list}
        </div>
      </>,
      document.body,
    );
  }
  return (
    <div ref={ref} className="tm-chrome-search">
      {field}
      {list}
    </div>
  );
}
