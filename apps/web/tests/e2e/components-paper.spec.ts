import { expect, test, type Locator } from "@playwright/test";

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const style = (locator: Locator, ...props: string[]) =>
  locator.evaluate((el, names) => Object.fromEntries(names.map((n) => [n, getComputedStyle(el).getPropertyValue(n)])), props);

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
});

test("primary button is a brand fill with near-black text, 44px tall, 2px corners", async ({ page }) => {
  const button = page.getByRole("button", { name: "Primary" });
  expect(await style(button, "background-color", "color", "height", "border-top-left-radius", "text-transform")).toEqual({
    "background-color": rgb("#fa3600"), color: rgb("#101010"), height: "44px", "border-top-left-radius": "2px", "text-transform": "uppercase",
  });
});

test("deltas pair colour with glyph and sign; rounded zero and missing read as flat", async ({ page }) => {
  const deltas = page.getByTestId("gallery-deltas").getByTestId("delta-badge");
  const read = (i: number) => deltas.nth(i).evaluate((el) => ({
    dir: el.getAttribute("data-dir"),
    glyph: el.querySelector('[aria-hidden="true"]')?.textContent,
    value: el.querySelector('[data-part="value"]')?.textContent,
    color: getComputedStyle(el).color,
  }));
  expect(await read(0)).toEqual({ dir: "up", glyph: "▲", value: "+1.2%", color: rgb("#d21f3c") });
  expect(await read(1)).toEqual({ dir: "down", glyph: "▼", value: "-3.4%", color: rgb("#1e5bd8") });
  expect(await read(2)).toEqual({ dir: "flat", glyph: "■", value: "0.0%", color: rgb("#626260") });
  expect(await read(3)).toEqual({ dir: "flat", glyph: "■", value: "—", color: rgb("#626260") });
});

test("card is a square hairline panel with four corner ticks and no shadow", async ({ page }) => {
  const card = page.getByTestId("gallery-card-body").locator("..");
  expect(await style(card, "border-top-width", "border-top-color", "background-color", "border-top-left-radius", "box-shadow")).toEqual({
    "border-top-width": "1px", "border-top-color": rgb("#b3b3af"), "background-color": rgb("#f0f0f0"),
    "border-top-left-radius": "0px", "box-shadow": "none",
  });
  await expect(card.locator(':scope > i[aria-hidden="true"]')).toHaveCount(4);
});

test("table headers are 11px mono captions; right-aligned cells are mono figures", async ({ page }) => {
  const table = page.getByTestId("gallery-table");
  const th = await style(table.locator("th").first(), "font-size", "font-family");
  expect(th["font-size"]).toBe("11px");
  expect(th["font-family"].toLowerCase()).toContain("geistmono");
  const figure = await style(table.locator("tbody td").nth(1), "text-align", "font-family");
  expect(figure["text-align"]).toBe("right");
  expect(figure["font-family"].toLowerCase()).toContain("geistmono");
});

test("the selected segment is an ink fill with ground-coloured text", async ({ page }) => {
  const on = page.getByTestId("gallery-toggle").getByRole("button", { name: "3M" });
  expect(await style(on, "background-color", "color")).toEqual({ "background-color": rgb("#282828"), color: rgb("#ffffff") });
});

test("a large KPI figure is the 44px mono figure style", async ({ page }) => {
  const s = await style(page.getByTestId("gallery-card-body").getByText("2,847.31"), "font-size", "font-family");
  expect(s["font-size"]).toBe("44px");
  expect(s["font-family"].toLowerCase()).toContain("geistmono");
});
