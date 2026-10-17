import type { Metadata } from "next";
import { StatsView } from "@/components/stats/stats-view";

export const metadata: Metadata = { title: "Stats", description: "volume, fees, trades and traders on socialLiquid, by day, week or month" };
export const dynamic = "force-dynamic";

export default function StatsPage() {
  return <StatsView />;
}
