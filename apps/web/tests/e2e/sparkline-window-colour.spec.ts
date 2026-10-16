import { expect, test } from "@playwright/test";
import { portfolioPartialWeightsFixture } from "./fixtures/shared";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { cloneFixture } from "./helpers/mockUtils";
import { windowTone } from "../../lib/sparklineTone";

// A multi-day path is coloured by its own first-to-last direction. The day's delta colours only
// the day figures (DeltaBadge). Mutation for the page test: give the tile's path a colour from
// the day's delta (the old `color={deltaPct >= 0 ...}` pattern, here `var(--down)` for a day that
// fell), or restore the chart-1 stroke; the test fails on either.

test("a window that rose stays --up on a day that fell", async ({ page }) => {
  // AAPL is -0.6% on the day and its window rose from 95 to 100.
  const watchlist = cloneFixture(portfolioPartialWeightsFixture).map((row) =>
    row.ticker === "AAPL" ? { ...row, delta: { delta_pct: -0.6 }, sparkline: [95, 97, 99, 100] } : row,
  );
  await mockPortfolioPageApi(page, undefined, { watchlist });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  const tile = page.getByTestId("stock-tile-AAPL");
  await expect(tile).toBeVisible({ timeout: 60_000 });
  await expect(tile.getByTestId("delta-badge")).toHaveAttribute("data-dir", "down");
  await expect(tile.locator("svg path")).toHaveAttribute("stroke", "var(--up)");
});

test("windowTone reads the first and last points only", () => {
  expect(windowTone([95, 97, 99, 100])).toBe("up");
  expect(windowTone([100, 96, 94, 99])).toBe("down");
  expect(windowTone([100, 90, 120, 100])).toBe("up");
  expect(windowTone([5, 5])).toBe("up");
});
