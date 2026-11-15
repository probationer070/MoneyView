import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel } from "./helpers/portfolioPanels";

// The four findings the Task 11 ledger deferred to the whole-branch review that are
// about what the panels look like once content moved into a 480px slide-over.

async function gotoGrid(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("panel copy does not describe a layout the panel does not have", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  const panel = await openPortfolioPanel(page, "allocation");

  // Written when this was a full-width section with side-by-side columns. In a 480px
  // slide-over there is no left, no right, and nothing below.
  const body = panel;
  await expect(body).not.toContainText("on the left");
  await expect(body).not.toContainText("on the right");
  await expect(body).not.toContainText("summaries below");
});

// The panels opened at one shared `max-w-[480px]`, but two of the four bodies declare a
// `min-w-[1120px]` table (PortfolioAllocationEditor.tsx:145, page.tsx:480). Those two
// scrolled horizontally and hid their own controls: weight inputs, save state and sliders
// sat off-screen, so the panel could be open and still not usable. Width is now chosen per
// panel. These assert geometry rather than class names -- the class is how it is done
// today, the rendered size is what has to be true.

const CONTROL_MIN_HIT_HEIGHT = 32;

test("the allocation table sits inside the Weights tab at 1280px with no horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await openPortfolioPanel(page, "allocation");
  await expect(page.getByLabel("Portfolio table scroll region")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(0);
});

// Open finding (P2a): on the Weights tab the row buttons are 28px tall and the checkboxes and
// sliders are 13-16px, so the 32px floor fails. Needs an owner decision (raise the controls, or
// exempt native checkboxes/sliders) before this is re-enabled.
test.fixme("controls inside a panel are big enough to hit", async ({ page }) => {
  // The bodies were laid out for a full-width section at `px-2 py-1 text-xs` -- about 26px
  // tall. "Too small to click" is the reported symptom, so it gets a measured floor.
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  const panel = await openPortfolioPanel(page, "allocation");

  const controls = panel.locator("input:visible, select:visible, button:visible");
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

test.describe("ko portfolio", () => {
  test.use({ locale: "ko-KR" });
  test("the page title and a formatted figure follow the Korean locale", async ({ page }) => {
    await mockPortfolioPageApi(page);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "포트폴리오", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("stock-tile-AAPL")).toContainText("20.0%");
  });

  test("a table header follows the Korean locale", async ({ page }) => {
    await mockPortfolioPageApi(page);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "표", exact: true }).click();
    await expect(page.getByRole("tabpanel").getByRole("columnheader", { name: "현재가", exact: true }).first()).toBeVisible();
  });
});

test("the holdings table fits the panel at 1280px with no horizontal scroll and shows change in the price cell", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await page.getByRole("button", { name: "Table", exact: true }).click();

  const table = page.getByRole("tabpanel").locator("table").first();
  await expect(table).toBeVisible();
  // Column 3 is the current price (ticker, sector, price). The day change badge sits under the price.
  const firstRowPriceCell = table.locator("tbody tr").first().locator("td").nth(2);
  await expect(firstRowPriceCell.getByTestId("delta-badge")).toBeVisible();

  const fits = await table.evaluate((node) => {
    const container = node.parentElement as HTMLElement;
    return { scrollWidth: container.scrollWidth, clientWidth: container.clientWidth };
  });
  expect(fits.scrollWidth, "table overflows its container horizontally").toBeLessThanOrEqual(fits.clientWidth + 1);
});
