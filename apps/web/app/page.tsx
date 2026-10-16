import { fetchApi } from "@/lib/api";
import { serverApiBaseUrl } from "@/lib/server/backendPort";
import { MarketOverviewClient, type MarketIndexQuote } from "@/components/market/MarketOverviewClient";

export const dynamic = "force-dynamic";

export default async function MarketOverview() {
  let indices: MarketIndexQuote[] = [];
  let fetchError: string | null = null;
  const apiBaseUrl = serverApiBaseUrl();

  try {
    indices = await fetchApi<MarketIndexQuote[]>("/market/indices", { baseUrl: apiBaseUrl });
  } catch (error) {
    console.error("Failed to fetch market indices:", error);
    fetchError = error instanceof Error ? error.message : "Failed to load market indices.";
  }

  // The header, the tabs and the regime line are client components (MarketOverviewClient), so their
  // copy comes from the en/ko catalogs (spec §3). This server component only fetches the cards.
  return <MarketOverviewClient indices={indices} fetchError={fetchError} />;
}
