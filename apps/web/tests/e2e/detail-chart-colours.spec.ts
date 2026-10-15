import { expect, test } from "@playwright/test";
import { detailChartColours } from "../../lib/detailChartColours";

// Pure function, no page. The detail chart passes these two props to the shared chart. Up
// candles must be the up token on every day: on a down day colorAccent is --down, and without
// upColor TVChart paints the up candles in that colour (the 2026-10-14 market-candle defect class).

test("a down day keeps up candles red: upColor is the up token, the accent follows the day", () => {
  expect(detailChartColours(-1.2)).toEqual({ colorAccent: "var(--down)", upColor: "var(--up)" });
});

test("an up day: the accent and the up candles are both the up token", () => {
  expect(detailChartColours(0.8)).toEqual({ colorAccent: "var(--up)", upColor: "var(--up)" });
});

test("a flat day counts as up, as the accent always has", () => {
  expect(detailChartColours(0)).toEqual({ colorAccent: "var(--up)", upColor: "var(--up)" });
});
