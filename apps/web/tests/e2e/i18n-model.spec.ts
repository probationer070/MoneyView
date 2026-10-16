import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LABELS } from "../../lib/i18n/labels";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate } from "../../lib/i18n/translate";
import { detectLocale, useLocale } from "../../lib/i18n/locale";

test("lookup, interpolation and unknown-key fallback", () => {
  expect(translate(en, "nav.valuation")).toBe("Valuation");
  expect(translate(ko, "nav.valuation")).toBe("가치평가");
  expect(translate(en, "common.updatedAgo", { minutes: 5 })).toBe("Updated 5 min ago");
  expect(translate(en, "nav.nope" as never)).toBe("nav.nope");
});

test("stored choice wins, then a Korean browser, else English", () => {
  expect(detectLocale("en", "ko-KR")).toBe("en");
  expect(detectLocale(null, "ko-KR")).toBe("ko");
  expect(detectLocale("fr", "en-US")).toBe("en");
});

test("every ko leaf and every label half is non-empty; label Korean contains Hangul", () => {
  const leaves = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : leaves(v)));
  expect(leaves(ko).filter((s) => !s.trim())).toEqual([]);
  for (const [key, [kr, eng]] of Object.entries(LABELS)) {
    expect(/[가-힣]/.test(kr), `${key} Korean half`).toBe(true);
    expect(/^[A-Za-z0-9 .&/-]+$/.test(eng), `${key} English half`).toBe(true);
  }
});

test("every en key has a non-empty ko string (a missing key is not a type-only concern)", () => {
  const paths = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : paths(v, `${prefix}${k}.`)));
  const lookup = (o: object, path: string) => path.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], o);
  for (const path of paths(en)) {
    expect(lookup(ko, path), `ko.${path}`).toEqual(expect.any(String));
    expect(String(lookup(ko, path)).trim(), `ko.${path} non-empty`).not.toBe("");
  }
});

test("server render takes the English snapshot and never reads window", () => {
  const Probe = () => createElement("span", null, useLocale().locale);
  expect(renderToString(createElement(Probe))).toBe("<span>en</span>");
});
