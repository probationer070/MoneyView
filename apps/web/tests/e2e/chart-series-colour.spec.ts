import { expect, test } from "@playwright/test";
import { seriesColor } from "../../lib/chartConfig";

// Pure function, no page. Series 0-4 take chart-1..5; series 5 and beyond, and any negative
// index, fold into chart-4, the "Other" colour (M4).

test("series 0 to 4 take chart-1 to chart-5 in order", () => {
  expect([0, 1, 2, 3, 4].map(seriesColor)).toEqual([
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ]);
});

test("series 5 and beyond fold into chart-4", () => {
  expect(seriesColor(5)).toBe("var(--chart-4)");
  expect(seriesColor(9)).toBe("var(--chart-4)");
});

test("a negative index falls back to chart-4 rather than reading past the sequence", () => {
  expect(seriesColor(-1)).toBe("var(--chart-4)");
});
