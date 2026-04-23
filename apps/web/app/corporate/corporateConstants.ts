import type { CorporateAssumptions, CorporateCompany, WatchlistHolding } from "./corporateTypes";

export const COMPANIES: CorporateCompany[] = [
  { ticker: "AAPL", name: "Apple", preset: { growth: 6, roic: 18, wacc: 10, debtRatio: 18, unleveredBeta: 1.05 } },
  { ticker: "MSFT", name: "Microsoft", preset: { growth: 7, roic: 22, wacc: 9, debtRatio: 15, unleveredBeta: 0.95 } },
  { ticker: "NVDA", name: "Nvidia", preset: { growth: 16, roic: 32, wacc: 12, debtRatio: 10, unleveredBeta: 1.55 } },
  { ticker: "TSLA", name: "Tesla", preset: { growth: 12, roic: 13, wacc: 13, debtRatio: 22, unleveredBeta: 1.7 } },
  { ticker: "AMZN", name: "Amazon", preset: { growth: 9, roic: 12, wacc: 10.5, debtRatio: 24, unleveredBeta: 1.15 } },
  { ticker: "GOOGL", name: "Alphabet", preset: { growth: 8, roic: 20, wacc: 9.5, debtRatio: 8, unleveredBeta: 1.0 } },
  { ticker: "META", name: "Meta Platforms", preset: { growth: 10, roic: 24, wacc: 10.25, debtRatio: 12, unleveredBeta: 1.2 } },
  { ticker: "NFLX", name: "Netflix", preset: { growth: 8, roic: 16, wacc: 11, debtRatio: 26, unleveredBeta: 1.25 } },
  { ticker: "AMD", name: "AMD", preset: { growth: 11, roic: 11, wacc: 12, debtRatio: 18, unleveredBeta: 1.45 } },
  { ticker: "AVGO", name: "Broadcom", preset: { growth: 8, roic: 21, wacc: 10.75, debtRatio: 35, unleveredBeta: 1.1 } },
  { ticker: "JPM", name: "JPMorgan Chase", preset: { growth: 4, roic: 10, wacc: 8.75, debtRatio: 42, unleveredBeta: 0.9 } },
  { ticker: "V", name: "Visa", preset: { growth: 7, roic: 28, wacc: 8.5, debtRatio: 16, unleveredBeta: 0.85 } },
  { ticker: "UNH", name: "UnitedHealth", preset: { growth: 6, roic: 15, wacc: 8.75, debtRatio: 28, unleveredBeta: 0.8 } },
  { ticker: "XOM", name: "Exxon Mobil", preset: { growth: 3, roic: 12, wacc: 9.25, debtRatio: 20, unleveredBeta: 0.95 } },
  { ticker: "LEU", name: "Centrus Energy", preset: { growth: 14, roic: 14, wacc: 14, debtRatio: 30, unleveredBeta: 1.8 } },
];

export const EMPTY_WATCHLIST_HOLDINGS: WatchlistHolding[] = [];
export const TAX_RATE = 0.25;
export const RISK_FREE_RATE = 4.2;
export const KOREA_COUNTRY_RISK_PREMIUM = 0.8;
export const IMPLIED_ERP_FALLBACK_INDEX_LEVEL = 100;
export const IMPLIED_ERP_DIVIDEND_YIELD = 1.4;
export const IMPLIED_ERP_BUYBACK_YIELD = 2.3;
export const IMPLIED_ERP_FIVE_YEAR_GROWTH = [7.0, 6.0, 5.0, 4.5, 4.2];

export const initialAssumptions: CorporateAssumptions = {
  ticker: "AAPL",
  growth: 6,
  roic: 18,
  wacc: 10,
  debtRatio: 18,
  unleveredBeta: 1.05,
  crp: 1.1,
  reinvestment: 34,
  fcff: 92,
  innovation: 82,
  marketShare: 64,
  governance: 74,
  esgPenalty: 22,
};

export const STORAGE_KEY = "moneyview:corporate-assumptions:v2";
export const ACTIVE_TICKER_SESSION_KEY = "moneyview:corporate-active-ticker:v1";
export const DCF_CACHE_KEY = "moneyview:corporate-dcf-cache:v1";
export const COMPARISON_CACHE_KEY = "moneyview:corporate-comparison-cache:v1";
export const METRIC_HISTORY_CACHE_KEY = "moneyview:corporate-metric-history-cache:v1";
export const QUARTERLY_STATEMENTS_CACHE_KEY = "moneyview:corporate-quarterly-statements-cache:v1";
export const PRICE_HISTORY_CACHE_KEY = "moneyview:corporate-price-history-cache:v1";
