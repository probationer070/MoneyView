import { expect, test } from "@playwright/test";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate, type MessageKey } from "../../lib/i18n/translate";

// Keys added for AttributionWaterfall and MetricAuditPanel. The English values are the
// strings these components rendered before the move; existing e2e assertions depend on them.
const WATERFALL_KEYS = [
  "attribution.waterfall.effects.allocation.name",
  "attribution.waterfall.effects.allocation.represents",
  "attribution.waterfall.effects.allocation.calculation",
  "attribution.waterfall.effects.selection.name",
  "attribution.waterfall.effects.selection.represents",
  "attribution.waterfall.effects.selection.calculation",
  "attribution.waterfall.effects.interaction.name",
  "attribution.waterfall.effects.interaction.represents",
  "attribution.waterfall.effects.interaction.calculation",
  "attribution.waterfall.effects.activeReturn.name",
  "attribution.waterfall.effects.activeReturn.represents",
  "attribution.waterfall.effects.activeReturn.calculation",
  "attribution.waterfall.driver.none",
  "attribution.waterfall.driver.top",
  "attribution.waterfall.emptyTitle",
  "attribution.waterfall.emptyDescription",
  "attribution.waterfall.tooltipLabel",
  "attribution.waterfall.tooltipDescription",
  "attribution.waterfall.details",
  "attribution.waterfall.dialogLabel",
  "attribution.waterfall.methodologyTitle",
  "attribution.waterfall.methodologySubtitle",
  "attribution.waterfall.close",
  "attribution.waterfall.calculationLabel",
  "attribution.waterfall.largestDriverLabel",
];
const AUDIT_KEYS = [
  "metricAudit.unavailableTitle",
  "metricAudit.unavailableDescription",
  "metricAudit.source",
  "metricAudit.unavailable",
  "metricAudit.asOf",
  "metricAudit.calculationVersion",
  "metricAudit.method",
  "metricAudit.confidence",
];
const NEW_KEYS = [...WATERFALL_KEYS, ...AUDIT_KEYS] as MessageKey[];

function lookup(catalog: object, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
}

test("every new shared-panel key is a non-empty string in both en and ko", () => {
  for (const key of NEW_KEYS) {
    expect(lookup(en, key), `en.${key}`).toEqual(expect.any(String));
    expect(lookup(ko, key), `ko.${key}`).toEqual(expect.any(String));
    expect(String(lookup(ko, key)).trim(), `ko.${key} non-empty`).not.toBe("");
  }
});

test("English values are the strings the components rendered before the move", () => {
  expect(translate(en, "attribution.waterfall.tooltipLabel")).toBe("Attribution Effects (%)");
  expect(translate(en, "attribution.waterfall.methodologyTitle")).toBe("Attribution Effects Methodology");
  expect(translate(en, "attribution.waterfall.emptyTitle")).toBe("No attribution effects available");
  expect(translate(en, "attribution.waterfall.driver.top", { sector: "Tech", value: "1.00%" })).toBe(
    "Largest sector driver: Tech contributed 1.00%.",
  );
  expect(translate(en, "metricAudit.unavailableTitle", { title: "ROIC" })).toBe("ROIC audit unavailable");
  expect(translate(en, "metricAudit.calculationVersion", { version: "v2" })).toBe("Calculation version: v2");
  expect(translate(en, "metricAudit.asOf", { date: "2026-01-02" })).toBe("As of 2026-01-02");
});

test("Korean headings and labels differ from English", () => {
  for (const key of [
    "attribution.waterfall.tooltipLabel",
    "attribution.waterfall.methodologyTitle",
    "attribution.waterfall.emptyTitle",
    "attribution.waterfall.details",
    "attribution.waterfall.close",
    "metricAudit.unavailableDescription",
    "metricAudit.source",
  ] as MessageKey[]) {
    expect(translate(ko, key), key).not.toBe(translate(en, key));
    expect(translate(ko, key), key).toMatch(/[가-힣]/);
  }
});

test("Korean parameter placeholders survive interpolation", () => {
  expect(translate(ko, "metricAudit.unavailableTitle", { title: "ROIC" })).toContain("ROIC");
  expect(translate(ko, "attribution.waterfall.driver.top", { sector: "기술", value: "1.00%" })).toContain("1.00%");
});
