import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

// The four findings the Task 11 ledger deferred to the whole-branch review that are
// about what the panels look like once content moved into a 480px slide-over.

const RAIL_SNAPSHOT = "Latest snapshot summary";
const RAIL_ALLOCATION = "Allocation workspace";
const RAIL_HOLDINGS = "Holdings table";

function rail(page: Page) {
  return page.getByTestId("portfolio-rail");
}

function panel(page: Page) {
  return page.getByTestId("portfolio-side-panel");
}

async function gotoGrid(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("a panel with nothing to show says so rather than opening blank", async ({ page }) => {
  // snapshotPanelBody is `<>{hasHoldings && (...)}</>`, so with no holdings the panel
  // opens as a titled slide-over over an empty content area with no explanation.
  await mockPortfolioPageApi(page, undefined, { watchlist: [] });
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_SNAPSHOT }).click();
  await expect(panel(page)).toBeVisible();

  await expect(panel(page).getByTestId("panel-empty-state")).toBeVisible();
});

test("a panel names itself once, not twice", async ({ page }) => {
  // SidePanel renders the title as its own <h2>; a body that repeats its title puts the
  // same words on screen twice in a column 480px wide.
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  for (const [railLabel, title] of [
    [RAIL_ALLOCATION, "Portfolio Allocation Workspace"],
    [RAIL_HOLDINGS, "Watchlist Holdings"],
  ] as const) {
    await rail(page).getByRole("button", { name: railLabel }).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading", { name: title })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  }
});

test("stacked sections in a panel keep a visible gap between them", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_HOLDINGS }).click();
  await expect(panel(page)).toBeVisible();

  // Geometry, not a class name: the finding was that sections butt together with no
  // rhythm, and the gap is the thing that has to be true however it is produced.
  const sections = panel(page).locator("> div > section");
  await expect(sections.nth(1)).toBeVisible();
  const first = await sections.nth(0).boundingBox();
  const second = await sections.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  const gap = second!.y - (first!.y + first!.height);
  expect(gap).toBeGreaterThan(8);
});

test("panel copy does not describe a layout the panel does not have", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_ALLOCATION }).click();
  await expect(panel(page)).toBeVisible();

  // Written when this was a full-width section with side-by-side columns. In a 480px
  // slide-over there is no left, no right, and nothing below.
  const body = panel(page).locator("> div").last();
  await expect(body).not.toContainText("on the left");
  await expect(body).not.toContainText("on the right");
  await expect(body).not.toContainText("summaries below");
});
