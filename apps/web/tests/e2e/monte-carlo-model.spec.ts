import { expect, test } from "@playwright/test";
import { formatKrwCompact, krwAxis } from "../../app/monte-carlo/lib/krwFormat";

// Pure model spec (no page): the KRW strings and the axis ticks are pinned here, in both locales.
test.describe("formatKrwCompact", () => {
  test("en pins the millions unit, the integer-won branch and the sign", () => {
    expect(formatKrwCompact(9_640_000, "en")).toBe("KRW 9.64M");
    expect(formatKrwCompact(950_000, "en")).toBe("KRW 950,000");
    expect(formatKrwCompact(-9_640_000, "en")).toBe("-KRW 9.64M");
    expect(formatKrwCompact(999_999.6, "en")).toBe("KRW 1.00M");
    expect(formatKrwCompact(0, "en")).toBe("KRW 0");
  });

  test("ko pins the 만원 unit, the 억 branch, the won branch and the sign", () => {
    expect(formatKrwCompact(9_640_000, "ko")).toBe("964만원");
    expect(formatKrwCompact(123_450_000, "ko")).toBe("1억 2,345만원");
    expect(formatKrwCompact(100_000_000, "ko")).toBe("1억원");
    expect(formatKrwCompact(9_500, "ko")).toBe("9,500원");
    expect(formatKrwCompact(-9_640_000, "ko")).toBe("-964만원");
  });

  test("ko unit edges use the rounded value: 만원 rounding and 억 rounding", () => {
    expect(formatKrwCompact(9_999.6, "ko")).toBe("1만원");
    expect(formatKrwCompact(99_995_000, "ko")).toBe("1억원");
    expect(formatKrwCompact(-0.4, "ko")).toBe("0원");
    expect(formatKrwCompact(1_234_567_890_000, "ko")).toBe("12,345억 6,789만원");
  });

  test("missing and non-finite values read as the dash, in both locales", () => {
    for (const locale of ["en", "ko"] as const) {
      expect(formatKrwCompact(Number.NaN, locale)).toBe("—");
      expect(formatKrwCompact(Number.POSITIVE_INFINITY, locale)).toBe("—");
      expect(formatKrwCompact(Number.NEGATIVE_INFINITY, locale)).toBe("—");
      expect(formatKrwCompact(null, locale)).toBe("—");
      expect(formatKrwCompact(undefined, locale)).toBe("—");
    }
  });
});

test.describe("krwAxis", () => {
  test("en ticks are millions with one decimal; ko ticks are 만원", () => {
    expect(krwAxis("en").tick(9_640_000)).toBe("9.6");
    expect(krwAxis("ko").tick(9_640_000)).toBe("964");
    expect(krwAxis("en").divisor).toBe(1_000_000);
    expect(krwAxis("ko").divisor).toBe(10_000);
    expect(krwAxis("en").unitKey).toBe("monteCarlo.units.krwAxis");
  });

  test("a non-finite tick reads as the dash", () => {
    expect(krwAxis("en").tick(Number.NaN)).toBe("—");
    expect(krwAxis("ko").tick(Number.NaN)).toBe("—");
  });
});
