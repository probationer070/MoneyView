export type BenchmarkPreset = {
  id: string;
  label: string;
  ticker: string;
};

export const PORTFOLIO_BENCHMARK_PRESETS: BenchmarkPreset[] = [
  { id: "sp500", label: "S&P 500", ticker: "^GSPC" },
  { id: "kospi", label: "KOSPI", ticker: "^KS11" },
  { id: "kosdaq", label: "KOSDAQ", ticker: "^KQ11" },
  { id: "semiconductor", label: "KODEX Semiconductor", ticker: "091160.KS" },
  { id: "secondary-battery", label: "KODEX Secondary Battery", ticker: "305720.KS" },
  { id: "bank", label: "KODEX Banks", ticker: "091170.KS" },
  { id: "healthcare", label: "TIGER Healthcare", ticker: "143860.KS" },
];

export const KOREAN_BENCHMARK_PRESETS: BenchmarkPreset[] = [
  { id: "kospi", label: "KOSPI", ticker: "^KS11" },
  { id: "kosdaq", label: "KOSDAQ", ticker: "^KQ11" },
  { id: "semiconductor", label: "KODEX Semiconductor", ticker: "091160.KS" },
  { id: "secondary-battery", label: "KODEX Secondary Battery", ticker: "305720.KS" },
  { id: "bank", label: "KODEX Banks", ticker: "091170.KS" },
  { id: "healthcare", label: "TIGER Healthcare", ticker: "143860.KS" },
];

export const DEFAULT_KOREAN_BENCHMARK_TICKER = KOREAN_BENCHMARK_PRESETS[0].ticker;
export const DEFAULT_PORTFOLIO_BENCHMARK_TICKER = PORTFOLIO_BENCHMARK_PRESETS[0].ticker;

export function benchmarkPresetIdForTicker(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();
  return PORTFOLIO_BENCHMARK_PRESETS.find((preset) => preset.ticker === normalizedTicker)?.id ?? "custom";
}
