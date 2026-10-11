import { LeaderboardTable } from "@/components/trader/leaderboard";

export const metadata = { title: "leaderboard" };
export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return <LeaderboardTable />;
}
