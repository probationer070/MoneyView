import { expect, test } from "@playwright/test";
import { buildCalculationDetails } from "../../app/corporate/buildCalculationDetails";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate, type MessageKey } from "../../lib/i18n/translate";
import { basisLabels } from "../../app/corporate/basisLabels";
import { betaInterpretation } from "../../app/corporate/calculationDetailFormatters";

type Params = Record<string, string | number>;
const enT = (key: MessageKey, params?: Params) => translate(en, key, params);
const koT = (key: MessageKey, params?: Params) => translate(ko, key, params);

function build(t: (key: MessageKey, params?: Params) => string) {
  return buildCalculationDetails({
    companyName: "Acme",
    assumptions: {
      ticker: "ACME",
      growth: 5,
      roic: 12,
      wacc: 8,
      debtRatio: 30,
      unleveredBeta: 0.9,
      reinvestment: 40,
      fcff: 3,
      innovation: 50,
      marketShare: 10,
      governance: 60,
      esgPenalty: 20,
    },
    derived: { debtToEquity: 0.43, leveredBeta: 1.1, bottomUpKe: 9, spread: 4, sustainableGrowth: 2 },
    sourceLabel: "Live",
    storageKey: "moneyview.corporate",
    taxRate: 0.21,
    equityRiskPremium: 5.5,
    riskFreeRate: 3,
    koreaCountryRiskPremium: 0,
    growthBasisLabel: "Stable CAGR",
    roicBasisLabel: "Recent average",
    annualGrowthRates: [{ year: 2022, value: 4 }],
    annualRoicValues: [{ year: 2022, value: 12 }],
    impliedErpInputs: { indexLevel: 4000, dividendYield: 1.5, buybackYield: 1, growthRates: [5, 4, 3, 2, 1], stableGrowth: 3 },
    impliedMarketReturn: 8,
    impliedErp: 5,
    hasSp500Data: true,
    valueMatrix: [],
    t,
  });
}

test("ko calculation details are Korean and en reproduces the original English", () => {
  const ko$ = build(koT);
  const en$ = build(enT);

  // en is byte-identical to the English that was hard-coded before this change.
  expect(en$.reinvestment.title).toBe("Acme Reinvestment Rate");
  expect(en$.reinvestment.formula).toBe("Reinvestment Rate = Reinvestment / NOPAT x 100");
  expect(en$.wacc.timeHorizon).toBe("WACC uses the most recent available annual statement capital structure rather than a 5-year average.");
  expect(en$.wacc.formula).toBe("WACC = E/V x Ke + D/V x Kd x (1 - tax)");
  expect(en$.growth.summary[0].label).toBe("Growth Rate");
  expect(en$.innovation.summary[0].label).toBe("Innovation Index");

  // ko: titles, row labels and notes come from the Korean catalog.
  expect(ko$.reinvestment.title).toBe("Acme 재투자율");
  expect(ko$.reinvestment.summary[0].label).toBe("재투자율");
  expect(ko$.wacc.timeHorizon).toBe("WACC는 5년 평균이 아니라 가장 최근의 연간 재무제표 자본구조를 씁니다.");
  expect(ko$.wacc.formula).toBe("WACC = E/V x Ke + D/V x Kd x (1 - 세율)");
  expect(ko$.crp.title).toBe("Acme 국가위험프리미엄");
  expect(ko$.innovation.summary[0].label).toBe("혁신지수");
});

test("ko chart detail titles and labels for part B entries are Korean, and en keeps the English", () => {
  const ko$ = build(koT);
  const en$ = build(enT);

  // en is byte-identical to the English that was hard-coded before this change.
  expect(en$.bottomUpKe.title).toBe("Acme Bottom-up Ke");
  expect(en$.bottomUpKe.summary[0].label).toBe("Risk-free Rate");
  expect(en$.terminalValueShare.title).toBe("Acme Terminal Value Share");
  expect(en$.terminalValueShare.formula).toBe("Terminal Value Share = PV(terminal value) / enterprise value");
  expect(en$.sustainableGrowth.title).toBe("Acme Sustainable Growth");
  expect(en$.sustainableGrowth.summary[0].label).toBe("Sustainable Growth");

  // ko: part B titles, row labels and formula text come from the Korean catalog.
  expect(ko$.bottomUpKe.title).toBe("Acme 상향식 Ke");
  expect(ko$.bottomUpKe.summary[0].label).toBe("무위험수익률");
  expect(ko$.terminalValueShare.title).toBe("Acme 잔존가치 비중");
  expect(ko$.terminalValueShare.formula).toBe("잔존가치 비중 = PV(잔존가치) / 기업가치");
  expect(ko$.sustainableGrowth.title).toBe("Acme 지속가능 성장률");
  expect(ko$.sustainableGrowth.summary[0].label).toBe("지속가능 성장률");
});

test("betaInterpretation is Korean under ko and keeps the original English under en and by default", () => {
  expect(betaInterpretation(1.2, koT)).toBe("베타 1.20는 시장보다 약 20.0% 높은 변동성을 나타냅니다.");
  expect(betaInterpretation(0.8, koT)).toBe("베타 0.80는 시장보다 약 20.0% 낮은 변동성을 나타냅니다.");
  expect(betaInterpretation(1, koT)).toBe("베타 1.00은 시장 수준의 변동성을 의미합니다.");

  expect(betaInterpretation(1.2)).toBe("Beta 1.20 implies about 20.0% higher volatility than the market.");
  expect(betaInterpretation(1, enT)).toBe("Beta 1.00 implies market-level volatility.");
  expect(betaInterpretation(0.8, enT)).toBe("Beta 0.80 implies about 20.0% lower volatility than the market.");
});

test("basisLabels en reproduces the original English, including the annual year and the empty-year trim", () => {
  const annual = basisLabels(enT, {
    growthFallback: false,
    roicFallback: false,
    roicBasis: "annual",
    roicYear: "2023",
    lastRoicYear: 2022,
    roicYearMissing: false,
  });
  expect(annual.roicBasisLabel).toBe("annual 2023");
  expect(annual.growthBasisLabel).toBe("stable CAGR");
  expect(annual.roicYearUnavailableMessage).toBe("");
  expect(annual.sourceLabel).toBe(
    "Growth is using the stable CAGR derived from Yahoo annual revenue where available. ROIC is using the stabilized NOPAT / average invested-capital pipeline. Current slider/browser values and saved presets remain manual override layers.",
  );

  const empty = basisLabels(enT, {
    growthFallback: true,
    roicFallback: true,
    roicBasis: "annual",
    roicYear: "",
    lastRoicYear: undefined,
    roicYearMissing: true,
  });
  expect(empty.roicBasisLabel).toBe("annual");
  expect(empty.growthBasisLabel).toBe("stable CAGR unavailable; fallback assumption in use");
  expect(empty.roicYearUnavailableMessage).toBe(" ROIC unavailable from Yahoo statements. Retaining the current/manual ROIC value.");
  expect(empty.sourceLabel).toBe(
    "Growth is currently using a fallback assumption because stable CAGR was unavailable. ROIC is currently using a fallback assumption because the stable invested-capital pipeline was not decision-grade. Current slider/browser values and saved presets remain manual override layers.",
  );
});

test("basisLabels ko is Korean for the fallback and non-fallback cases", () => {
  const fallback = basisLabels(koT, {
    growthFallback: true,
    roicFallback: true,
    roicBasis: "annual",
    roicYear: "2023",
    lastRoicYear: 2022,
    roicYearMissing: true,
  });
  expect(fallback.growthBasisLabel).toBe("안정 CAGR을 구할 수 없어 대체 가정을 사용하고 있습니다");
  expect(fallback.roicBasisLabel).toBe("연간 2023");
  expect(fallback.roicYearUnavailableMessage).toBe("2023 ROIC를 야후 재무제표에서 구할 수 없습니다. 현재 값 또는 직접 입력한 ROIC 값을 유지합니다.");
  expect(fallback.sourceLabel).toBe(
    "안정 CAGR을 구할 수 없어 현재 성장률은 대체 가정을 사용하고 있습니다. 안정 투하자본 산출 경로가 의사결정에 쓸 수준이 아니어서 현재 ROIC는 대체 가정을 사용하고 있습니다. 현재 슬라이더·브라우저 값과 저장된 프리셋은 여전히 수동 재정의 계층으로 남습니다.",
  );

  const stable = basisLabels(koT, {
    growthFallback: false,
    roicFallback: false,
    roicBasis: "recent_average",
    roicYear: "",
    lastRoicYear: undefined,
    roicYearMissing: false,
  });
  expect(stable.growthBasisLabel).toBe("안정 CAGR");
  expect(stable.roicBasisLabel).toBe("최근 다년 평균");
  expect(stable.roicYearUnavailableMessage).toBe("");
  expect(stable.sourceLabel).toBe(
    "성장률은 야후 연간 매출에서 도출한 안정 CAGR을 가능한 경우 사용합니다. ROIC는 안정화된 NOPAT / 평균 투하자본 산출 경로를 사용합니다. 현재 슬라이더·브라우저 값과 저장된 프리셋은 여전히 수동 재정의 계층으로 남습니다.",
  );
});
