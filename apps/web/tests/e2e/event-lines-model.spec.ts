import { expect, test } from "@playwright/test";
import { eventsNearX, placeEventLines, type EventLineSpec } from "../../components/charts/primitives/EventLinesPrimitive";
import { buildEventLines, eventProvenance } from "../../lib/eventLines";

/** Pure rules for turning events into coloured lines and finding the ones under the pointer. */

const BARS = ["2026-02-26", "2026-02-27", "2026-03-02", "2026-03-03"];
const at = (time: string) => {
  const index = BARS.indexOf(time);
  return index === -1 ? null : index * 10;
};

function line(overrides: Partial<EventLineSpec>): EventLineSpec {
  return { id: "e", label: "Event", date: "2026-02-27", color: "#E54545", ...overrides };
}

const category = (overrides: Record<string, unknown>) => ({
  id: "fomc", label: "Fed rate decisions", color: "#E54545", origin: "builtin" as const, visible: true, overridden: false, ...overrides,
});

const event = (overrides: Record<string, unknown>) => ({
  id: "fomc-2026-02-27", label: "FOMC: hold at 3.50–3.75%", category: "fomc", start_date: "2026-02-27",
  end_date: null, source: "https://www.federalreserve.gov/x.htm", note: "", origin: "builtin" as const, missing_category: null,
  ...overrides,
});

test.describe("buildEventLines", () => {
  test("a visible category's event becomes a line in that category's colour", () => {
    const [built] = buildEventLines([event({})], [category({ color: "#0000FF" })]);
    expect(built).toEqual({
      id: "fomc-2026-02-27", label: "FOMC: hold at 3.50–3.75%", date: "2026-02-27", endDate: null,
      color: "#0000FF", categoryLabel: "Fed rate decisions", note: "", source: "https://www.federalreserve.gov/x.htm", origin: "builtin",
    });
  });

  test("an event in a hidden category is not a line", () => {
    expect(buildEventLines([event({})], [category({ visible: false })])).toEqual([]);
  });

  test("an event whose category is absent from the list is not drawn in an invented colour", () => {
    expect(buildEventLines([event({ category: "gone" })], [category({})])).toEqual([]);
  });
});

test.describe("placeEventLines", () => {
  test("events on the same bar share one line that lists every distinct colour once", () => {
    const placed = placeEventLines(
      [line({ id: "a", color: "#E54545" }), line({ id: "b", color: "#7C5CFF" }), line({ id: "c", color: "#E54545" })],
      BARS, at, "day",
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].x).toBe(10);
    expect(placed[0].events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(placed[0].colors).toEqual(["#E54545", "#7C5CFF"]);
  });

  test("an event outside the loaded bars is not placed", () => {
    expect(placeEventLines([line({ date: "2025-01-15" })], BARS, at, "day")).toEqual([]);
  });

  test("lines come back ordered by x", () => {
    const placed = placeEventLines([line({ id: "late", date: "2026-03-03" }), line({ id: "early", date: "2026-02-26" })], BARS, at, "day");
    expect(placed.map((p) => p.events[0].id)).toEqual(["early", "late"]);
  });
});

test.describe("eventsNearX", () => {
  const placed = placeEventLines([line({ id: "fri", date: "2026-02-27" }), line({ id: "tue", date: "2026-03-03" })], BARS, at, "day");

  test("a pointer within tolerance of a line hits that line's events, anchored at the line", () => {
    expect(eventsNearX(14, placed)).toEqual({ x: 10, events: [expect.objectContaining({ id: "fri" })] });
  });

  test("a pointer beyond tolerance hits nothing", () => {
    expect(eventsNearX(17, placed)).toBeNull();
  });

  test("when two lines are within tolerance, the nearer one anchors and both are listed nearest first", () => {
    const close = placeEventLines([line({ id: "a", date: "2026-02-27" }), line({ id: "b", date: "2026-03-02" })], BARS, (t) => (t === "2026-02-27" ? 10 : t === "2026-03-02" ? 14 : null), "day");
    expect(eventsNearX(13, close)).toEqual({ x: 14, events: [expect.objectContaining({ id: "b" }), expect.objectContaining({ id: "a" })] });
  });
});

test.describe("eventProvenance", () => {
  test("a built-in event names its source's host", () => {
    expect(eventProvenance(line({ origin: "builtin", source: "https://www.federalreserve.gov/a.htm" }))).toBe("Source: www.federalreserve.gov");
  });

  test("a user event without a source says so", () => {
    expect(eventProvenance(line({ origin: "user", source: null }))).toBe("Added by you, no source");
  });

  test("a user event with a source says both", () => {
    expect(eventProvenance(line({ origin: "user", source: "https://example.com/n" }))).toBe("Added by you · Source: example.com");
  });
});
