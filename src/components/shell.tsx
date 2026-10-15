"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media";
import { useAuth } from "@/hooks/use-auth";
import { useConnectModal } from "./connect-modal";
import { openProfileEditor } from "./profile-editor";
import { TopBar } from "./top-bar";
import { FeedColumn } from "./feed/feed-column";
import { Ticker } from "./ticker";
import { Icon } from "./icons";
import { useAccount } from "wagmi";
import { FundsHost } from "./trade/funds";
import { ConvertHost } from "./trade/convert";
import { ChaseRunner } from "./trade/chase-runner";
import { ProfileHost } from "./profile-editor";
import { AlertToasts } from "./alerts";

/** fomo layout: framed feed on the left, page content (centre + right) owned by the route. mobile: feed / trade tabs. */
export function Shell({ children }: { children: ReactNode }) {
  const { address: wallet } = useAccount();
  const [tab, setTab] = useState<"feed" | "page">("page");
  const pathname = usePathname();
  // a route change (bottom bar, link in the feed) always shows the page
  useEffect(() => setTab("page"), [pathname]);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sl:feed-collapsed") === "1");
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sl:feed-collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const showFeed = isDesktop === true || (isDesktop === false && tab === "feed");
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar onToggleFeed={() => setTab((t) => (t === "feed" ? "page" : "feed"))} />
      {wallet && <FundsHost address={wallet} />}
      {wallet && <ConvertHost address={wallet} />}
      {wallet && <ChaseRunner />}
      <ProfileHost />
      <AlertToasts />
      <div className={`flex-1 grid grid-cols-1 ${collapsed ? "md:grid-cols-[48px_minmax(0,1fr)]" : "md:grid-cols-[320px_minmax(0,1fr)]"} gap-3 px-3 md:px-4 pb-16 md:pb-11 md:h-[calc(100dvh-3.5rem)] transition-[grid-template-columns]`}>
        <aside className={`${tab === "feed" ? "block" : "hidden"} md:block card md:h-[calc(100dvh-3.5rem-2.75rem-0.25rem)] overflow-hidden`}>
          {collapsed && isDesktop ? (
            <button className="w-full h-full flex flex-col items-center pt-3 gap-3 text-muted hover:text-fg" onClick={toggleCollapsed} title="expand feed">
              <Icon.collapse className="rotate-180" />
              <span className="text-[10px] tracking-[0.2em] uppercase [writing-mode:vertical-rl]">Feed</span>
            </button>
          ) : showFeed ? (
            <FeedColumn onNavigate={() => setTab("page")} onCollapse={isDesktop ? toggleCollapsed : undefined} initialTab={isDesktop ? undefined : "feed"} />
          ) : (
            <div className="p-3 space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="skeleton h-16" style={{ opacity: 1 - i * 0.12 }} />
              ))}
            </div>
          )}
        </aside>
        <main className={`${tab === "page" ? "block" : "hidden"} md:block min-w-0 md:h-[calc(100dvh-3.5rem-2.75rem-0.25rem)] md:overflow-y-auto`}>{children}</main>
      </div>
      <Ticker />
      <MobileNav tab={tab} onFeed={() => setTab("feed")} onPage={() => setTab("page")} />
    </div>
  );
}

/** phone bottom bar: Feed · Markets · Trade · Keys · Portfolio · Me */
function MobileNav({ tab, onFeed, onPage }: { tab: "feed" | "page"; onFeed: () => void; onPage: () => void }) {
  const pathname = usePathname();
  const { signedIn, isConnected, me, signIn } = useAuth();
  const connect = useConnectModal();
  const [lastCoin, setLastCoin] = useState("BTC");
  useEffect(() => {
    const m = pathname.match(/^\/m\/([^/?#]+)/);
    if (m) {
      setLastCoin(decodeURIComponent(m[1]));
      try {
        localStorage.setItem("sl:last-coin", decodeURIComponent(m[1]));
      } catch {}
    } else {
      try {
        setLastCoin(localStorage.getItem("sl:last-coin") ?? "BTC");
      } catch {}
    }
  }, [pathname]);
  const page = tab === "page";
  const is = (re: RegExp) => page && re.test(pathname);
  const item = "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium leading-none";
  const on = "text-fg";
  const off = "text-muted";
  const handle = me?.user?.handle;
  const meHref = handle ? `/t/${handle}` : null;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 h-14 border-t border-line bg-panel/95 backdrop-blur grid grid-cols-6 z-30 pb-[env(safe-area-inset-bottom)]" aria-label="mobile" data-testid="mobile-nav">
      <button className={`${item} ${tab === "feed" ? on : off}`} onClick={onFeed} aria-current={tab === "feed" ? "page" : undefined}>
        <Icon.users /> Feed
      </button>
      <Link href="/tokens" className={`${item} ${is(/^\/tokens/) ? on : off}`} onClick={onPage}>
        <Icon.search /> Markets
      </Link>
      <Link href={`/m/${encodeURIComponent(lastCoin)}`} className={`${item} ${is(/^\/(m\/|trade)/) ? on : off}`} onClick={onPage}>
        <Icon.spark /> Trade
      </Link>
      <Link href="/keys" className={`${item} ${is(/^\/keys/) ? on : off}`} onClick={onPage}>
        <Icon.key /> Keys
      </Link>
      <Link href="/portfolio" className={`${item} ${is(/^\/portfolio/) ? on : off}`} onClick={onPage}>
        <Icon.wallet /> Portfolio
      </Link>
      {meHref ? (
        <Link href={meHref} className={`${item} ${is(/^\/t\//) ? on : off}`} onClick={onPage}>
          <Icon.star /> Me
        </Link>
      ) : (
        <button className={`${item} ${off}`} onClick={() => (!isConnected ? connect.open() : !signedIn ? void signIn() : openProfileEditor())}>
          <Icon.star /> Me
        </button>
      )}
    </nav>
  );
}
