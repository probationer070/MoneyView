import { expect, test } from "@playwright/test";
import { MISSING, formatNumber } from "../../lib/format";

test("each kind has its default digits and suffix", () => {
  expect(formatNumber(1234.5, "price")).toBe("1,234.50");
  expect(formatNumber(0.1234, "percent")).toBe("12.3%");
  expect(formatNumber(0.8512, "ratio")).toBe("0.85");
  expect(formatNumber(12.34, "multiple")).toBe("12.3x");
  expect(formatNumber(1234.5, "integer")).toBe("1,235");
  expect(formatNumber(1_234_000_000, "compact")).toBe("1.2B");
});

test("korean compact uses 억/조 units", () => {
  expect(formatNumber(1_234_000_000, "compact", { locale: "ko" })).toBe("12.3억");
});

test("sign rules: ASCII hyphen-minus, + only when asked", () => {
  expect(formatNumber(0.123, "percent", { signed: true })).toBe("+12.3%");
  expect(formatNumber(-1234.5, "price")).toBe("-1,234.50");
});

test("rounded negative zero has no sign", () => {
  expect(formatNumber(-0.0004, "percent")).toBe("0.0%");
  expect(formatNumber(-0.0004, "percent", { signed: true })).toBe("0.0%");
});

test("missing and non-finite values render the missing glyph", () => {
  for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatNumber(v, "price")).toBe(MISSING);
});

test("an explicit digits option overrides the kind default", () => {
  expect(formatNumber(0.1234, "percent", { digits: 2 })).toBe("12.34%");
  expect(formatNumber(1234.5, "price", { digits: 0 })).toBe("1,235");
});

test("the missing glyph is the em dash", () => {
  expect(MISSING).toBe("—");
});

test("korean compact climbs to 조 and keeps the minus", () => {
  expect(formatNumber(1_234_000_000_000, "compact", { locale: "ko" })).toBe("1.2조");
  expect(formatNumber(-123_400_000, "compact", { locale: "ko" })).toBe("-1.2억");
});
