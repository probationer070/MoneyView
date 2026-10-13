export const en = {
  nav: {
    market: "Market Overview", portfolio: "Portfolio", news: "News Feed", corporate: "Corporate Analysis",
    monteCarlo: "Monte Carlo", decisions: "Decision Log", valuation: "Valuation", cases: "Cases", events: "Events",
  },
  common: {
    loading: "Loading…", retry: "Retry", unavailable: "Could not be loaded.",
    updatedAgo: "Updated {minutes} min ago", language: "Language",
    errorTitle: "Something went wrong", tryAgain: "Try again", noData: "No data available", noDataHint: "Run an analysis or refresh the data to see results here.", renderFailureTitle: "Component Render Failure", renderFailureBody: "An unexpected error broke the layout context for this graphic. Logs have been traced locally.", exportDisabled: "Export Disabled", exportJson: "Export JSON", exportCsv: "Export CSV", exportMarkdown: "Export Markdown", printPdf: "Print PDF", tickerPlaceholder: "Ticker or company name", other: "Other", chartUnavailable: "Chart unavailable",
  },
  delta: { up: "Up", down: "Down", flat: "Unchanged" },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
