import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

// Spec 2026-10-14 §1 (D9) and §7 test 6: a fixed 48px top bar replaces the left sidebar.
// 2026-11-15 (D1, D2): icons slide their label out on hover or focus; ☰ opens a grouped panel.
const bar = (page: Page) => page.locator("#app-topnav");
const panel = (page: Page) => page.locator("#app-nav-panel");
const menuButton = (page: Page) => bar(page).getByRole("button", { name: "Menu", exact: true });
const primary = (page: Page) => bar(page).getByRole("navigation", { name: "Primary" });
const iconLink = (page: Page, name: string) => primary(page).getByRole("link", { name, exact: true });
const labelOf = (link: Locator) => link.locator("span");
const groupButton = (page: Page, group: string) => panel(page).getByRole("button", { name: group, exact: true });
const flyout = (page: Page, group: string) => panel(page).getByRole("navigation", { name: group, exact: true });
const GROUP = { market: "Markets", signals: "Signals", corporate: "Companies & Valuation", portfolio: "Portfolio" };

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

  test("icons keep names; only the current page's label is shown at rest", async ({ page }) => {
    await gotoValuation(page);
    await expect(primary(page).getByRole("link")).toHaveCount(11);
    const current = primary(page).getByRole("link", { name: "Valuation" });
    await expect(current).toHaveText("Valuation");
    await expect(current).toHaveAttribute("aria-current", "page");
    // D1: the current page also carries a 2px brand underline.
    const brand = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--brand)";
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    expect(await current.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(brand);
    const other = primary(page).getByRole("link", { name: "Portfolio" });
    await expect(labelOf(other)).toHaveCSS("max-width", "0px");
    await expect(other).toHaveAttribute("title", "Portfolio");
  });

  test("hovering an icon reveals its label and pushes the next icon; leaving hides it", async ({ page }) => {
    await gotoValuation(page);
    const portfolio = iconLink(page, "Portfolio");
    const news = iconLink(page, "News Feed");
    await expect(labelOf(portfolio)).toBeHidden();
    const before = (await news.boundingBox())!.x;
    await portfolio.hover();
    await expect(labelOf(portfolio)).toBeVisible();
    await expect(labelOf(portfolio)).toHaveText("Portfolio");
    expect((await news.boundingBox())!.x, "next icon moved right").toBeGreaterThan(before + 40);
    await page.mouse.move(640, 650);
    await expect(labelOf(portfolio)).toBeHidden();
  });

  test("keyboard focus reveals an icon's label; moving focus away hides it", async ({ page }) => {
    await gotoValuation(page);
    const portfolio = iconLink(page, "Portfolio");
    await portfolio.focus();
    await expect(labelOf(portfolio)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(labelOf(portfolio)).toBeHidden();
  });

  test("the current page's label stays visible while another icon is hovered", async ({ page }) => {
    await gotoValuation(page);
    await iconLink(page, "Portfolio").hover();
    await expect(labelOf(iconLink(page, "Valuation"))).toBeVisible();
    await expect(labelOf(iconLink(page, "Valuation"))).toHaveText("Valuation");
  });

  test("hovering the menu cluster does not open the panel", async ({ page }) => {
    await gotoValuation(page);
    await expect(panel(page)).toBeHidden();
    await page.getByTestId("topnav-menu").hover();
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("focusing an icon does not open the panel", async ({ page }) => {
    await gotoValuation(page);
    await iconLink(page, "Portfolio").focus();
    await expect(labelOf(iconLink(page, "Portfolio"))).toBeVisible();
    await expect(panel(page)).toBeHidden();
  });

  test("☰ click toggles the panel; the pointer leaving does not close it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toBeVisible();
    await page.mouse.move(640, 650);
    await page.waitForTimeout(400);
    await expect(panel(page), "the open panel stays open when the pointer leaves").toBeVisible();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
  });

  test("☰ opens the grouped panel with the current page's group expanded", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    for (const group of Object.values(GROUP)) await expect(groupButton(page, group)).toBeVisible();
    await expect(groupButton(page, GROUP.corporate)).toHaveAttribute("aria-expanded", "true");
    await expect(groupButton(page, GROUP.market)).toHaveAttribute("aria-expanded", "false");
    const corporate = flyout(page, GROUP.corporate);
    await expect(corporate.getByRole("link", { name: "Valuation", exact: true })).toBeVisible();
    await expect(corporate.getByRole("link", { name: "Cases", exact: true })).toBeVisible();
    await expect(corporate.getByRole("link", { name: "Corporate Analysis", exact: true })).toBeVisible();
    await expect(panel(page).getByText("Powered by FastAPI & Next.js")).toBeVisible();
  });

  test("the grouped panel is translated", async ({ page }) => {
    await gotoValuation(page);
    await page.getByRole("button", { name: "한국어" }).click();
    await bar(page).getByRole("button", { name: "메뉴", exact: true }).click();
    await expect(bar(page).getByRole("button", { name: "메뉴", exact: true })).toHaveAttribute("aria-expanded", "true");
    for (const name of ["시장", "신호", "기업·가치평가", "포트폴리오"]) {
      await expect(groupButton(page, name)).toBeVisible();
    }
  });

  test("each group's flyout lists its pages, and all 11 pages are reachable", async ({ page }) => {
    const expected: Record<string, string[]> = {
      [GROUP.market]: ["/", "/news", "/events"],
      [GROUP.signals]: ["/signals", "/alerts"],
      [GROUP.corporate]: ["/corporate", "/valuation", "/cases"],
      [GROUP.portfolio]: ["/portfolio", "/monte-carlo", "/decisions"],
    };
    await gotoValuation(page);
    await menuButton(page).click();
    const seen: string[] = [];
    for (const [group, hrefs] of Object.entries(expected)) {
      await groupButton(page, group).hover();
      await expect(groupButton(page, group)).toHaveAttribute("aria-expanded", "true");
      await expect(flyout(page, group)).toBeVisible();
      const links = await flyout(page, group).getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
      expect(links, group).toEqual(hrefs);
      seen.push(...hrefs);
      for (const other of Object.keys(expected).filter((g) => g !== group)) {
        await expect(flyout(page, other), `${other} flyout is closed`).toBeHidden();
      }
    }
    expect(new Set(seen).size).toBe(11);
  });

  test("keyboard focus on a group header opens its flyout; Escape returns focus to ☰", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await groupButton(page, GROUP.market).focus();
    await expect(flyout(page, GROUP.market)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
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

  test("an outside click also closes an open group flyout", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await groupButton(page, GROUP.portfolio).click();
    await expect(flyout(page, GROUP.portfolio)).toBeVisible();
    await page.mouse.click(640, 650);
    await expect(panel(page)).toBeHidden();
    await expect(flyout(page, GROUP.portfolio)).toBeHidden();
  });

  test("navigating from the panel closes it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await expect(flyout(page, GROUP.corporate)).toBeVisible();
    await panel(page).getByRole("link", { name: "Cases" }).click();
    await expect(page).toHaveURL(/\/cases$/, { timeout: 60_000 });
    await expect(panel(page)).toBeHidden();
  });

  test("after navigating from a flyout, the next open expands the new page's group", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await groupButton(page, GROUP.portfolio).click();
    await flyout(page, GROUP.portfolio).getByRole("link", { name: "Decision Log", exact: true }).click();
    await expect(page).toHaveURL(/\/decisions$/, { timeout: 60_000 });
    await expect(flyout(page, GROUP.portfolio)).toBeHidden();
    await menuButton(page).click();
    await expect(groupButton(page, GROUP.portfolio)).toHaveAttribute("aria-expanded", "true");
    await expect(flyout(page, GROUP.portfolio)).toBeVisible();
  });

  test("the language toggle does not open the menu", async ({ page }) => {
    await gotoValuation(page);
    await page.getByRole("button", { name: "한국어" }).click();
    // Scoped to the bar's primary nav: once Korean is on, that nav is named 주 메뉴, not "Primary".
    await expect(page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "가치평가" })).toBeVisible();
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeHidden();
  });

  test("an open menu does not reopen when history returns to its page", async ({ page }) => {
    await gotoValuation(page);
    await primary(page).getByRole("link", { name: "Cases" }).click();
    await expect(page).toHaveURL(/\/cases$/, { timeout: 60_000 });
    await menuButton(page).click();
    await expect(panel(page)).toBeVisible();
    // Browser back is not a panel link, so the open state survives it unless it is cleared.
    await page.goBack();
    await expect(page).toHaveURL(/\/valuation$/, { timeout: 60_000 });
    await expect(panel(page)).toBeHidden();
    await page.goForward();
    await expect(page).toHaveURL(/\/cases$/, { timeout: 60_000 });
    await expect(panel(page)).toBeHidden();
  });

  test("Escape with focus on a panel link returns focus to ☰", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await panel(page).getByRole("link", { name: "Cases" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
  });

  test("the icon link keeps its full accessible name when its label is revealed", async ({ page }) => {
    await gotoValuation(page);
    await iconLink(page, "News Feed").hover();
    await expect(labelOf(iconLink(page, "News Feed"))).toBeVisible();
    await expect(primary(page).getByRole("link", { name: "News Feed", exact: true })).toHaveCount(1);
  });

  test("with the longest Korean label expanded, the bar fits 1280px with no page scroll", async ({ page }) => {
    await mockValuationApi(page);
    await page.goto("/valuation", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "한국어" }).click();
    await expect(bar(page)).toBeVisible({ timeout: 60_000 });
    const koIcon = (name: string) => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name, exact: true });
    await koIcon("몬테카를로 시뮬레이션").hover();
    await expect(labelOf(koIcon("몬테카를로 시뮬레이션"))).toBeVisible();
    expect(await bar(page).boundingBox()).toMatchObject({ y: 0, height: 48 });
    const fit = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(fit.scrollWidth, "no horizontal page scroll").toBeLessThanOrEqual(fit.clientWidth);
    const toggle = (await bar(page).getByRole("group", { name: "언어" }).boundingBox())!;
    expect(toggle.x + toggle.width, "language toggle inside the viewport").toBeLessThanOrEqual(1280);
    const menu = (await bar(page).getByRole("button", { name: "메뉴", exact: true }).boundingBox())!;
    const lastIcon = (await koIcon("시장 개요").boundingBox())!;
    expect(menu.x, "☰ does not overlap the icons").toBeGreaterThanOrEqual(lastIcon.x + lastIcon.width - 1);
  });
});

test.describe("label motion", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("under reduced motion the label reveal has no transition", async ({ page }) => {
    await gotoValuation(page);
    const property = await labelOf(iconLink(page, "Portfolio")).evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(property).toBe("none");
  });

  test("with motion allowed the label slides out over a non-zero duration", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    try {
      await gotoValuation(page);
      const style = await labelOf(iconLink(page, "Portfolio")).evaluate((el) => ({
        property: getComputedStyle(el).transitionProperty,
        duration: getComputedStyle(el).transitionDuration,
      }));
      expect(style.property).toContain("max-width");
      expect(style.duration).not.toBe("0s");
    } finally {
      await context.close();
    }
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
    await groupButton(page, GROUP.portfolio).click();
    await expect(panel(page).getByRole("link", { name: "Portfolio", exact: true })).toBeVisible();
  });
});
