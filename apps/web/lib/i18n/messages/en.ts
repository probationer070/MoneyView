export const en = {
  nav: {
    market: "Market Overview", portfolio: "Portfolio", news: "News Feed", corporate: "Corporate Analysis",
    monteCarlo: "Monte Carlo", decisions: "Decision Log", valuation: "Valuation", cases: "Cases", events: "Events",
  },
  common: {
    loading: "Loading…", retry: "Retry", unavailable: "Could not be loaded.",
    updatedAgo: "Updated {minutes} min ago", language: "Language",
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
