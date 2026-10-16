"use client";
/** the social line under a market header: who you follow is in this market, which way, and how often it was copied today */
import { fmtUsd, userLabel } from "@/lib/format";
import { Avatar, Icon, TraderLink } from "../ui";
import type { MarketPosition } from "./positions-table";

export function SocialStrip({ coin, label, positions, copies24h, signedIn, onShowFollowing }: { coin: string; label?: string; positions?: MarketPosition[]; copies24h?: number; signedIn: boolean; onShowFollowing?: () => void }) {
  const list = positions ?? [];
  if (!list.length && !copies24h) return null;
  const name = label ?? coin;
  const followed = list.filter((p) => p.followed);
  const pick = followed.length ? followed : [...list].sort((a, b) => b.sizeUsd - a.sizeUsd).slice(0, 30);
  const longs = pick.filter((p) => p.side === "LONG");
  const shorts = pick.filter((p) => p.side === "SHORT");
  const net = longs.reduce((a, p) => a + p.sizeUsd, 0) - shorts.reduce((a, p) => a + p.sizeUsd, 0);
  const faces = [...pick].sort((a, b) => b.sizeUsd - a.sizeUsd).slice(0, 6);
  const biggest = faces[0];
  const copies = copies24h ?? 0;
  return (
    <div className="flex items-center gap-3 flex-wrap text-[12px] px-1 pt-2 mt-2 border-t border-line/70" data-testid="social-strip">
      {faces.length > 0 && (
        <span className="flex items-center -space-x-2" aria-hidden>
          {faces.map((p) => (
            <TraderLink key={p.id} address={p.address} handle={p.user?.handle} displayName={p.user?.displayName} className="hover:no-underline relative hover:z-10">
              <span className="block rounded-full" style={{ boxShadow: `0 0 0 2px var(--color-bg), 0 0 0 3px ${p.side === "LONG" ? "var(--color-up)" : "var(--color-down)"}` }}>
                <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle ?? p.user?.displayName} size={22} />
              </span>
            </TraderLink>
          ))}
        </span>
      )}
      {followed.length > 0 ? (
        <span className="text-fg-2">
          <b className="text-fg">{followed.length} {followed.length === 1 ? "trader" : "traders"} you follow</b> {followed.length === 1 ? "is" : "are"} in {name}
        </span>
      ) : list.length > 0 ? (
        <span className="text-fg-2">
          <b className="text-fg">{list.length} tracked {list.length === 1 ? "trader" : "traders"}</b> in {name}
        </span>
      ) : null}
      {pick.length > 0 && (
        <span className="num text-muted">
          <span className="text-up">{longs.length} long</span> · <span className="text-down">{shorts.length} short</span>
          {Math.abs(net) >= 1 && <> · net <span className={net >= 0 ? "text-up" : "text-down"}>{net >= 0 ? "long" : "short"} {fmtUsd(Math.abs(net), { compact: true })}</span></>}
        </span>
      )}
      {!followed.length && biggest && (
        <span className="text-muted hidden sm:inline">
          biggest: <TraderLink address={biggest.address} handle={biggest.user?.handle} displayName={biggest.user?.displayName} className="text-fg-2 font-medium">{biggest.user ? userLabel(biggest.user) : undefined}</TraderLink> <span className="num">{fmtUsd(biggest.sizeUsd, { compact: true })}</span>
        </span>
      )}
      {copies > 0 && (
        <span className="inline-flex items-center gap-1 text-muted num" title="positions opened with Copy on this market in the last 24h">
          <Icon.copy /> copied {copies}× today
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {followed.length > 0 && onShowFollowing && (
          <button className="text-brand hover:underline" onClick={onShowFollowing}>
            Show their positions
          </button>
        )}
        {!signedIn && <span className="text-dim">Sign in and follow traders to see yours here</span>}
        {signedIn && followed.length === 0 && list.length > 0 && <span className="text-dim">Follow traders to see your people here</span>}
      </span>
    </div>
  );
}
