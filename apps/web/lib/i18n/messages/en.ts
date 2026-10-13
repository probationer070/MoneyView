export const en = {
  nav: {
    market: "Market Overview", portfolio: "Portfolio", news: "News Feed", corporate: "Corporate Analysis",
    monteCarlo: "Monte Carlo", decisions: "Decision Log", valuation: "Valuation", cases: "Cases", events: "Events",
  },
  navShort: {
    market: "Market", portfolio: "Portfolio", news: "News", corporate: "Corporate", monteCarlo: "Monte Carlo",
    decisions: "Decisions", valuation: "Valuation", cases: "Cases", events: "Events",
  },
  topnav: { primary: "Primary", full: "All pages", menu: "Menu", poweredBy: "Powered by FastAPI & Next.js" },
  common: {
    loading: "Loading…", retry: "Retry", unavailable: "Could not be loaded.",
    updatedAgo: "Updated {minutes} min ago", language: "Language",
    errorTitle: "Something went wrong", tryAgain: "Try again", noData: "No data available", noDataHint: "Run an analysis or refresh the data to see results here.", renderFailureTitle: "Component Render Failure", renderFailureBody: "An unexpected error broke the layout context for this graphic. Logs have been traced locally.", exportDisabled: "Export Disabled", exportJson: "Export JSON", exportCsv: "Export CSV", exportMarkdown: "Export Markdown", printPdf: "Print PDF", tickerPlaceholder: "Ticker or company name", other: "Other", chartUnavailable: "Chart unavailable",
  },
  delta: { up: "Up", down: "Down", flat: "Unchanged" },
  portfolio: { title: "Portfolio" },
  corporate: {
    verdict: {
      detail: "Verdict detail", intrinsic: "Intrinsic value", vs: "vs", current: "Current price",
      idle: "DCF not calculated · use Refresh DCF above", streaming: "Calculating…",
      refused: "Not valued: {reason}", ev: "EV {value}",
    },
    kpi: {
      spread: "ROIC - WACC", ke: "Bottom-up Ke", wacc: "WACC", beta: "Levered Beta",
      spreadUp: "Value creation", spreadDown: "Value destruction",
      keCaption: "rf + beta x implied ERP + CRP", waccCaption: "Discount rate in the DCF", betaCaption: "Hamada adjusted",
    },
    assumptions: {
      detail: "Assumptions detail", menu: "Assumption options", edit: "Edit {label}", info: "{label} detail", actions: "Actions",
      refreshSource: "Refresh source data", roicBasis: "ROIC Basis", roicYear: "ROIC Year",
      basisRecent: "Recent multi-year average", basisAll: "All available years average", basisAnnual: "Select annual value",
      yearUnavailable: "Unavailable", growthBasis: "Growth Basis",
      growthDefault: "Growth Rate now stays on the stable CAGR path. Annual growth rates remain available in View Details for context.",
      updated: "Last updated {time}", notLoaded: "Not loaded yet",
      sourceIdle: "Source data stays idle on first load until refreshed.",
      staleSource: "Cached source data is for {cached}. Refresh for {ticker}.",
      fixed: "Fixed",
    },
    assumption: {
      growth: "Growth Rate", roic: "ROIC", wacc: "WACC", debtRatio: "Debt Ratio", unleveredBeta: "Unlevered Beta",
      crp: "Country Risk Premium", reinvestment: "Reinvestment Rate", innovation: "Innovation Index",
      governance: "Governance Quality", esgPenalty: "ESG / Agency Penalty",
    },
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
