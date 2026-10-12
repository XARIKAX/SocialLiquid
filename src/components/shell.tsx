"use client";
import { useEffect, useState, type ReactNode } from "react";
import { TopBar } from "./top-bar";
import { FeedColumn } from "./feed/feed-column";
import { Ticker } from "./ticker";
import { Icon } from "./icons";
import { useAccount } from "wagmi";
import { FundsHost } from "./trade/funds";
import { ConvertHost } from "./trade/convert";
import { ProfileHost } from "./profile-editor";
import { AlertToasts } from "./alerts";

function useMediaQuery(q: string): boolean | undefined {
  const [m, setM] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** fomo layout: framed feed on the left, page content (centre + right) owned by the route. mobile: feed / trade tabs. */
export function Shell({ children }: { children: ReactNode }) {
  const { address: wallet } = useAccount();
  const [tab, setTab] = useState<"feed" | "page">("page");
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
      <ProfileHost />
      <AlertToasts />
      <div className={`flex-1 grid grid-cols-1 ${collapsed ? "md:grid-cols-[48px_minmax(0,1fr)]" : "md:grid-cols-[320px_minmax(0,1fr)]"} gap-3 px-3 md:px-4 pb-14 md:pb-11 md:h-[calc(100dvh-3.5rem)] transition-[grid-template-columns]`}>
        <aside className={`${tab === "feed" ? "block" : "hidden"} md:block card md:h-[calc(100dvh-3.5rem-2.75rem-0.25rem)] overflow-hidden`}>
          {collapsed && isDesktop ? (
            <button className="w-full h-full flex flex-col items-center pt-3 gap-3 text-muted hover:text-fg" onClick={toggleCollapsed} title="expand feed">
              <Icon.collapse className="rotate-180" />
              <span className="text-[10px] tracking-[0.2em] uppercase [writing-mode:vertical-rl]">Feed</span>
            </button>
          ) : showFeed ? (
            <FeedColumn onNavigate={() => setTab("page")} onCollapse={isDesktop ? toggleCollapsed : undefined} />
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-12 border-t border-line bg-panel grid grid-cols-2 z-30" aria-label="mobile">
        <button className={`text-sm font-medium ${tab === "feed" ? "text-fg" : "text-muted"}`} onClick={() => setTab("feed")}>Feed</button>
        <button className={`text-sm font-medium ${tab === "page" ? "text-fg" : "text-muted"}`} onClick={() => setTab("page")}>Trade</button>
      </nav>
    </div>
  );
}
