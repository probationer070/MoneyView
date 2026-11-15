import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

// D9: the two dates and the benchmark live behind one "Period" trigger at the right end of the tab row.

async function gotoPortfolio(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

const trigger = (page: Page) => page.getByRole("button", { name: /^Period/ });

test("the Period trigger shows only on the Attribution tab and shows the stored dates", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "moneyview.portfolio.dateFilters.v1",
      JSON.stringify({ holdingStartDate: "2026-01-15", attributionAsOfDate: "" }),
    );
  });
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await expect(trigger(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Weights" }).click();
  await expect(trigger(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Attribution" }).click();
  await expect(trigger(page)).toBeVisible();
  await expect(trigger(page)).toContainText("2026-01-15");
  await expect(trigger(page)).toContainText("latest");
  await expect(page.getByLabel("Holding Start Date")).toHaveCount(0);
});

test("the start date in the popover reaches date_from, and the benchmark select reaches benchmark", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await page.getByRole("tab", { name: "Attribution" }).click();

  await trigger(page).click();
  await page.getByLabel("Holding Start Date").fill("2026-02-03");
  await page.getByLabel("Portfolio benchmark preset").selectOption("kospi");
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toContainText("2026-02-03");
  await page.waitForTimeout(600); // the benchmark ticker is debounced 400 ms before it joins the request

  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith("/portfolio/attribution") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  const body = JSON.parse((await requestPromise).postData() ?? "{}");
  expect(body.date_from).toBe("2026-02-03");
  expect(body.benchmark).toBe("^KS11");
});

test("Escape closes the popover and focus returns to the trigger", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await page.getByRole("tab", { name: "Attribution" }).click();

  await trigger(page).click();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("Holding Start Date").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Holding Start Date")).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});
