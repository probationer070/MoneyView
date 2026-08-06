import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The portfolio page moved its stacked sections behind a rail of icon buttons, so a spec
 * that wants one of those sections has to open its panel first. Rail label on the left,
 * the panel's accessible name on the right.
 */
const PANELS = {
  snapshot: { rail: "Latest snapshot summary", title: "Latest Snapshot Summary" },
  attribution: { rail: "Attribution", title: "Attribution" },
  allocation: { rail: "Allocation workspace", title: "Portfolio Allocation Workspace" },
  holdings: { rail: "Holdings table", title: "Watchlist Holdings" },
} as const;

export type PortfolioPanelId = keyof typeof PANELS;

export function portfolioRail(page: Page) {
  return page.getByTestId("portfolio-rail");
}

export function portfolioPanel(page: Page) {
  return page.getByTestId("portfolio-side-panel");
}

/**
 * The stock detail and snapshot history modals. SidePanel is also `role="dialog"`, so a
 * bare `getByRole("dialog")` is ambiguous whenever a panel happens to be open.
 */
export function portfolioModal(page: Page): Locator {
  return page.locator('[role="dialog"]:not([data-testid="portfolio-side-panel"])');
}

/** Opens `id`, closing whatever else is open. A no-op when it is already the open panel. */
export async function openPortfolioPanel(page: Page, id: PortfolioPanelId) {
  const panel = portfolioPanel(page);
  if ((await panel.count()) > 0) {
    if ((await panel.getAttribute("aria-label")) === PANELS[id].title) return panel;
    // The rail button toggles, so close through the rail rather than Escape: Escape is a
    // document listener and would also close any modal the spec has deliberately opened.
    const openTitle = await panel.getAttribute("aria-label");
    const openId = (Object.keys(PANELS) as PortfolioPanelId[]).find((key) => PANELS[key].title === openTitle);
    if (openId) {
      await portfolioRail(page).getByRole("button", { name: PANELS[openId].rail }).click();
      await expect(panel).toHaveCount(0);
    }
  }
  await portfolioRail(page).getByRole("button", { name: PANELS[id].rail }).click();
  await expect(panel).toHaveAttribute("aria-label", PANELS[id].title);
  return panel;
}
