import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { API_PREFIX, json } from "./helpers/mockUtils";

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBeTruthy();
}

async function mockNewsPageApi(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === `${API_PREFIX}/health`) {
      return json(route, { status: "ok", version: "1.0.0" });
    }

    if (pathname === `${API_PREFIX}/news/feed` && method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const pageSize = Number(url.searchParams.get("limit") ?? "5");
      const rows = Array.from({ length: pageSize }, (_, index) => ({
        id: offset + index + 1,
        ticker: index % 2 === 0 ? "AAPL" : null,
        headline: `Mock market headline ${offset + index + 1}`,
        url: `https://example.com/news/${offset + index + 1}`,
        source: "Mock Newswire",
        published_date: "2026-04-11",
        sentiment: "neutral",
        importance: 1,
      }));
      return json(route, rows);
    }

    return route.continue();
  });
}

test("market overview and news remain usable at 1280px, 768px, and 375px", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Graph" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Table" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open detail for S&P 500" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("columnheader", { name: "Instrument" })).toBeVisible();

  await mockNewsPageApi(page);
  await page.goto("/news", { waitUntil: "domcontentloaded" });

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Market Intelligence", exact: true })).toBeVisible();
    await expect(page.getByRole("feed", { name: "News feed scroll region" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more articles" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open article: Mock market headline 1/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("corporate and simulation lab remain usable on narrower widths", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Core Diagnostics")).toBeVisible();
  await page.getByText("DCF Core Modules").first().scrollIntoViewIfNeeded();
  await expect(page.getByText("DCF Core Modules").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText("Hurdle Rate Decomposition").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Simulation Lab", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Simulation workflows" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Path Simulation/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await expect(page.getByLabel("Initial investment")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("modal focus, keyboard navigation, and aria hooks stay intact", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const trigger = page.getByRole("button", { name: "Open detail for S&P 500" });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "S&P 500" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close modal" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "View Full Detail" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tablist", { name: "Simulation workflows" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Path Simulation/i })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
  await expect(page.getByRole("tab", { name: /Corporate Valuation/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "simulation-tab-valuation");

  await mockNewsPageApi(page);
  await page.goto("/news", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("feed", { name: "News feed scroll region" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more articles" })).toBeVisible();
});
