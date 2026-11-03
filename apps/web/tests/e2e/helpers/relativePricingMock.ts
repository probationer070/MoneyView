import type { RelativePricing } from "../../../lib/relativePricing";

/** A non-financial company: EV/Sales and P/E, the industry's averages applied to its figures (spec §12). */
export function relativePricingFixture(ticker = "AAPL"): RelativePricing {
  return {
    ticker, vintage: "2026-01-01", industry: "Computers/Peripherals", industry_firms: 42, financial: false,
    price: 205.8, price_date: "2026-10-23",
    rows: [
      { basis: "ev_sales", industry_multiple: 7.5, company_figure: 391, value_per_share: 180.25, gap_pct: -12.4, refusal: null },
      { basis: "trailing_pe", industry_multiple: 28.1, company_figure: 6.08, value_per_share: 170.85, gap_pct: -17.0, refusal: null },
    ],
    range: { low: 170.85, mid: 175.55, high: 180.25 },
  };
}
