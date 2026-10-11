"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { api } from "@/lib/client";
import { fmtPct, fmtPx, fmtUsd, shortAddr } from "@/lib/format";
import { Avatar } from "./ui";

type SearchResult = { coins: { coin: string; markPx: number; change24h: number }[]; traders: { address: string; handle: string | null; avatarUrl: string | null }[] };

export function TopBar({ onToggleFeed }: { onToggleFeed?: () => void }) {
  const { address, signedIn, needsSignIn, signIn, busy, me, signOut } = useAuth();
  const bal = useBalance(signedIn ? address : null);
  return (
    <header className="h-12 border-b border-line bg-panel flex items-center gap-3 px-3 sticky top-0 z-30">
      <button className="md:hidden btn btn-ghost px-2" onClick={onToggleFeed} aria-label="toggle feed">
        ☰
      </button>
      <Link href="/" className="font-semibold tracking-tight text-base leading-none select-none">
        <span className="text-fg">social</span>
        <span className="text-accent">Liquid</span>
      </Link>
      {me?.network && me.network !== "mainnet" && <span className="pill bg-warn/20 text-warn">{me.network}</span>}
      <nav className="hidden md:flex items-center gap-1 ml-2 text-muted">
        <Link className="btn btn-ghost h-7" href="/">feed</Link>
        <Link className="btn btn-ghost h-7" href="/tokens">tokens</Link>
        <Link className="btn btn-ghost h-7" href="/leaderboard">leaderboard</Link>
      </nav>
      <Search />
      <div className="ml-auto flex items-center gap-2">
        {signedIn && (
          <Link href={`/t/${me?.user?.handle ?? address}`} className="hidden sm:flex items-center gap-2 btn btn-ghost h-8">
            <Avatar address={address!} handle={me?.user?.handle} size={20} />
            <span className="text-xs">{me?.user?.handle ?? shortAddr(address!)}</span>
            <span className="num text-xs text-muted border-l border-line pl-2">{bal.data ? fmtUsd(bal.data.withdrawable) : "…"}</span>
          </Link>
        )}
        {needsSignIn && (
          <button className="btn btn-primary" onClick={signIn} disabled={busy}>
            {busy ? "signing…" : "sign in"}
          </button>
        )}
        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
            const ready = mounted;
            if (!ready) return <div className="w-20 h-8" />;
            if (!account || !chain)
              return (
                <button className="btn btn-primary" onClick={openConnectModal}>
                  connect
                </button>
              );
            return (
              <button className="btn" onClick={signedIn ? signOut : openAccountModal} title={signedIn ? "sign out" : account.address}>
                {signedIn ? "sign out" : shortAddr(account.address)}
              </button>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}

function Search() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim()) return setRes(null);
    const t = setTimeout(() => api<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  return (
    <div ref={ref} className="relative hidden sm:block w-56 lg:w-72">
      <input
        className="input"
        placeholder="search tokens or traders"
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
        }}
      />
      {open && res && (res.coins.length > 0 || res.traders.length > 0) && (
        <div className="absolute top-9 left-0 right-0 card shadow-xl p-1 z-40">
          {res.coins.map((c) => (
            <button key={c.coin} className="w-full flex items-center justify-between px-2 h-8 rounded hover:bg-panel-2 text-left" onClick={() => go(`/m/${c.coin}`)}>
              <span className="font-medium">{c.coin}</span>
              <span className="num text-xs text-muted">
                {fmtPx(c.markPx)} <span className={c.change24h >= 0 ? "text-up" : "text-down"}>{fmtPct(c.change24h)}</span>
              </span>
            </button>
          ))}
          {res.traders.map((t) => (
            <button key={t.address} className="w-full flex items-center gap-2 px-2 h-8 rounded hover:bg-panel-2 text-left" onClick={() => go(`/t/${t.handle ?? t.address}`)}>
              <Avatar address={t.address} url={t.avatarUrl} handle={t.handle} size={18} />
              <span>{t.handle ?? shortAddr(t.address)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
