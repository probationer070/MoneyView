import { expect, test } from "@playwright/test";
import { API_PREFIX } from "./helpers/mockUtils";

test("news page shows an explicit error state when the feed request fails", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === `${API_PREFIX}/health`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", version: "1.0.0" }),
      });
    }

    if (pathname === `${API_PREFIX}/news/feed` && method === "GET") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Mock market news failure" }),
      });
    }

    return route.continue();
  });

  await page.goto("/news", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Market Intelligence", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("News Feed Unavailable")).toBeVisible();
  await expect(page.getByText(/Could not load market news|Mock market news failure|500/i)).toBeVisible();
});
