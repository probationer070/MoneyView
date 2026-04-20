import { apiBaseUrlForPort, fetchApi } from "@/lib/api";
import { readBackendPort } from "@/lib/server/backendPort";
import { MarketOverviewClient, type MarketIndexQuote } from "@/components/market/MarketOverviewClient";

export const dynamic = "force-dynamic";

export default async function MarketOverview() {
  // SSR Fetch from FastAPI backend
  let indices: MarketIndexQuote[] = [];
  const backendPort = readBackendPort();
  const apiBaseUrl = apiBaseUrlForPort(backendPort);

  try {
    indices = await fetchApi<MarketIndexQuote[]>("/market/indices", { baseUrl: apiBaseUrl });
  } catch (error) {
    console.error("Failed to fetch market indices:", error);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          Market Overview
        </h1>
        <p className="text-[var(--text-muted)] mt-1">
          Real-time snapshot of major global and domestic indices
        </p>
      </header>

      <MarketOverviewClient indices={indices} />
    </div>
  );
}
