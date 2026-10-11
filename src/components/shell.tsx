"use client";
import { useState, type ReactNode } from "react";
import { TopBar } from "./top-bar";
import { FeedColumn } from "./feed/feed-column";

/** fomo layout: left feed, centre content, right panel (owned by the page) */
export function Shell({ children }: { children: ReactNode }) {
  const [feedOpen, setFeedOpen] = useState(false);
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar onToggleFeed={() => setFeedOpen((v) => !v)} />
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] md:h-[calc(100dvh-3rem)]">
        <aside className={`${feedOpen ? "block" : "hidden"} md:block border-r border-line bg-panel md:h-full md:overflow-hidden`}>
          <FeedColumn onNavigate={() => setFeedOpen(false)} />
        </aside>
        <main className="min-w-0 md:h-full md:overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
