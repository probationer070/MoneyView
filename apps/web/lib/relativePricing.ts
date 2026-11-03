import { useQuery } from "@tanstack/react-query";
import { casesApi, retryUnlessRefused } from "@/app/cases/casesApi";

/** One multiple's row: the industry's average multiple applied to the company's own figure. */
export interface RelativePricingRow {
  basis: "ev_sales" | "trailing_pe" | "price_to_book";
  industry_multiple: number | null;
  company_figure: number | null;
  value_per_share: number | null;
  /** (value − price) / price × 100. */
  gap_pct: number | null;
  /** "<code>: <sentence>" when this multiple gives no value; the code is mapped for display. */
  refusal: string | null;
}

/** GET /valuation/relative-pricing/{ticker} (spec 2026-11-01 fair-value refusal plan §12). A 4xx is a refusal. */
export interface RelativePricing {
  ticker: string;
  vintage: string;
  industry: string;
  industry_firms: number;
  financial: boolean;
  price: number | null;
  price_date: string | null;
  rows: RelativePricingRow[];
  range: { low: number; mid: number; high: number } | null;
}

/** The ticker's industry-average relative pricing; a 4xx is a refusal (CaseApiError.detail), not a failure. */
export function useRelativePricing(ticker: string | null) {
  return useQuery<RelativePricing>({
    queryKey: ["relative-pricing", ticker],
    enabled: Boolean(ticker),
    queryFn: () => casesApi.relativePricing(ticker as string),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });
}
