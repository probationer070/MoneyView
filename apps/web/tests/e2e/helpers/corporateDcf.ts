import { expect, type Locator, type Page } from "@playwright/test";

/** The three lower tabs of /corporate (corporate one-screen plan, Task 6). */
export type LowerTabName = "Core Diagnostics" | "DCF" | "Target Stock Comparison";

export async function openLowerTab(page: Page, name: LowerTabName): Promise<void> {
  const tab = page.getByTestId("corporate-lower-tabs").getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** The selected lower tab's panel (never the modal's). */
export function lowerPanel(page: Page): Locator {
  return page.getByTestId("corporate-lower-tabs").getByRole("tabpanel");
}
