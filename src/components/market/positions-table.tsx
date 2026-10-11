"use client";
import { useMemo, useState } from "react";
import { fmtDuration, fmtPx, fmtUsd, timeAgo } from "@/lib/format";
import { livePnl } from "@/hooks/use-market";
import type { UserLite } from "@/lib/queries";
import { Avatar, Empty, SidePill, Skeleton, Toggle, TraderLink } from "../ui";
import { useAuth } from "@/hooks/use-auth";

export type MarketPosition = {
  id: string;
  address: string;
  user: UserLite | null;
  side: string;
  size: number;
  sizeUsd: number;
  leverage: number;
  entryPx: number;
  openedAt: string;
  unrealisedPnl: number;
  closedCount: number;
  avgHoldMs: number | null;
  thesis: { id: string; text: string; likes: number; outcome: string } | null;
};

type Sort = "pnl" | "size";

export function PositionsTable({
  positions,
  mid,
  loading,
  thesisOnly,
  following,
  setThesisOnly,
  setFollowing,
}: {
  positions: MarketPosition[] | undefined;
  mid?: number;
  loading: boolean;
  thesisOnly: boolean;
  following: boolean;
  setThesisOnly: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
}) {
  const [sort, setSort] = useState<Sort>("size");
  const { signedIn } = useAuth();
  const rows = useMemo(() => {
    const list = (positions ?? []).map((p) => ({ ...p, pnl: livePnl(p, mid) ?? p.unrealisedPnl }));
    return list.sort((a, b) => (sort === "pnl" ? b.pnl - a.pnl : b.sizeUsd - a.sizeUsd));
  }, [positions, mid, sort]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 h-9 border-b border-line text-[11px]">
        <span className="text-muted mr-1">positions</span>
        <span className="num text-dim">{positions?.length ?? 0}</span>
        <span className="mx-2 w-px h-4 bg-line" />
        <Toggle on={thesisOnly} onChange={setThesisOnly} label="thesis only" />
        <Toggle on={following} onChange={setFollowing} label="following only" />
        <span className="ml-auto text-dim">sort</span>
        {(["size", "pnl"] as Sort[]).map((s) => (
          <button key={s} className={`px-1.5 h-6 rounded ${sort === s ? "bg-panel-2 text-fg" : "text-muted"}`} onClick={() => setSort(s)}>
            {s}
          </button>
        ))}
      </div>
      {loading && <Skeleton rows={6} h={32} />}
      {!loading && following && !signedIn && <Empty title="sign in to filter by following" />}
      {!loading && rows.length === 0 && (signedIn || !following) && <Empty title="no open positions here" hint={thesisOnly ? "nobody has posted a thesis on this market yet." : "tracked traders have nothing open in this market."} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead className="text-[10px] uppercase text-dim">
              <tr className="border-b border-line">
                <th className="text-left font-medium px-3 py-1.5">trader</th>
                <th className="text-left font-medium px-2 py-1.5">side</th>
                <th className="text-right font-medium px-2 py-1.5">size</th>
                <th className="text-right font-medium px-2 py-1.5">lev</th>
                <th className="text-right font-medium px-2 py-1.5">entry</th>
                <th className="text-right font-medium px-2 py-1.5">pnl</th>
                <th className="text-right font-medium px-2 py-1.5">hold</th>
                <th className="text-right font-medium px-2 py-1.5">avg hold</th>
                <th className="text-left font-medium px-2 py-1.5">thesis</th>
                <th className="text-right font-medium px-3 py-1.5">♥</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line/60 hover:bg-panel-2">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle} size={18} />
                      <TraderLink address={p.address} handle={p.user?.handle} className="truncate max-w-[8rem]" />
                    </span>
                  </td>
                  <td className="px-2"><SidePill side={p.side} /></td>
                  <td className="num text-right px-2">{fmtUsd(p.sizeUsd, { compact: true })}</td>
                  <td className="num text-right px-2 text-muted">{p.leverage}x</td>
                  <td className="num text-right px-2">{fmtPx(p.entryPx)}</td>
                  <td className={`num text-right px-2 ${p.pnl > 0 ? "text-up" : p.pnl < 0 ? "text-down" : "text-muted"}`}>{fmtUsd(p.pnl, { sign: true })}</td>
                  <td className="num text-right px-2 text-muted" title={`opened ${timeAgo(p.openedAt)} ago`}>{fmtDuration(Date.now() - new Date(p.openedAt).getTime())}</td>
                  <td className="num text-right px-2 text-dim" title={`${p.closedCount} closed trades on this market`}>{p.avgHoldMs ? fmtDuration(p.avgHoldMs) : "–"}</td>
                  <td className="px-2 max-w-[18rem] truncate text-muted" title={p.thesis?.text}>{p.thesis?.text ?? <span className="text-dim">–</span>}</td>
                  <td className="num text-right px-3 text-muted">{p.thesis?.likes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
