import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The four page tabs of /corporate (spec §2A, plan Task 7b). They were three lower tabs until D10.
 * The helper names stayed "lower" so the approved specs that call them need no rename.
 */
export type LowerTabName = "Summary" | "Core Diagnostics" | "DCF" | "Target Stock Comparison";

export async function openLowerTab(page: Page, name: LowerTabName): Promise<void> {
  const tab = page.getByTestId("corporate-page-tabs").getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** A tab inside the calculation detail modal (plan Task 8). */
export async function openDetailTab(dialog: Locator, name: string): Promise<void> {
  const tab = dialog.getByRole("tablist", { name: "Calculation detail sections" }).getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** The selected page tab's panel (never the modal's). */
export function lowerPanel(page: Page): Locator {
  return page.getByTestId("corporate-page-tabs").getByRole("tabpanel");
}

/** Refresh DCF, then wait until the verdict holds a valuation. Reads the header strip, which every page tab shows. */
export async function refreshDcf(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect(page.getByTestId("corporate-verdict-strip")).toHaveAttribute("data-state", "valued", { timeout: 60_000 });
}

/** DCF tab → Load Full Report (spec §3.2). Returns the DCF tab panel, where the grid shows. */
export async function loadFullDcfReportInTab(page: Page): Promise<Locator> {
  await openLowerTab(page, "DCF");
  const panel = lowerPanel(page);
  await panel.getByRole("button", { name: "Load Full Report" }).click();
  return panel;
}

/** Verdict detail → Full DCF Report → Load Full Report, inside the calculation modal. */
export async function openFullDcfReportInModal(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Verdict detail" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await openDetailTab(dialog, "Raw data");
  await dialog.locator("summary").filter({ hasText: "Full DCF Report" }).click();
  await dialog.getByRole("button", { name: "Load Full Report" }).click();
  return dialog;
}
