import { expect, test, type Page } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

// Spec 2026-10-14 §1 (D9) and §7 test 6: a fixed 48px top bar replaces the left sidebar.
const bar = (page: Page) => page.locator("#app-topnav");
const panel = (page: Page) => page.locator("#app-nav-panel");
const menuButton = (page: Page) => bar(page).getByRole("button", { name: "Menu", exact: true });
const primary = (page: Page) => bar(page).getByRole("navigation", { name: "Primary" });

async function gotoValuation(page: Page) {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(bar(page)).toBeVisible({ timeout: 60_000 });
}

test.describe("the top bar at 1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("is 48px tall at the top, content starts below it, and it stays put on scroll", async ({ page }) => {
    await gotoValuation(page);
    expect(await bar(page).boundingBox()).toMatchObject({ y: 0, height: 48 });
    const first = await page.locator("main > *").first().boundingBox();
    expect(first, "main has content").not.toBeNull();
    expect(first!.y, "content is not under the bar").toBeGreaterThanOrEqual(48);
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
      window.scrollTo(0, 800);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await bar(page).boundingBox())!.y).toBe(0);
  });

  test("only the current page shows a label; every item is a link named in full", async ({ page }) => {
    await gotoValuation(page);
    await expect(primary(page).getByRole("link")).toHaveCount(9);
    const current = primary(page).getByRole("link", { name: "Valuation" });
    await expect(current).toHaveText("Valuation");
    await expect(current).toHaveAttribute("aria-current", "page");
    const other = primary(page).getByRole("link", { name: "Portfolio" });
    await expect(other).toHaveText("");
    await expect(other).toHaveAttribute("title", "Portfolio");
  });

  test("hover opens the panel, and leaving closes it after a short delay", async ({ page }) => {
    await gotoValuation(page);
    await expect(panel(page)).toBeHidden();
    await page.getByTestId("topnav-menu").hover();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByText("Powered by FastAPI & Next.js")).toBeVisible();
    await page.mouse.move(640, 650);
    await page.waitForTimeout(60);
    await expect(panel(page), "still open inside the 150ms grace").toBeVisible();
    await expect(panel(page)).toBeHidden({ timeout: 2_000 });
  });

  test("keyboard focus entering the menu opens it", async ({ page }) => {
    await gotoValuation(page);
    await primary(page).getByRole("link").first().focus();
    await expect(panel(page)).toBeVisible();
  });

  test("clicking ☰ after hovering pins the panel open; clicking again closes it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).hover();
    await expect(panel(page)).toBeVisible();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(640, 650);
    await page.waitForTimeout(400);
    await expect(panel(page), "a pinned panel ignores pointer leave").toBeVisible();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
  });

  test("Escape and an outside click close it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await menuButton(page).click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(640, 650);
    await expect(panel(page)).toBeHidden();
  });

  test("navigating from the panel closes it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await panel(page).getByRole("link", { name: "Cases" }).click();
    await expect(page).toHaveURL(/\/cases$/, { timeout: 60_000 });
    await expect(panel(page)).toBeHidden();
  });

  test("the language toggle does not open the menu", async ({ page }) => {
    await gotoValuation(page);
    await page.getByRole("button", { name: "한국어" }).click();
    await expect(page.getByRole("link", { name: "가치평가" })).toBeVisible();
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeHidden();
  });
});

test.describe("below 768px", () => {
  test.use({ viewport: { width: 600, height: 800 } });

  test("the bar shows the page name and ☰; hover does not open the menu, ☰ does", async ({ page }) => {
    await gotoValuation(page);
    await expect(primary(page)).toBeHidden();
    await expect(page.getByTestId("topnav-current")).toHaveText("Valuation");
    await page.getByTestId("topnav-menu").hover();
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeHidden();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page).getByRole("link", { name: "Portfolio" })).toBeVisible();
  });
});
