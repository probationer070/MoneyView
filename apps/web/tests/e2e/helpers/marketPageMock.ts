import type { Page } from "@playwright/test";
import { marketOverviewFixture } from "../fixtures/shared";
import { API_PREFIX, cloneFixture, json } from "./mockUtils";

export async function mockMarketPageApi(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === `${API_PREFIX}/health`) {
      return json(route, { status: "ok", version: "1.0.0" });
    }

    if (pathname === `${API_PREFIX}/market/indices` && method === "GET") {
      return json(route, cloneFixture(marketOverviewFixture));
    }

    return route.continue();
  });
}
