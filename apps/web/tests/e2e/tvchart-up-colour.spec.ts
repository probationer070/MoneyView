import { expect, test } from "@playwright/test";
import { candleUpColour } from "../../lib/candleColours";

// Pure function, no page. TVChart paints its up candles with candleUpColour, so the accent never
// reaches them. On a down day the detail chart passes colorAccent="var(--down)" and no upColor of
// its own; the up candles must still be the up token (the 2026-10-14 market defect, recurring on
// the detail page). Mutation: `upColor ?? colorAccent` in candleUpColour fails the first test.

test("an accent of --down does not recolour up candles", () => {
  expect(candleUpColour({ colorAccent: "var(--down)" })).toBe("var(--up)");
});

test("an explicit upColor is used as given, whatever the accent", () => {
  expect(candleUpColour({ colorAccent: "var(--down)", upColor: "var(--chart-1)" })).toBe("var(--chart-1)");
});
