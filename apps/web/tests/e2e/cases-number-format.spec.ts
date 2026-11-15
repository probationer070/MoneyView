import { expect, test } from "@playwright/test";
import { CASE_FIELDS, fmtPercent, formatWire, englishTr } from "../../app/cases/caseFields";
import { fmtMoney, fmtPerShare, fmtSigned } from "../../app/cases/format";
import { formatNumber, MISSING } from "../../lib/format";

const field = (name: string) => CASE_FIELDS.find((f) => f.field === name)!;

test.describe("cases number helpers (wrap formatNumber, ASCII minus)", () => {
  test("fmtMoney: variable precision, comma, ASCII minus, missing", () => {
    expect(fmtMoney(8000)).toBe("8,000");
    expect(fmtMoney(4946.3)).toBe("4,946.3");
    expect(fmtMoney(1234567.89)).toBe("1,234,567.9");
    expect(fmtMoney(-250.5)).toBe("-250.5");
    expect(fmtMoney(0)).toBe("0");
    expect(fmtMoney(Number.NaN)).toBe(MISSING);
  });

  test("fmtSigned: plus, ASCII minus, zero, comma, missing", () => {
    expect(fmtSigned(6.14)).toBe("+6.14");
    expect(fmtSigned(-6.14)).toBe("-6.14");
    expect(fmtSigned(0)).toBe("+0.00");
    expect(fmtSigned(1234.5)).toBe("+1,234.50");
    expect(fmtSigned(-1234.5)).toBe("-1,234.50");
    expect(fmtSigned(-0.81)).not.toContain("−");
    expect(fmtSigned(Number.NaN)).toContain(MISSING);
  });

  test("fmtPercent: fraction to percent with digits", () => {
    expect(fmtPercent(0.074, 2)).toBe("7.40%");
    expect(fmtPercent(-0.074, 1)).toBe("-7.4%");
    expect(fmtPercent(0, 1)).toBe("0.0%");
    expect(fmtPercent(12.5, 1)).toBe("1,250.0%");
    expect(fmtPercent(Number.NaN, 1)).toBe(MISSING);
  });

  test("formatWire: rate, money, count, missing", () => {
    expect(formatWire(field("terminal_growth"), 0.025, englishTr)).toBe("2.50%");
    expect(formatWire(field("terminal_growth"), -0.01, englishTr)).toBe("-1.00%");
    expect(formatWire(field("terminal_growth"), 0, englishTr)).toBe("0.00%");
    expect(formatWire(field("cash"), 8000, englishTr)).toBe("8,000");
    expect(formatWire(field("cash"), 4946.3, englishTr)).toBe("4,946.3");
    expect(formatWire(field("cash"), -1234.56789, englishTr)).toBe("-1,234.5679");
    expect(formatWire(field("cash"), 0, englishTr)).toBe("0");
    expect(formatWire(field("cash"), Number.NaN, englishTr)).toBe(MISSING);
    expect(formatWire(field("cash"), null, englishTr)).toBe(englishTr("cases.notSet"));
  });

  test("fmtPerShare unchanged", () => {
    expect(fmtPerShare(-3.5)).toBe("-3.50");
  });

  test("formatNumber minDigits/maxDigits", () => {
    expect(formatNumber(8000, "ratio", { minDigits: 0, maxDigits: 1 })).toBe("8,000");
    expect(formatNumber(4946.34, "ratio", { minDigits: 0, maxDigits: 1 })).toBe("4,946.3");
    expect(formatNumber(1.5, "ratio", { minDigits: 1, maxDigits: 3 })).toBe("1.5");
    expect(formatNumber(1.23456, "ratio", { maxDigits: 3 })).toBe("1.235");
    expect(formatNumber(2, "ratio")).toBe("2.00");
    expect(formatNumber(5, "integer", { minDigits: 0, maxDigits: 4 })).toBe("5");
  });
});
