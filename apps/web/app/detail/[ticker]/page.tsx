import { fetchApi } from "@/lib/api";
import { serverApiBaseUrl } from "@/lib/server/backendPort";
import { transformToTVCandles, transformToTVVolume } from "@/lib/transformers";
import { DetailView, type Technicals } from "./DetailView";

interface PageProps {
  // A Promise in Next.js 16, not a plain object. Typed as the object it used to be, the
  // compiler accepted `params.ticker`, which is undefined at runtime -- so every ticker's page
  // fetched /detail/UNDEFINED and rendered "No data available for UNDEFINED".
  params: Promise<{
    ticker: string;
  }>;
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

export default async function TickerDetailPage({ params }: PageProps) {
  const { ticker: routeTicker } = await params;
  const ticker = decodeURIComponent(routeTicker).toUpperCase();
  const apiBaseUrl = serverApiBaseUrl();

  // Parallel fetching from FastAPI
  const [ohlcv, technicals] = await Promise.all([
    fetchApi<StockOHLCV[]>(`/detail/${ticker}/ohlcv?period=5y`, { baseUrl: apiBaseUrl }).catch(() => []),
    fetchApi<Technicals>(`/detail/${ticker}/technicals?period=5y`, { baseUrl: apiBaseUrl }).catch(() => null),
  ]);

  if (ohlcv.length === 0) {
    return <DetailView ticker={ticker} data={null} technicals={null} />;
  }

  const current = ohlcv[ohlcv.length - 1];
  const previous = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] : current;
  const deltaAbs = current.close - previous.close;
  const deltaPct = (deltaAbs / previous.close) * 100;

  // Transform data explicitly for the TVChart webGL canvas
  const tvCandles = transformToTVCandles(ohlcv);
  const tvVolume = transformToTVVolume(ohlcv);

  return (
    <DetailView
      ticker={ticker}
      data={{ asOf: current.date, close: current.close, deltaPct, candles: tvCandles, volume: tvVolume }}
      technicals={technicals}
    />
  );
}
