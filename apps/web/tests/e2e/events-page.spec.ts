import { expect, test, type Page } from "@playwright/test";
import { stableInkProfile } from "./helpers/chartInk";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { FOMC_CATEGORY, UNCATEGORIZED, mockEventsApi, setAllEventCategories, type MockCategory, type MockEvent } from "./helpers/eventsApiMock";
import { addedColumns } from "./helpers/lineColor";

const MINE: MockCategory = { id: "user-my-trades", label: "My trades", color: "#4589E5", visible: true, origin: "user", overridden: false };
const EMPTY: MockCategory = { id: "user-empty", label: "Empty", color: "#123456", visible: true, origin: "user", overridden: false };

const FOMC_EVENT: MockEvent = {
  id: "fomc-2026-06-17", label: "FOMC: hold at 3.50–3.75%", category: "fomc", start_date: "2026-06-17",
  source: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm",
};
const MY_EVENT: MockEvent = { id: "user-1", label: "Bought AI basket", category: "user-my-trades", start_date: "2026-06-15", origin: "user" };

async function openEventsPage(page: Page, events: MockEvent[], categories: MockCategory[]) {
  await mockMarketPageApi(page);
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{
        id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC", requested_window_days: 90,
        actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
        basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
        series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }], latest: 103.4, refused_reason: null,
      }]),
    }),
  );
  const state = await mockEventsApi(page, { events, categories });
  await page.goto("/events", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("events-table")).toBeVisible({ timeout: 60_000 });
  return state;
}

test("the sidebar links to the events page", async ({ page }) => {
  await openEventsPage(page, [], [UNCATEGORIZED]);
  await expect(page.locator("#app-sidebar").getByRole("link", { name: "Events" })).toHaveAttribute("href", "/events");
});

test("built-in rows are read-only, and a user's own event can be edited and deleted", async ({ page }) => {
  await openEventsPage(page, [FOMC_EVENT, MY_EVENT], [FOMC_CATEGORY, MINE, UNCATEGORIZED]);

  const builtin = page.getByTestId("event-row-fomc-2026-06-17");
  await expect(builtin).toContainText("from a data file");
  await expect(builtin.getByRole("button")).toHaveCount(0);
  await expect(builtin.getByRole("link", { name: "www.federalreserve.gov" })).toHaveAttribute("href", FOMC_EVENT.source!);

  await page.getByTestId("event-edit-user-1").click();
  await page.getByTestId("event-form").getByLabel("Label").fill("Sold AI basket");
  await page.getByTestId("event-form").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("event-row-user-1")).toContainText("Sold AI basket");

  await page.getByTestId("event-delete-user-1").click();
  await page.getByTestId("event-delete-confirm-user-1").click();
  await expect(page.getByTestId("event-row-user-1")).toHaveCount(0);
});

test("an added event is listed and then drawn on a chart", async ({ page }) => {
  await openEventsPage(page, [], [MINE, UNCATEGORIZED]);

  const form = page.getByTestId("event-form");
  await form.getByLabel("Date", { exact: true }).fill("2026-06-15");
  await form.getByLabel("Label").fill("Bought AI basket");
  await form.getByLabel("Category").selectOption("user-my-trades");
  await form.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByTestId("events-table")).toContainText("Bought AI basket");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const chart = '[data-testid="spread-chart-ai"]';
  await expect(page.locator(chart)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("spreads-events-filter")).toHaveText(/Events · 2 of 2/);
  const withLine = await stableInkProfile(page, chart);
  await setAllEventCategories(page, "spreads-events-filter", false);
  const without = await stableInkProfile(page, chart);
  expect(addedColumns(withLine, without).length, "the added event draws no line").toBeGreaterThan(0);
});

test("a refusal from the server is shown on the form", async ({ page }) => {
  await openEventsPage(page, [], [MINE, UNCATEGORIZED]);

  const form = page.getByTestId("event-form");
  await form.getByLabel("Date", { exact: true }).fill("2026-06-15");
  await form.getByLabel("End date").fill("2026-06-01");
  await form.getByLabel("Label").fill("Backwards");
  await form.getByRole("button", { name: "Add event" }).click();

  await expect(page.getByTestId("event-form-error")).toContainText("before it starts");
});

test("a built-in category offers Reset only once changed, and Reset restores its colour", async ({ page }) => {
  await openEventsPage(page, [], [FOMC_CATEGORY, UNCATEGORIZED]);

  await expect(page.getByTestId("category-reset-fomc")).toHaveCount(0);
  await page.getByTestId("category-color-fomc").fill("#0000ff");
  await page.getByTestId("category-save-fomc").click();
  await expect(page.getByTestId("category-reset-fomc")).toBeVisible();

  await page.getByTestId("category-reset-fomc").click();
  await expect(page.getByTestId("category-color-fomc")).toHaveValue("#e54545");
  await expect(page.getByTestId("category-reset-fomc")).toHaveCount(0);
});

test("a user category in use cannot be deleted, and an unused one can", async ({ page }) => {
  await openEventsPage(page, [MY_EVENT], [FOMC_CATEGORY, MINE, EMPTY, UNCATEGORIZED]);

  await expect(page.getByTestId("category-row-fomc")).toBeVisible();
  await expect(page.getByTestId("category-delete-user-my-trades")).toBeDisabled();
  await expect(page.getByTestId("category-delete-user-my-trades")).toContainText("used by 1");
  await expect(page.getByTestId("category-delete-fomc"), "built-ins have no delete").toHaveCount(0);

  await page.getByTestId("category-delete-user-empty").click();
  await expect(page.getByTestId("category-row-user-empty")).toHaveCount(0);
});

test("a new category can be added and used", async ({ page }) => {
  await openEventsPage(page, [], [UNCATEGORIZED]);

  await page.getByTestId("category-add-label").fill("Earnings");
  await page.getByTestId("category-add-color").fill("#00aa55");
  await page.getByTestId("category-add").click();

  await expect(page.getByTestId("category-row-user-earnings")).toBeVisible();
  await expect(page.getByTestId("event-form").getByLabel("Category").locator("option", { hasText: "Earnings" })).toHaveCount(1);
});

test("a user event whose category was removed is flagged for a new one", async ({ page }) => {
  await openEventsPage(page, [{ ...MY_EVENT, category: "uncategorized", missing_category: "quad-witching" }], [UNCATEGORIZED]);

  await expect(page.getByTestId("event-missing-category-user-1")).toContainText("category removed");
  await page.getByLabel("Filter by origin").selectOption("needs-category");
  await expect(page.getByTestId("event-row-user-1")).toBeVisible();
});
