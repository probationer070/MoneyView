import { expect, test } from "@playwright/test";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate, type MessageKey } from "../../lib/i18n/translate";

// Keys added for MetricAuditPanel. The English values are the
// strings these components rendered before the move; existing e2e assertions depend on them.
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
const NEW_KEYS = AUDIT_KEYS as MessageKey[];

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
  expect(translate(en, "metricAudit.unavailableTitle", { title: "ROIC" })).toBe("ROIC audit unavailable");
  expect(translate(en, "metricAudit.calculationVersion", { version: "v2" })).toBe("Calculation version: v2");
  expect(translate(en, "metricAudit.asOf", { date: "2026-01-02" })).toBe("As of 2026-01-02");
});

test("Korean headings and labels differ from English", () => {
  for (const key of [
    "metricAudit.unavailableDescription",
    "metricAudit.source",
  ] as MessageKey[]) {
    expect(translate(ko, key), key).not.toBe(translate(en, key));
    expect(translate(ko, key), key).toMatch(/[가-힣]/);
  }
});

test("Korean parameter placeholders survive interpolation", () => {
  expect(translate(ko, "metricAudit.unavailableTitle", { title: "ROIC" })).toContain("ROIC");
});
