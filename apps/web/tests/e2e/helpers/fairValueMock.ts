import type { FairValueSummary } from "../../../lib/fairValue";

/** A fair value below the price: 145.50 against 347.70 is −58.2%; the price implies 20.2% growth, the model 4.3%. */
export function fairValueFixture(ticker = "AAPL"): FairValueSummary {
  return {
    ticker, case_id: 41, created: false, vintage: "2026-01-01",
    value_per_share: 145.5, price: 347.7, price_date: "2026-10-23", gap_pct: -58.15,
    floor_value_per_share: 91.5, growth_1_5: 0.043, implied_growth_1_5: 0.202, implied_growth_note: null,
    assumptions: [
      { field: "wacc_stable", value: 0.0971, claim: "Computers/Peripherals (36 firms, vintage 2026-01-01) cost of capital 0.0971, reached from year 6." },
      { field: "margin_target", value: 0.32, claim: "The company's 0.3200 held: at or above Computers/Peripherals operating margin 0.2248." },
    ],
  };
}
