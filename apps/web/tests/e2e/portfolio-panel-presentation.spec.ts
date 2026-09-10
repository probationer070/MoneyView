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

// The panels opened at one shared `max-w-[480px]`, but two of the four bodies declare a
// `min-w-[1120px]` table (PortfolioAllocationEditor.tsx:145, page.tsx:468). Those two
// scrolled horizontally and hid their own controls: weight inputs, save state and sliders
// sat off-screen, so the panel could be open and still not usable. Width is now chosen per
// panel. These assert geometry rather than class names -- the class is how it is done
// today, the rendered size is what has to be true.

const TABLE_PANEL_MIN_WIDTH = 900;
const CONTROL_MIN_HIT_HEIGHT = 32;

test("a panel holding a wide table opens wide enough to use it", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  for (const railLabel of [RAIL_ALLOCATION, RAIL_HOLDINGS]) {
    await rail(page).getByRole("button", { name: railLabel }).click();
    await expect(panel(page)).toBeVisible();

    const box = await panel(page).boundingBox();
    expect(box, `${railLabel} panel should be laid out`).not.toBeNull();
    expect(
      box!.width,
      `${railLabel} opened ${box!.width}px wide; a 1120px table needs far more than the old 480px`,
    ).toBeGreaterThan(TABLE_PANEL_MIN_WIDTH);

    await rail(page).getByRole("button", { name: railLabel }).click();
    await expect(panel(page)).toHaveCount(0);
  }
});

test("a wide panel stays inside the box it is positioned in", async ({ page }) => {
  // The widest tier is 74rem. The app shell centres a shrink-to-fit root, so this panel's
  // containing block is often much narrower than the viewport -- 552px at a 1024px
  // viewport. Because the panel is `right-0`, anything wider than its parent grows
  // leftward and off-screen, taking the leftmost columns with it.
  await page.setViewportSize({ width: 1024, height: 800 });
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_HOLDINGS }).click();
  await expect(panel(page)).toBeVisible();

  // Asserting `x + width <= viewport` looked reasonable and verified nothing: the right
  // edge is pinned by `right-0`, so that sum is structurally constant. Removing the clamp
  // left it green. The parent's width is the load-bearing comparison.
  const measured = await panel(page).evaluate((el) => ({
    panelWidth: el.getBoundingClientRect().width,
    parentWidth: el.parentElement!.getBoundingClientRect().width,
    left: el.getBoundingClientRect().left,
  }));

  expect(
    measured.panelWidth,
    `panel is ${measured.panelWidth}px inside a ${measured.parentWidth}px containing block`,
  ).toBeLessThanOrEqual(measured.parentWidth + 1);
  expect(measured.left, "panel starts left of the viewport").toBeGreaterThanOrEqual(0);
  await expect(rail(page).getByRole("button", { name: RAIL_HOLDINGS })).toBeVisible();
});

test("controls inside a panel are big enough to hit", async ({ page }) => {
  // The bodies were laid out for a full-width section at `px-2 py-1 text-xs` -- about 26px
  // tall. "Too small to click" is the reported symptom, so it gets a measured floor.
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_ALLOCATION }).click();
  await expect(panel(page)).toBeVisible();

  const controls = panel(page).locator("input:visible, select:visible, button:visible");
  const count = await controls.count();
  expect(count, "the allocation panel should expose controls to measure").toBeGreaterThan(0);

  const tooSmall: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const box = await control.boundingBox();
    if (!box) continue;
    if (box.height < CONTROL_MIN_HIT_HEIGHT) {
      tooSmall.push(`${await control.evaluate((el) => el.tagName.toLowerCase())} @ ${box.height}px`);
    }
  }

  expect(tooSmall, `controls below ${CONTROL_MIN_HIT_HEIGHT}px tall: ${tooSmall.join(", ")}`).toEqual([]);
});
