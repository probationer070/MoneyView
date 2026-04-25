import { expect, test, type Page } from "@playwright/test";

async function openCorporateValuationTab(page: Page) {
  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Corporate Valuation/i }).click();
  await expect(page.getByLabel("Ticker")).toBeVisible();
}

test("simulation lab keeps heavy runs idle on first load and only looks up price after user blur", async ({ page }) => {
  let priceLookupRequests = 0;
  await page.route("**/api/v1/stock/*/price", async (route) => {
    priceLookupRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: {
          ticker: "AAPL",
          status: "ok",
          price: 211400,
          as_of_date: "2026-04-19",
          source: "cache",
          freshness_status: "fresh_cache",
          retry_after_seconds: null,
          detail_note: "Latest price served from local cache.",
        },
      }),
    });
  });

  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("No analysis run yet").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Path Simulation" })).toBeVisible();

  await page.getByRole("button", { name: /Corporate Valuation/i }).click();
  await expect(page.getByText("No analysis run yet").first()).toBeVisible();
  await expect(page.getByText("Run the valuation engine to generate fair value distribution, undervaluation probability, z-score, and DCF uncertainty summaries.")).toBeVisible();
  await page.waitForTimeout(300);
  expect(priceLookupRequests).toBe(0);

  await page.getByLabel("Ticker").fill("AAPL");
  await page.waitForTimeout(300);
  expect(priceLookupRequests).toBe(0);

  await page.getByLabel("Ticker").press("Tab");
  await expect(page.getByText("AAPL price loaded from cache.")).toBeVisible();
  expect(priceLookupRequests).toBe(1);

  await page.getByRole("button", { name: /Correlation Model/i }).click();
  await expect(page.getByText("No analysis run yet").first()).toBeVisible();
  await expect(page.getByText("Run the portfolio correlation engine to generate efficient frontier, correlation matrix, and sensitivity diagnostics.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Correlation Analysis" })).toBeVisible();
});

test("simulation lab auto-fills current price from cached ticker lookup", async ({ page }) => {
  await page.route("**/api/v1/stock/005930.KS/price", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: {
          ticker: "005930.KS",
          status: "ok",
          price: 71200,
          as_of_date: "2026-04-19",
          source: "cache",
          freshness_status: "fresh_cache",
          retry_after_seconds: null,
          detail_note: "Latest price served from local cache.",
        },
      }),
    });
  });

  await openCorporateValuationTab(page);
  await page.getByLabel("Ticker").fill("005930.KS");
  await page.getByLabel("Ticker").press("Tab");

  await expect(page.getByText("005930.KS price loaded from cache.")).toBeVisible();
  await expect(page.getByLabel("Current stock price")).toHaveValue("71200");
});

test("simulation lab shows fetching state and then fills the price after cache hydration completes", async ({ page }) => {
  let callCount = 0;
  await page.route("**/api/v1/stock/AAPL/price", async (route) => {
    callCount += 1;
    if (callCount === 1) {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          data: {
            ticker: "AAPL",
            status: "fetching",
            price: null,
            as_of_date: null,
            source: "cache_miss",
            freshness_status: "cache_miss",
            retry_after_seconds: 1,
            detail_note: "No cached price was available, so a background fetch has been started.",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: {
          ticker: "AAPL",
          status: "ok",
          price: 211400,
          as_of_date: "2026-04-19",
          source: "cache",
          freshness_status: "fresh_cache",
          retry_after_seconds: null,
          detail_note: "Latest price served from local cache.",
        },
      }),
    });
  });

  await openCorporateValuationTab(page);
  await page.getByLabel("Ticker").fill("AAPL");
  await page.getByLabel("Ticker").press("Tab");

  await expect(page.getByText("No cached price was available, so a background fetch has been started.")).toBeVisible();
  await expect(page.getByLabel("Current stock price")).toHaveValue("50000");
  await expect(page.getByText("AAPL price loaded from cache.")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Current stock price")).toHaveValue("211400");
});

test("simulation lab shows inline not-found feedback for invalid tickers", async ({ page }) => {
  await page.route("**/api/v1/stock/INVALID/price", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: {
          ticker: "INVALID",
          status: "not_found",
          price: null,
          as_of_date: null,
          source: "live_fetch_failed",
          freshness_status: "cache_miss",
          retry_after_seconds: null,
          detail_note: "Live provider fetch failed after all retries for this cold cache miss.",
        },
      }),
    });
  });

  await openCorporateValuationTab(page);
  await page.getByLabel("Ticker").fill("INVALID");
  await page.getByLabel("Ticker").press("Tab");

  await expect(page.getByText("Ticker not found.")).toBeVisible();
  await expect(page.getByLabel("Current stock price")).toHaveValue("50000");
});

test("simulation lab ignores stale lookup responses for an older ticker", async ({ page }) => {
  await page.route("**/api/v1/stock/*/price", async (route) => {
    const url = new URL(route.request().url());
    const ticker = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");

    if (ticker === "OLD") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          data: {
            ticker: "OLD",
            status: "ok",
            price: 12345,
            as_of_date: "2026-04-19",
            source: "cache",
            freshness_status: "fresh_cache",
            retry_after_seconds: null,
            detail_note: "Latest price served from local cache.",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: {
          ticker: "NEW",
          status: "ok",
          price: 67890,
          as_of_date: "2026-04-19",
          source: "cache",
          freshness_status: "fresh_cache",
          retry_after_seconds: null,
          detail_note: "Latest price served from local cache.",
        },
      }),
    });
  });

  await openCorporateValuationTab(page);
  await page.getByLabel("Ticker").fill("OLD");
  await page.getByLabel("Ticker").press("Tab");
  await page.getByLabel("Ticker").fill("NEW");
  await page.getByLabel("Ticker").press("Tab");

  await expect(page.getByText("NEW price loaded from cache.")).toBeVisible();
  await expect(page.getByLabel("Current stock price")).toHaveValue("67890");
  await expect(page.getByLabel("Current stock price")).not.toHaveValue("12345");
});
