import { useQuery } from "@tanstack/react-query";
import { casesApi, retryUnlessRefused } from "@/app/cases/casesApi";

/** POST /valuation/fair-value/{ticker} (spec 2026-10-26-damodaran-fair-value-design §5). */
export interface FairValueSummary {
  ticker: string;
  case_id: number;
  created: boolean;
  vintage: string;
  value_per_share: number | null;
  price: number | null;
  price_date: string | null;
  /** (value − price) / price × 100. */
  gap_pct: number | null;
  /** The conservative case's value per share: the floor. */
  floor_value_per_share: number | null;
  /** Fractions. The model's year 1-5 revenue growth, and the one today's price implies. */
  growth_1_5: number;
  implied_growth_1_5: number | null;
  /** "above_range: …" or "below_range: …" when no growth in the searched band reaches the price. */
  implied_growth_note: string | null;
  assumptions: { field: string; value: number | null; claim: string }[];
}

/** The ticker's Damodaran-style fair value; a 4xx is a refusal (CaseApiError.detail), not a failure. */
export function useFairValue(ticker: string | null) {
  return useQuery<FairValueSummary>({
    queryKey: ["fair-value", ticker],
    enabled: Boolean(ticker),
    queryFn: () => casesApi.fairValue(ticker as string),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });
}
