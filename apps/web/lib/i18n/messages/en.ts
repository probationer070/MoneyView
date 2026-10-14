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
    title: "Corporate Analysis",
    search: { label: "Company Search", placeholder: "Type a company name", notListed: "Not in the list → add" },
    add: { name: "Company name", symbol: "Symbol", submit: "Add for Analysis", cancel: "Cancel", failed: "Could not add {ticker}." },
    header: { refreshDcf: "Refresh DCF", notCalculated: "Not calculated yet" },
    verdict: {
      detail: "Verdict detail", intrinsic: "Intrinsic value", vs: "vs", current: "Current price",
      idle: "DCF not calculated · use Refresh DCF above", streaming: "Calculating…",
      refused: "Not valued: {reason}", ev: "EV {value}",
    },
    verdictStrip: { idle: "DCF not calculated", refused: "Not valued", staleSource: "Stale source" },
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
    tabs: {
      aria: "Corporate analysis sections", summary: "Summary", diagnostics: "Core Diagnostics", dcf: "DCF", comparison: "Target Stock Comparison",
      about: "About this tab",
      diagnosticsAbout: "Hurdle Rate Decomposition, Bottom-up Beta + WACC U-Curve and the 4-Quadrant Value Driver Matrix. Tap any chart title or bar to open its detailed formula view.",
      dcfAbout: "Left: the four DCF core values. Right: the WACC x terminal growth grid from the full DCF report. The projection rows and CSV exports stay in the calculation detail, Raw data tab.",
    },
    dcfTab: {
      loadReport: "Load Full Report", loading: "Loading full DCF report...", unavailable: "Full DCF Report Unavailable",
      empty: "The grid appears after the full report loads.",
    },
    comparison: {
      universe: "Universe", universeAria: "Comparison universe", benchmarkLabel: "Benchmark", benchmarkAria: "Comparison benchmark",
      customLabel: "Custom tickers", customAria: "Custom tickers", sortLabel: "Sort by", sortAria: "Sort by",
      directionLabel: "Direction", directionAria: "Direction",
      sortImplied: "Implied return vs WACC", sortSpread: "ROIC - WACC", sortDcf: "DCF value", desc: "High to low", asc: "Low to high",
      universeLabel: { portfolio_plus_benchmark: "Portfolio + Benchmark", watchlist_plus_benchmark: "Watchlist + Benchmark", custom: "Custom Universe" },
      refresh: "Refresh comparison", calculateAll: "Calculate All DCF Reports", calculatingAll: "Calculating all DCF reports...",
      verifySync: "Verify Watchlist Sync", verifying: "Verifying the watchlist…",
      synced: "Watchlist {n}/{m} synced", missing: "Missing from Corporate Analysis: {tickers}.",
      benchmark: "Benchmark: {ticker}.", preset: "Selected benchmark preset: {label} ({ticker}).",
      custom: "Custom tickers: {tickers}.", none: "None", notCalculated: "Not calculated yet", stale: "Stale",
      openPortfolio: "Open Portfolio Testing", loading: "Loading comparison rows...",
      errorTitle: "Target Stock Comparison Unavailable", errorBody: "Target stock comparison is currently unavailable.",
      idleTitle: "Comparison stays idle on first load.", idleBody: "Choose the universe, then click Refresh comparison.",
      about: "Lightweight watchlist comparison for tracked names and ad-hoc custom universes. Live watchlist comparison: this tab stays in live mode. Market expected return = risk-free rate {riskFree} + equity risk premium {erp} = {marketReturn}. Stock return method: {stockMethod}. Reference method: {referenceMethod}. Generated live at {generatedAt}. Corporate Analysis checks the live Watchlist Holdings feed against the company registry on each refresh, so mismatches show before you compare names. Weighted portfolio testing, implied cash, snapshots and saved history live on the Portfolio page. Portfolio snapshots and saved history are managed from the Portfolio page only.",
    },
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
