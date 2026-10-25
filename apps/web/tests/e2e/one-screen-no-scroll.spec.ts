import { expect, test } from "@playwright/test";
import { ONE_SCREEN_ROUTES } from "../../components/ui/oneScreenRoutes";
import { DESIGN_SCREENS } from "./helpers/designScreens";
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
