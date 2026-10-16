import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// The shared Tabs component follows the WAI-ARIA tabs pattern: arrows wrap, Home and End jump,
// and focus follows the selection.

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

test("the page tabs move with ArrowRight, ArrowLeft, Home and End, and focus follows", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  const tabs = page.getByRole("tablist", { name: "Corporate analysis sections" });
  const summary = tabs.getByRole("tab", { name: "Summary", exact: true });
  const diagnostics = tabs.getByRole("tab", { name: "Core Diagnostics" });
  const comparison = tabs.getByRole("tab", { name: "Target Stock Comparison" });

  await summary.focus();
  await page.keyboard.press("ArrowRight");
  await expect(diagnostics).toHaveAttribute("aria-selected", "true");
  await expect(diagnostics).toBeFocused();

  await page.keyboard.press("End");
  await expect(comparison).toHaveAttribute("aria-selected", "true");
  await expect(comparison).toBeFocused();

  await page.keyboard.press("Home");
  await expect(summary).toHaveAttribute("aria-selected", "true");
  await expect(summary).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(comparison).toHaveAttribute("aria-selected", "true");
  await expect(comparison).toBeFocused();
});

test("the calculation modal's tabs move with ArrowRight and focus follows", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Verdict detail" }).click();
  const dialog = page.getByRole("dialog");
  const summary = dialog.getByRole("tab", { name: "Summary", exact: true });
  const next = dialog.getByRole("tab").nth(1);

  await summary.focus();
  await page.keyboard.press("ArrowRight");
  await expect(next).toHaveAttribute("aria-selected", "true");
  await expect(next).toBeFocused();
  await expect(summary).toHaveAttribute("aria-selected", "false");
});
