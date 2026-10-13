import { test } from "@playwright/test";
import { DESIGN_SCREENS, screenName } from "./helpers/designScreens";

test.skip(!process.env.DESIGN_CAPTURE, "set DESIGN_CAPTURE=<label> to capture screens");

for (const [route, mock] of DESIGN_SCREENS) {
  test(`capture ${route}`, async ({ page }) => {
    // A fixed clock keeps "updated N min ago" and other date-relative text identical between
    // runs; the byte-equality checks of Tasks 1-3 depend on it.
    await page.clock.setFixedTime(new Date("2026-10-12T06:30:00Z"));
    await mock(page);
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForTimeout(600); // past recharts' 400 ms animation
    await page.screenshot({
      path: `design-capture/${process.env.DESIGN_CAPTURE}/${screenName(route)}.png`,
      fullPage: true,
      animations: "disabled",
      // "/" server-renders its index cards from the live API (app/page.tsx fetches
      // /market/indices on the server, where page.route cannot intercept), so the card
      // prices and sparklines move between runs. Mask the cards; the rest of the page is
      // still compared.
      mask: route === "/" ? [page.locator("article")] : [],
    });
  });
}
