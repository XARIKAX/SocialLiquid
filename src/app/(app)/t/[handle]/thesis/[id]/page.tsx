import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { Avatar, CoinIcon, OutcomePill, Pnl, SidePill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ThesisThread } from "@/components/feed/thesis-thread";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string; id: string }> };

async function load(id: string) {
  return prisma.thesis.findUnique({ where: { id }, include: { user: true, position: true, _count: { select: { likes: true, replies: true } } } });
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://socialliquid.fun";
  const url = `${appUrl}/t/${t.user.handle ?? t.user.address}/thesis/${t.id}`;
  const share = `https://x.com/intent/tweet?${new URLSearchParams({ text: `${p ? `${p.side.toLowerCase()} ${t.coin} ${p.leverage}x` : t.coin}: ${t.text}`, url, hashtags: "socialLiquid,hyperliquid" })}`;
  return (
    <div className="max-w-2xl mx-auto pt-4 pb-3">
      <article className="card p-5">
        <div className="flex items-center gap-3">
          <Link href={`/t/${t.user.handle ?? t.user.address}`}><Avatar address={t.user.address} url={t.user.avatarUrl} handle={t.user.handle} size={40} /></Link>
          <div className="leading-tight">
            <Link href={`/t/${t.user.handle ?? t.user.address}`} className="font-semibold hover:underline">{who}</Link>
            <div className="text-xs text-muted flex items-center gap-2">
              {t.user.xHandle && <a className="inline-flex items-center gap-1 hover:text-fg" href={`https://x.com/${t.user.xHandle}`} target="_blank" rel="noreferrer"><Icon.x /> {t.user.xHandle}</a>}
              <span className="num">{timeAgo(t.createdAt)} ago</span>
            </div>
          </div>
          <span className="pill pill-thesis ml-auto">Thesis</span>
        </div>
        <div className="flex items-center gap-2 mt-4 text-xs flex-wrap">
          <CoinIcon coin={t.coin} size={22} />
          <Link href={`/m/${t.coin}`} className="font-semibold text-[15px] hover:underline">{t.coin}</Link>
          {p && <SidePill side={p.side} />}
          {p && <span className="num text-muted">{fmtUsd(Number(p.sizeUsd), { compact: true })} · {p.leverage}x · entry {fmtPx(Number(p.entryPx))}</span>}
        </div>
        <p className="text-[17px] leading-snug mt-3 whitespace-pre-wrap break-words">{t.text}</p>
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-line text-xs">
          <OutcomePill outcome={t.outcome} />
          {p?.closedAt && <Pnl value={Number(p.realisedPnl)} className="font-semibold" />}
          {p && !p.closedAt && <Pnl value={Number(p.unrealisedPnl)} className="font-semibold" />}
          <span className="inline-flex items-center gap-1 text-muted num"><Icon.heart /> {t._count.likes}</span>
          <span className="inline-flex items-center gap-1 text-muted num"><Icon.reply /> {t._count.replies}</span>
          <a className="btn btn-sm ml-auto" href={share} target="_blank" rel="noreferrer"><Icon.x /> Share on X</a>
        </div>
      </article>
      <section className="card p-4 mt-3">
        <h2 className="text-[13px] font-semibold">Replies</h2>
        <ThesisThread thesisId={t.id} />
      </section>
      <p className="text-[11px] text-dim mt-3 text-center text-balance">Receipts: a thesis is bound to the position at post time. Close within 60 minutes and it is tagged Dumped. Outcomes come from on-chain fills, not self reports.</p>
    </div>
  );
}
