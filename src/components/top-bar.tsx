"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { useMids } from "@/hooks/use-market";
import { cashTotal, fmtQty, spotRows, usdcSpotAvail } from "@/lib/spot";
import { api } from "@/lib/client";
import { fmtPct, fmtPx, fmtUsd, shortAddr } from "@/lib/format";
import { Avatar, CoinIcon, Icon, Logo } from "./ui";
import { useConnectModal } from "./connect-modal";
import { useTheme } from "@/lib/theme";
import { AlertsBell } from "./alerts";
import { openFunds } from "./trade/funds";
import { openConvert } from "./trade/convert";

type SearchResult = { coins: { coin: string; markPx: number; change24h: number }[]; traders: { address: string; handle: string | null; avatarUrl: string | null }[] };

export function TopBar({ onToggleFeed }: { onToggleFeed?: () => void }) {
  const { address, isConnected, signedIn, needsSignIn, signIn, busy, me, signOut } = useAuth();
  const bal = useBalance(signedIn ? address : null);
  const connect = useConnectModal();
  const [theme, setTheme] = useTheme();
  const upnl = bal.data?.positions.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
  const mids = useMids();
  const spot = spotRows(bal.data?.spot, mids.data).filter((r) => r.name !== "USDC");
  const spotUsd = spot.reduce((a, r) => a + (r.usd ?? 0), 0);
  const spotUsdc = usdcSpotAvail(bal.data?.spot);
  return (
    <header className="h-14 flex items-center gap-3 px-3 md:px-4 sticky top-0 z-30 bg-bg/90 backdrop-blur">
      <button className="md:hidden btn btn-ghost px-2 h-9" onClick={onToggleFeed} aria-label="toggle feed">
        <Icon.menu />
      </button>
      <Link href="/trade" className="shrink-0">
        <Logo />
      </Link>
      <nav className="hidden lg:flex items-center gap-0.5 ml-2">
        <NavTab href="/trade" label="Trade" match={["/trade", "/m/"]} />
        <NavTab href="/tokens" label="Tokens" match={["/tokens"]} />
        <NavTab href="/leaderboard" label="Leaderboard" match={["/leaderboard"]} />
      </nav>
      {me?.network === "mock" && <span className="pill pill-warn uppercase tracking-wide">mock</span>}

      <div className="flex-1 flex justify-center">
        <Search />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {signedIn && <AlertsBell />}
        <button className="btn btn-ghost h-9 w-9 px-0" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title={theme === "light" ? "Dark mode" : "Light mode"} aria-label="toggle theme">
          {theme === "light" ? <Icon.moon /> : <Icon.sun />}
        </button>
        {signedIn && address ? (
          <>
            <div className="hidden sm:flex flex-col justify-center card px-3 h-10 rounded-[10px] leading-tight">
              <span className="num text-[13px]">
                {bal.data ? fmtUsd(cashTotal(bal.data)) : "…"} <span className="text-muted font-normal">cash</span>
              </span>
              {spotUsdc > 0.01 && !bal.data?.unified ? (
                <button onClick={() => openConvert("USDC")} className="text-[11px] text-brand font-medium hover:underline text-left truncate max-w-[220px]" data-testid="topbar-move-usdc">
                  {fmtUsd(spotUsdc)} in spot · Move to perps to trade
                </button>
              ) : spotUsdc > 0.01 ? (
                <span className="text-[11px] text-muted truncate max-w-[220px] block">{fmtUsd(spotUsdc)} USDC · unified, ready to trade</span>
              ) : spot.length > 0 ? (
                <button onClick={() => openConvert(spot[0].coin)} className="text-[11px] text-fg-2 hover:underline num text-left truncate max-w-[200px]" title="Sell for USDC to trade perps with it" data-testid="topbar-spot">
                  {fmtQty(spot[0].total)} {spot[0].name}{spot.length > 1 ? ` +${spot.length - 1}` : ""} <span className="text-muted">spot{spotUsd > 0 ? ` ≈ ${fmtUsd(spotUsd)}` : ""}</span> <span className="text-brand">· Sell for USDC</span>
                </button>
              ) : (
                <button onClick={() => openFunds("deposit")} className="text-[11px] text-brand font-medium hover:underline">
                  Deposit more
                </button>
              )}
            </div>
            <Link href={`/t/${me?.user?.handle ?? address}`} className="flex items-center gap-2.5 card pl-3 pr-1.5 h-10 rounded-[10px] hover:bg-panel-2 transition-colors">
              <span className="flex flex-col justify-center leading-tight">
                <span className="num text-[13px]" data-testid="topbar-total" title={spotUsd + spotUsdc > 0 ? `perps ${fmtUsd(bal.data?.accountValue ?? 0)} + spot ${fmtUsd(spotUsd + spotUsdc)}` : undefined}>{bal.data ? fmtUsd(bal.data.accountValue + spotUsd + spotUsdc) : "…"}</span>
                <span className={`num text-[11px] ${upnl >= 0 ? "text-up" : "text-down"}`}>
                  {fmtUsd(upnl, { sign: true })} <span className="text-dim">open</span>
                </span>
              </span>
              <Avatar address={address} handle={me?.user?.handle} size={30} />
            </Link>
            <button className="btn btn-ghost h-9 px-2 text-xs" onClick={signOut} title="sign out">
              ⎋
            </button>
          </>
        ) : needsSignIn ? (
          <button className="btn btn-primary h-10" onClick={signIn} disabled={busy}>
            {busy ? "Signing…" : `Sign in · ${shortAddr(address!)}`}
          </button>
        ) : isConnected ? (
          <button className="btn h-10" onClick={signOut}>
            Disconnect
          </button>
        ) : (
          <button className="btn btn-primary h-10 px-4" onClick={connect.open}>
            Connect
          </button>
        )}
      </div>
    </header>
  );
}

function NavTab({ href, label, match }: { href: string; label: string; match: string[] }) {
  const path = usePathname();
  const active = match.some((m) => path === m || (m.endsWith("/") && path.startsWith(m)));
  return (
    <Link href={href} className={`tab h-9 px-3 ${active ? "tab-active" : ""}`}>
      {label}
    </Link>
  );
}

function Search() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!q.trim()) return setRes(null);
    const t = setTimeout(() => api<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)), 120);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, []);
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  return (
    <div ref={ref} className="relative hidden sm:block w-full max-w-[520px]">
      <div className="flex items-center h-10 card rounded-[12px] px-3 gap-2 focus-within:border-line-2">
        <span className="text-dim"><Icon.search /></span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-dim"
          placeholder="Search for tokens or traders…"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && res) {
              const first = res.coins[0] ? `/m/${res.coins[0].coin}` : res.traders[0] ? `/t/${res.traders[0].handle ?? res.traders[0].address}` : null;
              if (first) go(first);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button className="kbd hover:text-fg h-6 px-2" onClick={() => navigator.clipboard?.readText().then((t) => setQ(t.trim())).catch(() => {})}>Paste</button>
        <span className="kbd h-6 px-2">/</span>
      </div>
      {open && res && (res.coins.length > 0 || res.traders.length > 0) && (
        <div className="absolute top-12 left-0 right-0 card shadow-2xl shadow-black/60 p-1.5 z-40">
          {res.coins.length > 0 && <div className="px-2 py-1 text-[11px] text-dim">Markets</div>}
          {res.coins.map((c) => (
            <button key={c.coin} className="w-full flex items-center gap-2.5 px-2 h-10 rounded-lg hover:bg-panel-2 text-left" onClick={() => go(`/m/${c.coin}`)}>
              <CoinIcon coin={c.coin} size={22} />
              <span className="font-semibold">{c.coin}</span>
              <span className="text-dim text-xs">perp</span>
              <span className="ml-auto num text-xs">
                {fmtPx(c.markPx)} <span className={c.change24h >= 0 ? "text-up" : "text-down"}>{fmtPct(c.change24h)}</span>
              </span>
            </button>
          ))}
          {res.traders.length > 0 && <div className="px-2 py-1 text-[11px] text-dim">Traders</div>}
          {res.traders.map((t) => (
            <button key={t.address} className="w-full flex items-center gap-2.5 px-2 h-10 rounded-lg hover:bg-panel-2 text-left" onClick={() => go(`/t/${t.handle ?? t.address}`)}>
              <Avatar address={t.address} url={t.avatarUrl} handle={t.handle} size={22} />
              <span className="font-medium">{t.handle ?? shortAddr(t.address)}</span>
              {!t.handle && <span className="text-dim text-xs num">{shortAddr(t.address)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
