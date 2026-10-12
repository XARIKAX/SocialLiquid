"use client";
import "./layout.css";
import Link from "next/link";
import { memo, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { userLabel, userPath } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/queries";
import { useAuth } from "@/hooks/use-auth";
import { useConnectModal } from "../connect-modal";
import { Avatar, Icon } from "../ui";
import { SplitBar, money } from "./layout-bits";

/* =====================================================================
   the side cards under the ticket (styles: ./layout.css, .tm-lay-*):
   position flow as one big lit number over a split bar with light in
   it, and the traders worth following as glass rows with a quiet
   follow button.
   ===================================================================== */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** money in, money out: two opposed arrows */
function FlowGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M7 20V5M3.5 8.5 7 5l3.5 3.5M17 4v15M13.5 15.5 17 19l3.5-3.5" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...S} strokeWidth={2.1} aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function Plus() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...S} strokeWidth={2.4} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** a side's colour only when it has something in it: an empty side reads quiet, never red or green */
const tone = (v: number, side: "up" | "down") => (v > 0 ? `tm-lay-${side}` : "tm-lay-zero");

/**
 * gomo's order flow card, for perps: notional opened long vs short in the last 24h.
 * memoised (as is TradersToFollow): the market view re-renders on every tick of the mid, these cards never need to.
 */
export const FlowCard = memo(function FlowCard({ coin, flow }: { coin: string; flow?: { longUsd: number; shortUsd: number; count: number } }) {
  const id = useId();
  // no data yet is not the same as no flow: it shows as unknown, not as zeros
  const known = !!flow;
  const l = flow?.longUsd ?? 0;
  const s = flow?.shortUsd ?? 0;
  const net = l - s;
  const tot = l + s;
  const longShare = tot ? l / tot : 0.5;
  const leadPct = Math.round(Math.max(longShare, 1 - longShare) * 100);
  // a lead that rounds to 50% is no lead: call it even
  const lead = !tot ? null : leadPct === 50 ? "even" : longShare > 0.5 ? "long" : "short";
  const dir = net > 0 ? "up" : net < 0 ? "down" : "flat";
  const fills = flow?.count ?? 0;
  return (
    <section className="card tm-lay-card tm-lay-flow" data-dir={dir} aria-labelledby={id}>
      <header className="tm-lay-ch">
        <span className="tm-lay-ch-ico" data-tone="mint" aria-hidden>
          <FlowGlyph />
        </span>
        <h3 id={id} className="tm-lay-ch-title">
          Position flow
        </h3>
        <span className="tm-lay-ch-end tm-lay-tag">
          <i className="tm-lay-live" aria-hidden />
          24h · {coin}
        </span>
      </header>
      <div className="tm-lay-flow-hero">
        <div className="min-w-0">
          <div className="label-caps">Net opened</div>
          <div className={`tm-lay-flow-net tm-lay-${known ? dir : "zero"}`}>{known ? money(net, { sign: true }) : "–"}</div>
        </div>
        {lead === "even" ? (
          <span className="pill pill-neutral">Even split</span>
        ) : (
          lead && (
            <span className={`pill ${lead === "long" ? "pill-up" : "pill-down"}`}>
              {lead === "long" ? "Longs" : "Shorts"} lead · <span className="num">{leadPct}%</span>
            </span>
          )
        )}
      </div>
      <SplitBar share={tot ? longShare : null} label={tot ? `${Math.round(longShare * 100)}% of the notional opened was long, ${100 - Math.round(longShare * 100)}% short` : known ? "No positions opened in the last 24 hours" : "Loading the last 24 hours"} />
      <div className="tm-lay-legs tm-lay-legs-3">
        <span>
          <b className={tone(l, "up")}>{known ? money(l) : "–"}</b> <small>longs</small>
        </span>
        <span className="tm-lay-flow-fills">
          <b>{known ? fills : "–"}</b> {fills === 1 ? "fill" : "fills"}
        </span>
        <span>
          <small>shorts</small> <b className={tone(s, "down")}>{known ? money(s) : "–"}</b>
        </span>
      </div>
    </section>
  );
});

/** the line under a name: social proof once there is some, the record before that */
function meta(r: LeaderboardRow) {
  const win = r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}% win` : null;
  const trades = `${r.stats.closedTrades} ${r.stats.closedTrades === 1 ? "trade" : "trades"}`;
  if (r.followers > 0) return [`${r.followers} ${r.followers === 1 ? "follower" : "followers"}`, win ?? trades].join(" · ");
  return win ? `${win} · ${trades}` : trades;
}

export const TradersToFollow = memo(function TradersToFollow() {
  const id = useId();
  const { signedIn, needsSignIn, signIn, busy: authBusy } = useAuth();
  const connect = useConnectModal();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leaderboard", "pnl7d"], queryFn: () => api<{ rows: LeaderboardRow[] }>("/api/leaderboard?by=pnl7d").then((r) => r.rows), staleTime: 30_000 });
  const me = useQuery({ queryKey: ["me-follows"], queryFn: () => api<{ addresses: string[] }>("/api/follow"), enabled: signedIn, staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (q.data ?? []).slice(0, 5);
  if (!q.isLoading && !rows.length) return null;
  const following = new Set(me.data?.addresses ?? []);
  const toggle = async (address: string) => {
    // signed out, the button is the way in: connect a wallet, or sign the session if one is connected
    if (!signedIn) {
      if (needsSignIn) signIn();
      else connect.open();
      return;
    }
    setBusy(address);
    try {
      await api("/api/follow", { method: "POST", json: { address, follow: !following.has(address) } });
      qc.invalidateQueries({ queryKey: ["me-follows"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(null);
    }
  };
  const hint = signedIn ? undefined : needsSignIn ? "Sign in to follow traders" : "Connect a wallet to follow traders";
  return (
    <section className="card tm-lay-card tm-lay-tf" aria-labelledby={id}>
      <header className="tm-lay-ch">
        <span className="tm-lay-ch-ico" data-tone="thesis" aria-hidden>
          <Icon.users />
        </span>
        <h3 id={id} className="tm-lay-ch-title">
          Traders to follow
        </h3>
        <Link href="/leaderboard" className="tm-lay-ch-end tm-lay-link">
          See all <Arrow />
        </Link>
      </header>
      {q.isLoading ? (
        <div className="mt-2.5" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            // the row's own anatomy (sphere, name over its record, pnl over 7d, the follow pill), so nothing jumps when it lands
            <div key={i} className="tm-lay-tf-skel" style={{ opacity: 1 - i * 0.15 }}>
              <span className="skeleton rounded-full w-8 h-8 shrink-0" />
              <span className="flex-1 space-y-1.5">
                <span className="skeleton block h-2.5 w-24" />
                <span className="skeleton block h-2 w-32" />
              </span>
              <span className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="skeleton block h-2.5 w-10" />
                <span className="skeleton block h-2 w-5" />
              </span>
              <span className="skeleton rounded-full w-[70px] h-[26px] shrink-0" />
            </div>
          ))}
        </div>
      ) : (
        <ol className="tm-lay-tf-list">
          {rows.map((r, i) => {
            const on = following.has(r.user.address);
            const label = userLabel(r.user);
            const pnl = r.stats.pnl7d;
            return (
              <li key={r.user.address} className="tm-lay-tf-row">
                <Link href={userPath(r.user)} className="tm-lay-av" tabIndex={-1} aria-hidden>
                  <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={32} />
                  <span className="tm-lay-rank num" data-r={i + 1}>
                    {i + 1}
                  </span>
                </Link>
                <span className="tm-lay-tf-who">
                  <Link href={userPath(r.user)} className="tm-lay-tf-name">
                    {label}
                  </Link>
                  <span className="tm-lay-tf-meta num">{meta(r)}</span>
                </span>
                <span className="tm-lay-tf-pnl" title="Realised PnL, last 7 days">
                  <b className={pnl > 0 ? "tm-lay-up" : pnl < 0 ? "tm-lay-down" : "tm-lay-flat"}>{money(pnl, { sign: true })}</b>
                  <small>7D</small>
                </span>
                {/* a toggle: one name ("Follow X"), its state in aria-pressed (pressed = following) */}
                <button
                  type="button"
                  className="tm-lay-follow"
                  aria-pressed={on}
                  aria-label={`Follow ${label}`}
                  aria-busy={busy === r.user.address || (authBusy && !signedIn) || undefined}
                  disabled={busy === r.user.address}
                  title={hint}
                  onClick={() => toggle(r.user.address)}
                >
                  {on ? <Icon.check /> : <Plus />}
                  {on ? "Following" : "Follow"}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
