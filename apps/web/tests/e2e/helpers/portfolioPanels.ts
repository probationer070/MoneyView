import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The portfolio page is a set of page tabs (Stocks / Weights / Attribution). A spec that
 * wants the allocation workspace or the attribution charts opens its tab first. Panel id
 * on the left, the tab's accessible name on the right.
 */
const TABS = {
  allocation: "Weights",
  attribution: "Attribution",
  holdings: "Stocks",
} as const;

export type PortfolioPanelId = "snapshot" | keyof typeof TABS;

/** The stock detail modal and any other dialog the page opens. */
export function portfolioModal(page: Page): Locator {
  return page.getByRole("dialog");
}

/** Selects the tab that carries `id` and returns the tab panel. A no-op when it is already selected. */
export async function openPortfolioPanel(page: Page, id: PortfolioPanelId) {
  if (id === "snapshot") {
    throw new Error('The snapshot panel was removed from /portfolio; there is nothing to open for "snapshot".');
  }
  const tab = page.getByRole("tab", { name: TABS[id], exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel");
}
