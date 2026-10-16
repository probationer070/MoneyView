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

test.describe("the news page in Korean", () => {
  test.use({ locale: "ko-KR" });

  test("the title and the load-more control render in Korean", async ({ page }) => {
    // Five articles fill one page, so the feed reports a next page and offers the load-more control.
    const articles = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      ticker: null,
      headline: `Headline ${index + 1}`,
      url: `https://example.com/news/${index + 1}`,
      source: "Example",
      published_date: "2026-05-01",
      sentiment: "neutral",
      importance: 1,
    }));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `${API_PREFIX}/news/feed` && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(articles) });
      }
      return route.continue();
    });

    await page.goto("/news", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "시장 인텔리전스", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "기사 더 보기", exact: true })).toBeVisible();
  });
});
