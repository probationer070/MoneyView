import { expect, type Locator, type Page } from "@playwright/test";

/** The page tabs of "/" (market one-screen plan, Task 4), by their English labels. */
export type MarketTabName = "Instruments" | "Spreads";

/**
 * Opens a page tab on "/" and waits until it is selected. The click is retried: the tab bar is
 * server-rendered, so a click that lands before hydration does nothing. Each try waits on
 * aria-selected; there is no fixed sleep.
 */
export async function openMarketTab(page: Page, name: MarketTabName): Promise<void> {
  const tab = page.getByTestId("market-page-tabs").getByRole("tab", { name, exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

/** The selected page tab's panel on "/". */
export function marketPanel(page: Page): Locator {
  return page.getByTestId("market-page-tabs").getByRole("tabpanel");
}
