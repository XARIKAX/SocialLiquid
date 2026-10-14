import { PortfolioView } from "@/components/portfolio/portfolio-view";

export const metadata = { title: "portfolio" };
export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  return <PortfolioView />;
}
