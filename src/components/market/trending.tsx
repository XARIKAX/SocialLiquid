"use client";
/** markets ranked by what traders do, not by volume: opens, copies and theses in the last day, and what your people are in */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { useAuth } from "@/hooks/use-auth";
import { CoinIcon, Icon } from "../ui";

type TrendRow = { coin: string; count: number };
type Trending = { mostOpened: TrendRow[]; mostOpened1h: TrendRow[]; mostCopied: TrendRow[]; mostTheses: TrendRow[]; followed: TrendRow[] | null; at: string };

export function useTrending() {
  const { signedIn } = useAuth();
  return useQuery({ queryKey: ["trending", !!signedIn], queryFn: () => api<Trending>("/api/trending"), refetchInterval: 60_000, staleTime: 30_000 });
}

function Card({ title, icon, rows, unit, onNavigate, empty }: { title: string; icon: React.ReactNode; rows: TrendRow[]; unit: string; onNavigate?: () => void; empty: string }) {
  return (
    <div className="card p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted mb-2"><span className="text-brand">{icon}</span>{title}</div>
      {rows.length === 0 && <div className="text-[12px] text-dim">{empty}</div>}
      <ol className="space-y-1">
        {rows.slice(0, 5).map((r, i) => (
          <li key={r.coin}>
            <Link href={`/m/${encodeURIComponent(r.coin)}`} onClick={onNavigate} className="flex items-center gap-2 text-[13px] hover:underline underline-offset-2">
              <span className={`num text-[11px] w-3 ${i === 0 ? "text-brand" : "text-dim"}`}>{i + 1}</span>
              <CoinIcon coin={r.coin.replace(/^[a-z]+:/, "")} size={18} />
              <span className="font-medium truncate">{r.coin}</span>
              <span className="ml-auto num text-muted">{r.count} {unit}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** four cards for the markets page */
export function TrendingCards({ onNavigate }: { onNavigate?: () => void }) {
  const q = useTrending();
  const { signedIn } = useAuth();
  const d = q.data;
  if (!d) return null;
  const hot = d.mostOpened1h.length >= 3 ? d.mostOpened1h : d.mostOpened;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="trending-cards">
      <Card title={d.mostOpened1h.length >= 3 ? "Most opened · last hour" : "Most opened · 24h"} icon={<Icon.spark />} rows={hot} unit="opens" onNavigate={onNavigate} empty="Quiet hour." />
      <Card title="Most copied · 24h" icon={<Icon.copy />} rows={d.mostCopied} unit="copies" onNavigate={onNavigate} empty="Nothing copied yet today." />
      <Card title="Most theses · 24h" icon={<Icon.reply />} rows={d.mostTheses} unit="theses" onNavigate={onNavigate} empty="No theses posted today." />
      <Card title="Your people are in" icon={<Icon.users />} rows={d.followed ?? []} unit="opens" onNavigate={onNavigate} empty={signedIn ? (d.followed && d.followed.length === 0 ? "Follow traders to see where they trade." : "Nothing in the last 24h.") : "Sign in and follow traders."} />
    </div>
  );
}

/** one line of chips for the side column */
export function TrendingStrip({ onNavigate }: { onNavigate?: () => void }) {
  const q = useTrending();
  const d = q.data;
  const rows = d ? (d.followed && d.followed.length ? d.followed : d.mostOpened1h.length >= 3 ? d.mostOpened1h : d.mostOpened) : [];
  if (!rows.length) return null;
  const label = d?.followed && d.followed.length ? "Your people" : d && d.mostOpened1h.length >= 3 ? "Hot now" : "Trending";
  return (
    <div className="px-3 py-2 border-b border-line flex items-center gap-1.5 overflow-x-auto" data-testid="trending-strip">
      <span className="text-[11px] text-muted shrink-0 inline-flex items-center gap-1"><span className="text-brand"><Icon.spark /></span>{label}</span>
      {rows.slice(0, 6).map((r) => (
        <Link key={r.coin} href={`/m/${encodeURIComponent(r.coin)}`} onClick={onNavigate} className="pill pill-neutral shrink-0 hover:border-brand/50 inline-flex items-center gap-1">
          <CoinIcon coin={r.coin.replace(/^[a-z]+:/, "")} size={14} /> {r.coin} <span className="text-dim num">{r.count}</span>
        </Link>
      ))}
    </div>
  );
}
