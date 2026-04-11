import { discoverBackendPort } from "@/app/actions/discovery";
import { apiBaseUrlForPort, fetchApi } from "@/lib/api";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";

export const dynamic = "force-dynamic";

// Match the Python Pydantic schema
interface IndexQuote {
  name: string;
  ticker: string;
  last_close: number | null;
  delta: {
    delta_pct: number;
  };
  sparkline: number[];
}

export default async function MarketOverview() {
  // SSR Fetch from FastAPI backend
  let indices: IndexQuote[] = [];
  const backendPort = await discoverBackendPort();
  const apiBaseUrl = apiBaseUrlForPort(backendPort);

  try {
    indices = await fetchApi<IndexQuote[]>("/market/indices", { baseUrl: apiBaseUrl });
  } catch (error) {
    console.error("Failed to fetch market indices:", error);
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          Market Overview
        </h1>
        <p className="text-[var(--text-muted)] mt-1">
          Real-time snapshot of major global and domestic indices
        </p>
      </header>

      {indices.length === 0 ? (
        <div className="p-8 rounded-[var(--radius)] border border-dashed border-[var(--border)] text-center text-[var(--text-muted)]">
          No market data available. Ensure FastAPI backend is running and discoverable.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {indices.map((idx) => (
            <div
              key={idx.ticker}
              className="bg-white rounded-[var(--radius)] border border-[var(--border)] shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-lg text-[var(--text-primary)]">
                    {idx.name}
                  </h3>
                  <span className="text-xs text-[var(--text-muted)] uppercase">
                    {idx.ticker}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-xl tabular-nums">
                    {idx.last_close == null
                      ? "N/A"
                      : idx.last_close.toLocaleString(undefined, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                  </div>
                  <DeltaBadge value={idx.delta.delta_pct} className="mt-1" />
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-[var(--border)]/50">
                <Sparkline 
                  data={idx.sparkline} 
                  color={idx.delta.delta_pct >= 0 ? "var(--delta-up)" : "var(--delta-down)"}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
