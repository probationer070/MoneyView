import { expect, test } from "@playwright/test";
import { mockSignalsApi } from "./helpers/signalsApiMock";

test("summary, table, trend break, manual save and disclaimer", async ({ page }) => {
  const calls = await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("most-likely")).toHaveText("B");
  await expect(page.getByTestId("prob-b")).toContainText("50.0%");
  await expect(page.getByTestId("prob-b")).toContainText("▲ 5.0%p");

  const sticky = page.getByTestId("row-b_tnx_sticky");
  await expect(sticky).toContainText("Triggered");
  await expect(sticky).toContainText("2026-10-09");
  await expect(sticky).toContainText("B +2.0");
  await expect(page.getByTestId("row-b_brent_spike")).toContainText("Data stale");
  await expect(page.getByTestId("row-b_brent_spike")).toHaveClass(/opacity-50/);

  // One dashed reference line, at the W41 rules_version change. DOM count, not pixels:
  // recharts pixel sampling reads stale coordinates during its animation.
  await expect(page.getByTestId("trend-chart").locator(".recharts-reference-line")).toHaveCount(1);

  await page.getByRole("button", { name: "Run now" }).click();
  await expect.poll(() => calls.run).toBe(1);

  const iran = page.getByTestId("manual-m_iran_strike");
  await iran.getByRole("combobox").selectOption("triggered");
  await iran.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => calls.manual.length).toBe(1);
  expect(calls.manual[0].body).toEqual({ state: "triggered", note: "" });
  await expect(page.getByTestId("prob-b")).toContainText("55.0%");

  await expect(page.getByTestId("disclaimer")).toContainText("not investment advice");
});
