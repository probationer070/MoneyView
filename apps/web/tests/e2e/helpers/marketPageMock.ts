import type { Page } from "@playwright/test";
import { marketIndexDetailFixture, marketOverviewFixture } from "../fixtures/shared";
import { API_PREFIX, cloneFixture, json } from "./mockUtils";

export async function mockMarketPageApi(
  page: Page,
  options?: {
    detailOverrides?: Partial<Record<keyof typeof marketIndexDetailFixture, unknown>>;
    failOverview?: boolean;
    failDetailTickers?: string[];
  },
) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === `${API_PREFIX}/health`) {
      return json(route, { status: "ok", version: "1.0.0" });
    }

    if (pathname === `${API_PREFIX}/market/indices` && method === "GET") {
      if (options?.failOverview) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Mock market overview failure" }),
        });
      }
      return json(route, cloneFixture(marketOverviewFixture));
    }

    const detailMatch = pathname.match(/^\/api\/v1\/market\/index\/(.+)\/detail$/);
    if (detailMatch && method === "GET") {
      const ticker = decodeURIComponent(detailMatch[1]);
      if (options?.failDetailTickers?.includes(ticker)) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: `Mock market detail failure for ${ticker}` }),
        });
      }
      const detail = marketIndexDetailFixture[ticker as keyof typeof marketIndexDetailFixture];
      if (detail) {
        const override = options?.detailOverrides?.[ticker as keyof typeof marketIndexDetailFixture] as Record<string, unknown> | undefined;
        const merged = override ? { ...cloneFixture(detail), ...override } : cloneFixture(detail);
        return json(route, merged);
      }
    }

    return route.continue();
  });
}
