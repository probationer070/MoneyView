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

test("the disclaimer is shown word for word", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("disclaimer")).toHaveText(
    "These probabilities are a heuristic built from subjective likelihood ratios, not a statistical model estimate, and are not investment advice.",
  );
});

test("a manual save PUTs to that rule's endpoint with the chosen state and note", async ({ page }) => {
  const calls = await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });

  const iran = page.getByTestId("manual-m_iran_strike");
  await iran.getByRole("combobox").selectOption("near");
  await page.getByLabel("Iran strikes resume Note").fill("ceasefire talks stalled");
  await iran.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => calls.manual.length).toBe(1);
  expect(calls.manual[0].method).toBe("PUT");
  expect(new URL(calls.manual[0].url).pathname).toBe("/api/v1/signals/manual/m_iran_strike");
  expect(calls.manual[0].body).toEqual({ state: "near", note: "ceasefire talks stalled" });
});

test("failures from a run-now are listed under the summary", async ({ page }) => {
  const calls = await mockSignalsApi(page, { runFailures: ["DGS10: FRED request failed"] });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("DGS10: FRED request failed")).toHaveCount(0);

  await page.getByRole("button", { name: "Run now" }).click();
  await expect.poll(() => calls.run).toBe(1);
  await expect(page.getByRole("status")).toContainText("DGS10: FRED request failed");
});

test("a failed save shows an alert, leaves the form usable and throws nothing unhandled", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await mockSignalsApi(page, { manualFails: true });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });

  const iran = page.getByTestId("manual-m_iran_strike");
  await iran.getByRole("combobox").selectOption("triggered");
  await iran.getByRole("button", { name: "Save" }).click();
  await expect(iran.getByRole("alert")).toHaveText("Could not save. Try again.");
  await expect(iran.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("a failed run shows an alert and re-enables the button", async ({ page }) => {
  await mockSignalsApi(page, { runFails: true });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The run failed" })).toHaveText("The run failed. Check the server log.");
  await expect(page.getByRole("button", { name: "Run now" })).toBeEnabled();
});

test("failures stored with the latest snapshot are listed after a reload", async ({ page }) => {
  await mockSignalsApi(page, { latestFailures: ["DGS10: FRED request failed"] });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toContainText("DGS10: FRED request failed");
});

test("a stale row shows the reason the engine stored", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("row-b_brent_spike")).toContainText("FRED DCOILBRENTEU: no observation in the last 30 days");
});

test("with no snapshot and no history the page shows the empty state without crashing", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await mockSignalsApi(page, { noSnapshot: true, emptyHistory: true });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("No snapshot yet. Run the engine to create this week's.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
  await expect(page.getByRole("table", { name: "signals" })).toHaveCount(0);
  await expect(page.getByTestId("disclaimer")).toContainText("not investment advice");
  expect(pageErrors).toEqual([]);
});

test("the trend chart mounts without a zero-size warning", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("width(-1)") || msg.text().includes("height(-1)")) warnings.push(msg.text());
  });
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trend-chart").locator(".recharts-line").first()).toBeAttached();
  expect(warnings).toEqual([]);
});

test("an all-stale snapshot says no signal was judged and that the probabilities equal the prior", async ({ page }) => {
  await mockSignalsApi(page, { allStale: true });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("evidence")).toContainText("0 of 2 signals judged, 2 stale");
  await expect(page.getByText("No signal was judged this week, so these probabilities equal the prior.")).toBeVisible();
});

test("a snapshot with some judged signals counts them against the stale ones and shows no empty-evidence message", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("evidence")).toContainText("1 of 2 signals judged, 1 stale");
  await expect(page.getByText("No signal was judged this week")).toHaveCount(0);
});

test("the probability delta names the week it is measured against", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("prob-b")).toContainText("▲ 5.0%p vs 2026-W40");
});

test("the manual panel names the ISO week its states belong to", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "manual" }).getByTestId("manual-week")).toHaveText("2026-W41");
});

test("a save for a week with no snapshot says it applies at the next run", async ({ page }) => {
  await mockSignalsApi(page, { manualNullSnapshot: true });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  const iran = page.getByTestId("manual-m_iran_strike");
  await iran.getByRole("combobox").selectOption("triggered");
  await iran.getByRole("button", { name: "Save" }).click();
  await expect(iran).toContainText("Saved for this week; it will apply at the next run.");
});

test("a manual row re-reads its state when a new run changes the snapshot", async ({ page }) => {
  await mockSignalsApi(page, { runAddsIranNear: true });
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  const iran = page.getByTestId("manual-m_iran_strike").getByRole("combobox");
  await expect(iran).toHaveValue("");
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(iran).toHaveValue("near");
});
