import { expect, test } from "@playwright/test";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate, type MessageKey } from "../../lib/i18n/translate";
import { impliedReturnRefusalText } from "../../lib/impliedReturn";
import { formatAuditMetricValue, metricAuditReason } from "../../lib/metricAudit";
import type { CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { formatDateLabel, portfolioComparisonUniverseLabel, type PortfolioStock } from "../../app/portfolio/page";
import { buildPortfolioTickerMetrics } from "../../app/portfolio/portfolioMetrics";

type Params = Record<string, string | number>;
const koT = (key: MessageKey, params?: Params) => translate(ko, key, params);

function auditEntry(overrides: Partial<CorporateMetricAuditEntry>): CorporateMetricAuditEntry {
  return { quality: "ok", display_value: "12.00%", reason: null, warnings: [], ...overrides } as CorporateMetricAuditEntry;
}

test("impliedReturnRefusalText: default is the original English, ko translator gives Korean", () => {
  expect(impliedReturnRefusalText(null)).toBe("Not recorded before metric v3.");
  expect(impliedReturnRefusalText("no_price")).toBe("No current price, so there is no market value to solve against.");
  expect(impliedReturnRefusalText("not_a_code")).toBe("not_a_code");

  expect(impliedReturnRefusalText(null, "en", koT)).not.toBe("Not recorded before metric v3.");
  expect(impliedReturnRefusalText(null, "en", koT)).toMatch(/[가-힣]/);
  expect(impliedReturnRefusalText("no_price", "en", koT)).toBe("현재가가 없어 비교할 시장 가치가 없습니다.");
});

test("formatAuditMetricValue: default N/A is English, ko translator gives Korean", () => {
  const missing = auditEntry({ quality: "missing", display_value: "" });
  expect(formatAuditMetricValue(missing)).toBe("N/A");
  expect(formatAuditMetricValue(auditEntry({}))).toBe("12.00%");
  expect(formatAuditMetricValue(missing, koT)).toBe(translate(ko, "metricAudit.notAvailable"));
  expect(formatAuditMetricValue(missing, koT)).toMatch(/[가-힣]/);
});

test("metricAuditReason: default fallback is the original English, ko translator gives Korean", () => {
  expect(metricAuditReason(auditEntry({}))).toBe("No additional audit note.");
  expect(metricAuditReason(auditEntry({ reason: "Server says so." }))).toBe("Server says so.");
  expect(metricAuditReason(auditEntry({}), koT)).toBe(translate(ko, "metricAudit.noNote"));
  expect(metricAuditReason(auditEntry({}), koT)).toMatch(/[가-힣]/);
});

test("portfolioComparisonUniverseLabel and formatDateLabel: default English, ko translator gives Korean", () => {
  expect(portfolioComparisonUniverseLabel("custom")).toBe("Custom Universe");
  expect(portfolioComparisonUniverseLabel("portfolio")).toBe("Portfolio + Benchmark");
  expect(portfolioComparisonUniverseLabel("custom", koT)).toBe(translate(ko, "portfolio.universe.custom"));
  expect(portfolioComparisonUniverseLabel("portfolio", koT)).toBe(translate(ko, "portfolio.universe.portfolioBenchmark"));
  expect(portfolioComparisonUniverseLabel("custom", koT)).toMatch(/[가-힣]/);

  expect(formatDateLabel("")).toBe("N/A");
  expect(formatDateLabel("", koT)).toBe(translate(ko, "portfolio.noDate"));
  expect(formatDateLabel("", koT)).toMatch(/[가-힣]/);
});

test("catalogs define the new groups in en and ko", () => {
  expect(en.impliedReturn.notRecorded).toBe("Not recorded before metric v3.");
  expect(en.metricAudit.noNote).toBe("No additional audit note.");
  expect(en.metricAudit.notAvailable).toBe("N/A");
  expect(en.portfolio.universe.custom).toBe("Custom Universe");
  expect(en.portfolio.universe.portfolioBenchmark).toBe("Portfolio + Benchmark");
  expect(en.portfolio.noDate).toBe("N/A");
  expect(Object.keys(ko.impliedReturn)).toEqual(Object.keys(en.impliedReturn));
  expect(Object.keys(ko.metricAudit)).toEqual(Object.keys(en.metricAudit));
  expect(Object.keys(ko.portfolio.universe)).toEqual(Object.keys(en.portfolio.universe));
});

test("buildPortfolioTickerMetrics: a reader reason follows the ko translator, default is the original English", () => {
  const input: Parameters<typeof buildPortfolioTickerMetrics>[0] = {
    watchlist: [{ ticker: "AAA", sparkline: [] }] as unknown as PortfolioStock[],
    activeComparisonData: null,
    comparisonData: null,
    portfolioComparisonUniverse: "portfolio_plus_benchmark",
    portfolioComparisonQueryHasData: false,
    activeSnapshotMeta: null,
    estimateVolatilityFromSparkline: () => null,
  };
  expect(buildPortfolioTickerMetrics(input).AAA.volatility.reason).toBe("Not enough price history to estimate volatility.");

  const reason = buildPortfolioTickerMetrics({ ...input, t: koT }).AAA.volatility.reason;
  expect(reason).toBe(translate(ko, "portfolio.metricReason.volatilityMissing"));
  expect(reason).toMatch(/[가-힣]/);
});
