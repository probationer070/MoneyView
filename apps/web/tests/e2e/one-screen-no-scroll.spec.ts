import { expect, test } from "@playwright/test";
import { ONE_SCREEN_ROUTES } from "../../components/ui/oneScreenRoutes";
import { DESIGN_SCREENS } from "./helpers/designScreens";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { expectNoPageScroll, pageScrollProblems } from "./helpers/noPageScroll";

// HARNESS fixed rule: every page in ONE_SCREEN_ROUTES fits 1280x720 with no page scroll. Sideways is
// checked too, because both 390 px regressions of the corporate page (ERROR-LOG 2026-10-14) widened
// the page instead of lengthening it. A later one-screen page joins by adding its route to the list;
// its mock comes from DESIGN_SCREENS.
const SCREENS = new Map(DESIGN_SCREENS);
// A route that is only a prefix (/detail/[ticker] has no page of its own) is visited at a sample path.
const SAMPLE_PATH: Record<string, string> = { "/detail": "/detail/AAPL" };
const samplePath = (route: string) => SAMPLE_PATH[route] ?? route;
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 390, height: 844 }] as const;

test("every one-screen route has a mock in DESIGN_SCREENS", () => {
  expect(ONE_SCREEN_ROUTES.filter((route) => !SCREENS.has(samplePath(route)))).toEqual([]);
});

test.describe("pageScrollProblems", () => {
  const fits = { scrollHeight: 720, innerHeight: 720, scrollWidth: 1280, clientWidth: 1280 };

  test("a page that fits has no problems", () => {
    expect(pageScrollProblems(fits)).toEqual([]);
  });
  test("one pixel too tall is a vertical problem", () => {
    expect(pageScrollProblems({ ...fits, scrollHeight: 721 })).toEqual(["vertical: scrollHeight 721 > innerHeight 720"]);
  });
  test("one pixel of sideways slack is allowed, two is not", () => {
    expect(pageScrollProblems({ ...fits, scrollWidth: 1281 })).toEqual([]);
    expect(pageScrollProblems({ ...fits, scrollWidth: 1282 })).toEqual(["horizontal: scrollWidth 1282 > clientWidth 1280"]);
  });
  test("both axes are reported, vertical first", () => {
    expect(pageScrollProblems({ ...fits, scrollHeight: 900, scrollWidth: 1500 })).toEqual([
      "vertical: scrollHeight 900 > innerHeight 720",
      "horizontal: scrollWidth 1500 > clientWidth 1280",
    ]);
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const route of ONE_SCREEN_ROUTES) {
      test(`${route} does not scroll the page`, async ({ page }) => {
        await SCREENS.get(samplePath(route))!(page);
        await page.goto(samplePath(route), { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        await expectNoPageScroll(page, route);
      });
    }
  });
}

// /portfolio: the header and tab row stay put and the tab panel scrolls inside. A watchlist long enough
// to overflow is seeded, because a region that fits its content would pass without testing anything.
test.describe("portfolio tabs at 1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  for (const tab of ["Stocks", "Weights"] as const) {
    test(`${tab}: the page does not scroll and the header stays put`, async ({ page }) => {
      const watchlist = Array.from({ length: 24 }, (_, index) => ({
        ticker: `TST${index + 1}`, name: `Test Holding ${index + 1}`, sector: "Technology", group_name: "built_in",
        weight: 0.04, last_close: 100 + index, delta: { delta_pct: 0.5 }, sparkline: [95, 97, 99, 100 + index], id: index + 1, theme: "",
      }));
      await mockPortfolioPageApi(page, undefined, { watchlist });
      await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
      const heading = page.getByRole("heading", { name: "Portfolio", exact: true });
      await expect(heading).toBeVisible({ timeout: 60_000 });
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await page.evaluate(() => document.fonts.ready);
      await expectNoPageScroll(page, `/portfolio ${tab}`);

      const region = page.getByTestId("portfolio-scroll-region");
      const before = await heading.boundingBox();
      expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight), `${tab}: the panel region overflows`).toBe(true);
      await region.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect((await heading.boundingBox())!.y, "the header did not scroll away").toBe(before!.y);
      await expectNoPageScroll(page, `/portfolio ${tab} after scrolling the panel`);
    });
  }
});
