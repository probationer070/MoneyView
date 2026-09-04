import { expect, test, type Page } from "@playwright/test";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";

async function gotoDecisions(page: Page) {
  await page.goto("/decisions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Decision Log/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the decision log page", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);
    await expect(page.getByRole("link", { name: /Decision Log/i })).toBeVisible();
  });

  test("each figure is labelled with its own basis, and the move names its period", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    const msft = page.getByTestId("decision-card-1");
    await expect(msft).toBeVisible();

    // The gap is horizonless and must say so -- it is NOT an annual return.
    await expect(msft.getByText(/gap to fair value at decision/i)).toBeVisible();
    await expect(msft.getByText(/no horizon/i)).toBeVisible();
    await expect(msft.getByText("+50.0%")).toBeVisible();

    // The move carries a stated period, both dates named (spec 4.1).
    await expect(msft.getByText(/price move/i)).toBeVisible();
    // The exact period, as ONE string. Asserting each date separately would
    // match the card's own decided-on header too, which is a Playwright
    // strict-mode violation -- and this way the two dates are pinned as a
    // travelling pair, which is what spec 4.1 actually requires.
    await expect(msft.getByText("2026-09-04 → 2099-01-01")).toBeVisible();
    await expect(msft.getByText("+20.0%")).toBeVisible();

    await expect(msft.getByText("cheap on FCF")).toBeVisible();
  });

  test("a refusal renders its sentence, never a zero and never a blank", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    // Figures refused: the reason replaces the numbers.
    const zztop = page.getByTestId("decision-card-3");
    await expect(zztop.getByText(/the model cannot value it at this time/i)).toBeVisible();

    // Outcome pending: a flat 0.0% would be indistinguishable from a genuine
    // zero move, which is exactly what spec 4.1 forbids.
    const nvda = page.getByTestId("decision-card-2");
    await expect(nvda.getByText(/no bar with a close after 2026-09-04/i)).toBeVisible();
    await expect(nvda.getByText("+0.0%")).toHaveCount(0);
  });

  test("recording a decision posts exactly ticker, action and memo", async ({ page }) => {
    const stats = await mockDecisionsApi(page);
    await gotoDecisions(page);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/action/i).selectOption("buy");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    // Enter, not a click: it is a real <form>, and submitting the way a
    // keyboard user does proves the semantics rather than the click handler.
    await page.getByLabel(/memo/i).press("Enter");

    await expect.poll(() => stats.posts.length).toBe(1);
    // The request model is extra="forbid": any additional key is a 422, and a
    // client-supplied figure would be stored as what the user believed.
    expect(Object.keys(stats.posts[0]).sort()).toEqual(["action", "memo", "ticker"]);
    expect(stats.posts[0]).toMatchObject({
      ticker: "AAPL", action: "buy", memo: "services margin inflecting",
    });
  });

  test("a recorded decision appears in the list without a reload", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    // Precondition: the new ticker is absent, so its later presence is the
    // refetch and not a fixture that always contained it.
    await expect(page.getByTestId("decision-card-4")).toHaveCount(0);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    await page.getByRole("button", { name: /record decision/i }).click();

    // The mock appends on POST, so this row can ONLY appear if the ["decisions"]
    // query was invalidated and refetched. Without the invalidation the list
    // stays on its cached three rows.
    await expect(page.getByTestId("decision-card-4")).toBeVisible();
    await expect(page.getByTestId("decision-card-4").getByText("AAPL")).toBeVisible();
    await expect(page.getByTestId("decision-card-4").getByText("services margin inflecting")).toBeVisible();
  });

  test("an empty memo is refused in the browser, before any request", async ({ page }) => {
    const stats = await mockDecisionsApi(page);
    await gotoDecisions(page);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("   ");
    await page.getByRole("button", { name: /record decision/i }).click();

    await expect(page.getByText(/a decision without a reason is a snapshot/i)).toBeVisible();
    expect(stats.posts).toHaveLength(0);
  });

  test("a server rejection leaves the log intact and does not clear the form", async ({ page }) => {
    await mockDecisionsApi(page, { postStatus: 422 });
    await gotoDecisions(page);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    await page.getByRole("button", { name: /record decision/i }).click();

    // `fetchApi` throws a GENERIC "API error: 422 Unprocessable Entity" and
    // never surfaces the server's `detail` (apps/web/lib/api.ts), so assert
    // that an error is shown -- never the server's wording, which cannot
    // reach this component.
    //
    // Scoped to the <main> landmark: Next's App Router also mounts a
    // role="alert" live region (id="__next-route-announcer__") as a sibling
    // of the app content, reachable through its own open shadow root, so an
    // unscoped page-wide query resolves to two elements and is a strict-mode
    // violation regardless of this component.
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();

    // The three existing decisions survive: a failed write must not look like
    // a successful one that emptied the log.
    await expect(page.getByTestId("decision-card-1")).toBeVisible();
    await expect(page.getByTestId("decision-card-2")).toBeVisible();
    await expect(page.getByTestId("decision-card-3")).toBeVisible();

    // The typed memo is still there to retry with, not silently discarded.
    await expect(page.getByLabel(/memo/i)).toHaveValue("services margin inflecting");
  });
});
