import { apiBaseUrlForPort, fetchApi } from "@/lib/api";
import { readBackendPort } from "@/lib/server/backendPort";
import { MarketOverviewClient, type MarketIndexQuote } from "@/components/market/MarketOverviewClient";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MarketOverview() {
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
      <PageHeader
        title="Market Overview"
        subtitle="Real-time snapshot of major global and domestic indices"
      />
      <MarketOverviewClient indices={indices} />
    </div>
  );
}
