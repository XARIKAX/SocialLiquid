"use client";
import { useEffect, useState, type ReactNode } from "react";
import { TopBar } from "./top-bar";
import { FeedColumn } from "./feed/feed-column";

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

/** fomo layout: left feed, centre content, right panel (owned by the page). on mobile the feed is a tab. */
export function Shell({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<"feed" | "page">("page");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // the feed is client-fetched anyway, so mount it after hydration and only where it is visible
  const showFeed = isDesktop === true || (isDesktop === false && tab === "feed");
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar onToggleFeed={() => setTab((t) => (t === "feed" ? "page" : "feed"))} />
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] md:h-[calc(100dvh-3rem)] pb-12 md:pb-0">
        <aside className={`${tab === "feed" ? "block" : "hidden"} md:block border-r border-line bg-panel md:h-full md:overflow-hidden`}>
          {showFeed ? <FeedColumn onNavigate={() => setTab("page")} /> : <div className="p-2 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-14" />)}</div>}
        </aside>
        <main className={`${tab === "page" ? "block" : "hidden"} md:block min-w-0 md:h-full md:overflow-y-auto`}>{children}</main>
      </div>
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-12 border-t border-line bg-panel grid grid-cols-2 z-30" aria-label="mobile">
        <button className={`text-sm ${tab === "feed" ? "text-fg" : "text-muted"}`} onClick={() => setTab("feed")}>feed</button>
        <button className={`text-sm ${tab === "page" ? "text-fg" : "text-muted"}`} onClick={() => setTab("page")}>trade</button>
      </nav>
    </div>
  );
}
