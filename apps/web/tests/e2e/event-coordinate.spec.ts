import { expect, test } from "@playwright/test";
import { eventCoordinate } from "../../components/charts/primitives/EventLinesPrimitive";

/**
 * Pure placement rules for event lines, without a browser.
 *
 * A fake `timeToCoordinate` maps each bar to its index times 10, so a result names exactly which
 * bar (or which gap) the line was placed on.
 */

function coordinates(barTimes: readonly string[]) {
  return (time: string) => {
    const index = barTimes.indexOf(time);
    return index === -1 ? null : index * 10;
  };
}

test.describe("daily bars", () => {
  const DAILY = ["2026-02-26", "2026-02-27", "2026-03-02", "2026-03-03"];

  test("an event on a trading day sits on that day's bar", () => {
    expect(eventCoordinate("2026-02-27", DAILY, coordinates(DAILY))).toBe(10);
  });

  test("a weekend event sits midway between the bars that bracket it", () => {
    expect(eventCoordinate("2026-02-28", DAILY, coordinates(DAILY))).toBe(15);
  });

  test("an event after the last loaded day is not drawn", () => {
    expect(eventCoordinate("2026-03-04", DAILY, coordinates(DAILY))).toBeNull();
  });
});

test.describe("monthly bars", () => {
  // As aggregateMonthlyBars dates them: each month's bar carries its FIRST trading day. So the
  // event's day almost never matches a bar, and bracketing it between bars asserts it happened
  // between two months -- or, in the newest month, that it is outside the chart altogether.
  const MONTHLY = ["2026-01-02", "2026-02-02", "2026-03-02"];

  test("an event mid-month sits on its month's bar, not between two months", () => {
    expect(eventCoordinate("2026-02-28", MONTHLY, coordinates(MONTHLY), "month")).toBe(10);
  });

  test("an event in the newest month, after that month's first bar, is still drawn", () => {
    expect(eventCoordinate("2026-03-20", MONTHLY, coordinates(MONTHLY), "month")).toBe(20);
  });

  test("an event on the month's first trading day sits on the same bar", () => {
    expect(eventCoordinate("2026-02-02", MONTHLY, coordinates(MONTHLY), "month")).toBe(10);
  });

  test("an event in a month that is not loaded is not drawn", () => {
    expect(eventCoordinate("2025-12-15", MONTHLY, coordinates(MONTHLY), "month")).toBeNull();
    expect(eventCoordinate("2026-04-01", MONTHLY, coordinates(MONTHLY), "month")).toBeNull();
  });
});
