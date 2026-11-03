import { expect, test } from "@playwright/test";
import { buildCalculationDetails } from "../../app/corporate/buildCalculationDetails";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate, type MessageKey } from "../../lib/i18n/translate";

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
