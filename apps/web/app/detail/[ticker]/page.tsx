import { discoverBackendPort } from "@/app/actions/discovery";
import { apiBaseUrlForPort, fetchApi } from "@/lib/api";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import TVChart from "@/components/charts/TVChart";
import { transformToTVCandles, transformToTVVolume } from "@/lib/transformers";
import { DCFWorkbench } from "@/components/workbenches/DCFWorkbench";
import { DiagnosticWorkbench } from "@/components/workbenches/DiagnosticWorkbench";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

interface PageProps {
  params: {
    ticker: string;
  };
}

interface StockOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dividends: number;
  stock_splits: number;
}

interface Technicals {
  ticker: string;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  ma_20: number | null;
  ma_50: number | null;
  as_of_date: string | null;
}

export default async function TickerDetailPage({ params }: PageProps) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  const backendPort = await discoverBackendPort();
  const apiBaseUrl = apiBaseUrlForPort(backendPort);

  // Parallel fetching from FastAPI
  const [ohlcv, technicals] = await Promise.all([
    fetchApi<StockOHLCV[]>(`/detail/${ticker}/ohlcv?period=5y`, { baseUrl: apiBaseUrl }).catch(() => []),
    fetchApi<Technicals>(`/detail/${ticker}/technicals?period=5y`, { baseUrl: apiBaseUrl }).catch(() => null),
  ]);

  if (ohlcv.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--text-muted)]">
        No data available for {ticker}.
      </div>
    );
  }

  const current = ohlcv[ohlcv.length - 1];
  const previous = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] : current;
  const deltaAbs = current.close - previous.close;
  const deltaPct = (deltaAbs / previous.close) * 100;

  // Transform data explicitly for the TVChart webGL canvas
  const tvCandles = transformToTVCandles(ohlcv);
  const tvVolume = transformToTVVolume(ohlcv);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex justify-between items-end bg-white p-6 rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
        <div>
          <h1 className="text-4xl font-black text-[var(--text-primary)] tracking-tight">
            {ticker}
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            As of {current.date}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums">
            {current.close.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </div>
          <DeltaBadge value={deltaPct} className="mt-2 text-base px-3 py-1" />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ErrorBoundary fallbackTitle="Price Matrix Offline" fallbackMessage="The TradingView webGL engine failed to boot due to extreme data scaling.">
          <div className="lg:col-span-2 bg-white rounded-[var(--radius)] border border-[var(--border)] p-6 shadow-sm overflow-hidden">
            <h2 className="text-lg font-bold mb-4">Price Trend & Matrix (5Y)</h2>
            <div className="border-t border-[var(--border)]/50 pt-4 -mx-2 h-[450px]">
               <TVChart 
                 data={tvCandles}
                 volumeData={tvVolume}
                 height={400}
                 tickerName={ticker}
                 colorAccent={deltaPct >= 0 ? "#60CAAD" : "#EF5350"}
               />
            </div>
          </div>
        </ErrorBoundary>

        {/* Technical Indicators */}
        <div className="bg-white rounded-[var(--radius)] border border-[var(--border)] p-6 shadow-sm">
          <h2 className="text-lg font-bold mb-4">Technicals (NumPy)</h2>
          {technicals ? (
            <div className="space-y-4 text-sm">
              <div className="flex justify-between pb-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--text-muted)]">RSI (14)</span>
                <span className="font-semibold">{technicals.rsi_14 ?? "N/A"}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--text-muted)]">MACD</span>
                <span className="font-semibold">{technicals.macd ?? "N/A"}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--text-muted)]">Signal</span>
                <span className="font-semibold">{technicals.macd_signal ?? "N/A"}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-[var(--border)]/50">
                <span className="text-[var(--text-muted)]">MA 20</span>
                <span className="font-semibold">{technicals.ma_20 ?? "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">MA 50</span>
                <span className="font-semibold">{technicals.ma_50 ?? "N/A"}</span>
              </div>
            </div>
          ) : (
            <div className="text-[var(--text-muted)] text-sm">Loading technicals...</div>
          )}
        </div>
      </div>

      {/* Interactive DCF React Query Laboratory */}
      <ErrorBoundary fallbackTitle="DCF Diagnostics Error" fallbackMessage="Interactive workbench encountered a critical array validation error locally.">
          <DCFWorkbench ticker={ticker} />
      </ErrorBoundary>

      {/* Advanced Visual Recharts Metrics */}
      <ErrorBoundary fallbackTitle="Corporate Diagnostics Missing" fallbackMessage="Recharts failed mapping the peer overlays from the backend strings.">
          <DiagnosticWorkbench ticker={ticker} />
      </ErrorBoundary>

    </div>
  );
}
