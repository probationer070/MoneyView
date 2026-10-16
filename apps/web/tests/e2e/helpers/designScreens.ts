import type { Page } from "@playwright/test";
import { mockCasesApi } from "./casesApiMock";
import { mockCorporatePageApi } from "./corporatePageMock";
import { mockDecisionsApi } from "./decisionsPageMock";
import { mockEventsApi } from "./eventsApiMock";
import { mockMarketPageApi } from "./marketPageMock";
import { mockPortfolioPageApi } from "./portfolioPageMock";
import { mockSignalsApi } from "./signalsApiMock";
import { mockValuationApi } from "./valuationPageMock";

/** Screens captured for visual review (design-capture) and swept for token colours (Task 14). */
export const DESIGN_SCREENS: [string, (page: Page) => Promise<unknown>][] = [
  ["/", (p) => mockMarketPageApi(p)],
  ["/portfolio", (p) => mockPortfolioPageApi(p)],
  ["/corporate", (p) => mockCorporatePageApi(p)],
  ["/valuation", (p) => mockValuationApi(p)],
  ["/decisions", (p) => mockDecisionsApi(p)],
  ["/cases", (p) => mockCasesApi(p)],
  ["/events", async (p) => { await mockMarketPageApi(p); await mockEventsApi(p); }],
  ["/signals", (p) => mockSignalsApi(p)],
  ["/dev/design", async () => {}],
];

export const screenName = (route: string) => (route === "/" ? "market" : route.slice(1).replaceAll("/", "-"));
