import { expect, test, type Locator } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

/**
 * Sidebar nav labels must be readable. Before this, inactive labels were #9DA5A2 on the
 * #E0E4D6 sidebar (1.95:1) and the active label was white on #60caad (1.99:1) -- both far
 * under the 4.5:1 WCAG AA minimum. Labels are now bold black in every state.
 */

const BLACK = "rgb(0, 0, 0)";

async function styleOf(link: Locator) {
  return link.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, fontWeight: style.fontWeight, background: style.backgroundColor };
  });
}

test("every sidebar nav label is bold black, active or not, and the active one is still marked", async ({ page }) => {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });

  const sidebar = page.locator("#app-sidebar");
  const active = sidebar.getByRole("link", { name: "Valuation" });
  const inactive = sidebar.getByRole("link", { name: "Portfolio" });
  await expect(active).toBeVisible({ timeout: 60_000 });
  await expect(inactive).toBeVisible();

  const activeStyle = await styleOf(active);
  const inactiveStyle = await styleOf(inactive);

  expect(activeStyle, "active label").toMatchObject({ color: BLACK, fontWeight: "700" });
  expect(inactiveStyle, "inactive label").toMatchObject({ color: BLACK, fontWeight: "700" });
  // Black text everywhere must not erase which page you are on.
  expect(activeStyle.background, "the active item keeps a background the inactive one lacks").not.toBe(
    inactiveStyle.background,
  );

  await inactive.hover();
  // Wait for the hover background to land first. Text colour and background share one
  // transition, so polling the colour alone would pass on its very first, pre-transition
  // sample -- when it is still black whatever the hover style does.
  await expect
    .poll(async () => (await styleOf(inactive)).background, { message: "hover background applied" })
    .toBe(activeStyle.background);
  expect((await styleOf(inactive)).color, "hovered label").toBe(BLACK);
});
