import { expect, test } from "@playwright/test";
import * as corporateUtils from "../../app/corporate/corporateUtils";
import * as calcFormatters from "../../app/corporate/calculationDetailFormatters";
import * as graphShared from "../../app/corporate/components/graphs/shared";
import { MISSING } from "../../lib/format";

test.describe("corporate number helpers", () => {
  test("byte-identical output for ordinary values", () => {
    expect(corporateUtils.pct(12.3)).toBe("12.3%");
    expect(corporateUtils.pct2(4.25)).toBe("4.25%");
    expect(corporateUtils.numberText(1.23)).toBe("1.2");
    expect(corporateUtils.numberText2(1.1)).toBe("1.10");
    expect(corporateUtils.moneyText(240.5)).toBe("$240.5");
    expect(corporateUtils.moneyText(1234.5)).toBe("$1,234.5");
    expect(corporateUtils.pct(-3.2)).toBe("-3.2%");
  });

  test("accepted change: thousands separator on values >= 1000", () => {
    expect(corporateUtils.numberText(5000)).toBe("5,000.0");
    expect(corporateUtils.pct(5000)).toBe("5,000.0%");
  });

  test("accepted change: NaN prints the missing marker, not NaN", () => {
    expect(corporateUtils.pct(Number.NaN)).toBe(MISSING);
    expect(corporateUtils.numberText(Number.NaN)).toBe(MISSING);
  });

  test("accepted change: -0.04 at one digit prints 0.0, not -0.0", () => {
    expect(corporateUtils.pct(-0.04)).toBe("0.0%");
  });

  test("re-exports are the same function objects", () => {
    for (const name of ["pct", "pct2", "numberText", "numberText2", "moneyText"] as const) {
      expect(calcFormatters[name]).toBe(corporateUtils[name]);
    }
    for (const name of ["pct", "pct2", "numberText", "moneyText"] as const) {
      expect(graphShared[name]).toBe(corporateUtils[name]);
    }
  });
});
