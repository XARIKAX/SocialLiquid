import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { Avatar, OutcomePill, Pnl, SidePill } from "@/components/ui";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string; id: string }> };

async function load(id: string) {
  return prisma.thesis.findUnique({ where: { id }, include: { user: true, position: true, _count: { select: { likes: true } } } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = await load(id);
  if (!t) return {};
  const who = t.user.handle ?? shortAddr(t.user.address);
  const title = `${who} on ${t.coin}: ${t.text.slice(0, 60)}${t.text.length > 60 ? "…" : ""}`;
  return { title, description: t.text, openGraph: { title, description: t.text }, twitter: { card: "summary_large_image", title, description: t.text } };
}

export default async function ThesisPage({ params }: Props) {
  const { id } = await params;
  const t = await load(id);
  if (!t) notFound();
  const who = t.user.handle ?? shortAddr(t.user.address);
  const p = t.position;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const url = `${appUrl}/t/${t.user.handle ?? t.user.address}/thesis/${t.id}`;
  const share = `https://x.com/intent/tweet?${new URLSearchParams({ text: `${p ? `${p.side.toLowerCase()} ${t.coin} ${p.leverage}x` : t.coin}: ${t.text}`, url, hashtags: "socialLiquid,hyperliquid" })}`;
  return (
    <div className="max-w-2xl p-4">
      <article className="card p-4">
        <div className="flex items-center gap-2">
          <Avatar address={t.user.address} url={t.user.avatarUrl} handle={t.user.handle} size={32} />
          <Link href={`/t/${t.user.handle ?? t.user.address}`} className="font-semibold hover:underline">{who}</Link>
          {t.user.xHandle && <a className="text-muted text-xs" href={`https://x.com/${t.user.xHandle}`} target="_blank" rel="noreferrer">@{t.user.xHandle}</a>}
          <span className="ml-auto text-dim text-xs num">{timeAgo(t.createdAt)} ago</span>
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
          <Link href={`/m/${t.coin}`} className="font-semibold text-sm hover:underline">{t.coin}</Link>
          {p && <SidePill side={p.side} />}
          {p && <span className="num text-muted">{fmtUsd(Number(p.sizeUsd), { compact: true })} · {p.leverage}x · entry {fmtPx(Number(p.entryPx))}</span>}
          <OutcomePill outcome={t.outcome} />
          {p?.closedAt && <Pnl value={Number(p.realisedPnl)} />}
          {p && !p.closedAt && <Pnl value={Number(p.unrealisedPnl)} />}
        </div>
        <p className="text-base mt-3 whitespace-pre-wrap break-words">{t.text}</p>
        <div className="flex items-center gap-3 mt-4 text-xs text-muted">
          <span>♥ {t._count.likes}</span>
          <a className="btn h-7 ml-auto" href={share} target="_blank" rel="noreferrer">share on x ↗</a>
        </div>
      </article>
      <p className="text-[11px] text-dim mt-3">receipts: a thesis is bound to the position at post time. close within 60 minutes and it is tagged dumped. outcomes come from on-chain fills.</p>
    </div>
  );
}
