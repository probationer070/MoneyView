import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { UNCATEGORIZED, mockEventsApi } from "./helpers/eventsApiMock";

// Each events table header carries its Korean term beside the English (M7). The English half
// is what the test name matches; the Korean half is in the DOM in every locale, aria-hidden in
// English, so a header that reverts to a plain English string loses the Korean text.
test("the events table headers carry their Korean terms", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await mockEventsApi(page, { events: [], categories: [UNCATEGORIZED] });
  await page.goto("/events", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("events-table")).toBeVisible({ timeout: 60_000 });

  await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toContainText("날짜");
  await expect(page.getByRole("columnheader", { name: "Event", exact: true })).toContainText("이벤트");
  await expect(page.getByRole("columnheader", { name: "Category", exact: true })).toContainText("카테고리");
  await expect(page.getByRole("columnheader", { name: "Origin", exact: true })).toContainText("구분");
});
