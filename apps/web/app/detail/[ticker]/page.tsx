import { DetailView } from "./DetailView";

interface PageProps {
  // A Promise in Next.js 16, not a plain object. Typed as the object it used to be, the
  // compiler accepted `params.ticker`, which is undefined at runtime -- so every ticker's page
  // fetched /detail/UNDEFINED and rendered "No data available for UNDEFINED".
  params: Promise<{
    ticker: string;
  }>;
}

// The page fetches nothing: DetailView loads its data in the browser.
export default async function TickerDetailPage({ params }: PageProps) {
  const { ticker: routeTicker } = await params;
  return <DetailView ticker={decodeURIComponent(routeTicker).toUpperCase()} />;
}
