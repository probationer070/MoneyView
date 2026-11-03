import type { DcfSummaryResponse as DCFResult } from "../../../../packages/shared-types";
import type { CalculationDetail, CalculationDetailKey, CalculationRow } from "./components/calculationDetailTypes";
import { bridgedEstimatedValue, bridgedUpsidePct, UNBRIDGED_PLACEHOLDER } from "@/lib/bridgeQuality";
import type { useT } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/translate";
import { valueQuadrant, type ValueQuadrant } from "./valueQuadrant";
import { betaInterpretation, clamp, moneyText, numberText, numberText2, pct, pct2 } from "./calculationDetailFormatters";

type Tr = ReturnType<typeof useT>;

const QUADRANT_KEY: Record<ValueQuadrant, MessageKey> = {
  growthCreates: "corporate.calc.quadrant.growthCreates",
  returnCash: "corporate.calc.quadrant.returnCash",
  fixReturns: "corporate.calc.quadrant.fixReturns",
  restructure: "corporate.calc.quadrant.restructure",
};

interface AnnualMetricPoint {
  year: number;
  value: number | null;
}

interface CorporateAssumptionsSnapshot {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debtRatio: number;
  unleveredBeta: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  marketShare: number;
  governance: number;
  esgPenalty: number;
}

interface DerivedSnapshot {
  debtToEquity: number;
  leveredBeta: number;
  bottomUpKe: number;
  spread: number;
  sustainableGrowth: number;
  /** True when leveredBeta and bottomUpKe are the backend WACC's own (plan 2026-11-02 §6.3). */
  keFromWacc?: boolean;
}

interface ImpliedErpInputsSnapshot {
  indexLevel: number;
  dividendYield: number;
  buybackYield: number;
  growthRates: number[];
  stableGrowth: number;
}

interface MetricsHistorySnapshot {
  growth_cagr: number | null;
  growth_recent_average: number | null;
}

interface ValueMatrixPoint {
  name: string;
  growth: number;
  spread: number;
  fcff: number;
}

interface BuildCalculationDetailsArgs {
  companyName: string;
  assumptions: CorporateAssumptionsSnapshot;
  derived: DerivedSnapshot;
  dcfData?: DCFResult;
  sourceLabel: string;
  storageKey: string;
  taxRate: number;
  /** Percent. The ERP inside Ke and WACC; the implied ERP is a reference only. */
  equityRiskPremium: number;
  riskFreeRate: number;
  koreaCountryRiskPremium: number;
  growthBasisLabel: string;
  roicBasisLabel: string;
  annualGrowthRates: AnnualMetricPoint[];
  annualRoicValues: AnnualMetricPoint[];
  metricsHistoryData?: MetricsHistorySnapshot;
  impliedErpInputs: ImpliedErpInputsSnapshot;
  impliedMarketReturn: number;
  impliedErp: number;
  hasSp500Data: boolean;
  valueMatrix: ValueMatrixPoint[];
  t: Tr;
}

export function buildCalculationDetails({
  companyName,
  assumptions,
  derived,
  dcfData,
  sourceLabel,
  storageKey,
  taxRate,
  equityRiskPremium,
  riskFreeRate,
  koreaCountryRiskPremium,
  growthBasisLabel,
  roicBasisLabel,
  annualGrowthRates,
  annualRoicValues,
  metricsHistoryData,
  impliedErpInputs,
  impliedMarketReturn,
  impliedErp,
  hasSp500Data,
  valueMatrix,
  t,
}: BuildCalculationDetailsArgs): Record<CalculationDetailKey, CalculationDetail> {
  // Every fair-value and upside string below is one of these two, never the raw field. When
  // the equity bridge does not resolve, estimated_value is an enterprise value and upside_pct
  // is a hardcoded 0.0, and this modal is where a suppressed table cell sends the reader.
  const fairValueText = (pending: string) => {
    if (!dcfData) return pending;
    const value = bridgedEstimatedValue(dcfData);
    return value === null ? UNBRIDGED_PLACEHOLDER : moneyText(value);
  };
  const upsideText = (pending: string) => {
    if (!dcfData) return pending;
    const upside = bridgedUpsidePct(dcfData);
    return upside === null ? UNBRIDGED_PLACEHOLDER : pct(upside);
  };
  // Measured by the backend as PV(terminal) / enterprise value. Unlike fair value it does
  // not depend on the equity bridge -- concentration is a property of the enterprise
  // valuation -- but it does require a valuation to have run.
  //
  // The presence check is a runtime one rather than a null check on a typed number: a result
  // restored from the sessionStorage cache can have been written by a build that predates
  // this field, and the type it is read back as cannot know that.
  const terminalShareText = (pending: string) => {
    if (!dcfData) return pending;
    const share = dcfData.terminal_value_share_pct;
    return share == null ? "N/A" : pct(share);
  };

  const assumptionDetail = ({
    title,
    label,
    value,
    unit,
    rawInputs,
    source,
    timeHorizon,
    formula,
    simulation,
    auditMetric,
  }: {
    title: string;
    label: string;
    value: string;
    unit: string;
    rawInputs: CalculationRow[];
    source: string;
    timeHorizon: string;
    formula: string;
    simulation: CalculationRow[];
    auditMetric?: "growth" | "roic" | "wacc" | "spread";
  }): CalculationDetail => ({
    title: `${companyName} ${title}`,
    timeHorizon,
    summary: [
      { label, value, source: t("corporate.calc.common.finalAssumption") },
      { label: t("corporate.calc.common.ticker"), value: assumptions.ticker, source: t("corporate.calc.common.registry") },
      { label: t("corporate.calc.common.unit"), value: unit, source: t("corporate.calc.common.displayConvention") },
      ...rawInputs,
    ],
    components: rawInputs,
    formula,
    result: value,
    sourcing: [
      { label: t("corporate.calc.common.primaryOrigin"), value: source, source },
      { label: t("corporate.calc.common.localPersistence"), value: "corporate_metrics", source: "SQLite" },
      { label: t("corporate.calc.common.browserOverride"), value: storageKey, source: t("corporate.calc.common.localStorageFallback") },
      { label: t("corporate.calc.common.fallbackModel"), value: t("corporate.calc.common.fallbackModelValue"), source: t("corporate.calc.common.fallbackModelSource") },
    ],
    simulation,
    auditMetric,
  });

  return {
    realtime: {
      title: t("corporate.calc.realtime.title", { company: companyName }),
      timeHorizon: t("corporate.calc.realtime.timeHorizon"),
      summary: [
        { label: t("corporate.calc.common.growthRate"), value: pct(assumptions.growth), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: t("corporate.calc.common.debtRatio"), value: pct(assumptions.debtRatio), source: sourceLabel },
        { label: t("corporate.calc.common.unleveredBeta"), value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: t("corporate.calc.common.countryRiskPremium"), value: pct(koreaCountryRiskPremium), source: t("corporate.calc.common.crpSource") },
        { label: "FCFF", value: `$${numberText(assumptions.fcff)}B`, source: sourceLabel },
      ],
      components: [
        { label: t("corporate.calc.realtime.components.tickerMapping"), value: companyName, source: t("corporate.calc.common.registry") },
        { label: t("corporate.calc.realtime.components.storageKey"), value: assumptions.ticker, source: t("corporate.calc.realtime.components.storageKeySource") },
        { label: t("corporate.calc.realtime.components.persistenceLayer"), value: "corporate_metrics", source: "SQLite" },
        { label: t("corporate.calc.realtime.components.frontendCache"), value: storageKey, source: t("corporate.calc.realtime.components.frontendCacheSource") },
      ],
      formula: t("corporate.calc.realtime.formula"),
      result: t("corporate.calc.realtime.result", {
        company: companyName,
        wacc: pct(assumptions.wacc),
        roic: pct(assumptions.roic),
        beta: numberText(assumptions.unleveredBeta),
      }),
      sourcing: [
        { label: t("corporate.calc.realtime.sourcing.companyName"), value: companyName, source: t("corporate.calc.realtime.sourcing.companyNameSource") },
        { label: t("corporate.calc.realtime.sourcing.financialAssumptions"), value: t("corporate.calc.realtime.sourcing.financialAssumptionsValue"), source: t("corporate.calc.realtime.sourcing.financialAssumptionsSource") },
        { label: t("corporate.calc.realtime.sourcing.generatedDefaults"), value: t("corporate.calc.realtime.sourcing.generatedDefaultsValue"), source: t("corporate.calc.realtime.sourcing.generatedDefaultsSource") },
        { label: t("corporate.calc.realtime.sourcing.marketPrice"), value: dcfData ? moneyText(dcfData.current_price) : t("corporate.calc.common.loading"), source: t("corporate.calc.realtime.sourcing.marketPriceSource") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.realtime.sim.readStatements", { ticker: assumptions.ticker }), source: t("corporate.calc.realtime.sim.readStatementsSource") },
        { label: "2", value: t("corporate.calc.realtime.sim.applyOverride", { key: storageKey }), source: t("corporate.calc.realtime.sim.applyOverrideSource") },
        {
          label: "3",
          value: t("corporate.calc.realtime.sim.render", {
            growth: pct(assumptions.growth),
            roic: pct(assumptions.roic),
            wacc: pct(assumptions.wacc),
          }),
          source: t("corporate.calc.realtime.sim.renderSource"),
        },
      ],
    },
    growth: {
      title: t("corporate.calc.growth.title", { company: companyName }),
      timeHorizon: t("corporate.calc.growth.timeHorizon", { basis: growthBasisLabel }),
      summary: [
        { label: t("corporate.calc.common.growthRate"), value: pct(assumptions.growth), source: sourceLabel },
        { label: t("corporate.calc.growth.summary.selectedBasis"), value: growthBasisLabel, source: t("corporate.calc.growth.summary.selectedBasisSource") },
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: t("corporate.calc.growth.summary.sustainableGrowth"), value: pct(derived.sustainableGrowth), source: t("corporate.calc.growth.summary.sustainableGrowthSource") },
      ],
      components: [
        { label: t("corporate.calc.growth.components.userInput"), value: pct(assumptions.growth), source: t("corporate.calc.growth.components.userInputSource") },
        { label: t("corporate.calc.growth.components.cagr5"), value: metricsHistoryData?.growth_cagr == null ? t("corporate.calc.common.unavailable") : pct(metricsHistoryData.growth_cagr), source: t("corporate.calc.growth.components.cagrSource") },
        { label: t("corporate.calc.growth.components.recentAverage"), value: metricsHistoryData?.growth_recent_average == null ? t("corporate.calc.common.unavailable") : pct(metricsHistoryData.growth_recent_average), source: t("corporate.calc.growth.components.recentAverageSource") },
        ...annualGrowthRates.map((point) => ({ label: t("corporate.calc.growth.components.annualGrowth", { year: point.year }), value: point.value == null ? t("corporate.calc.common.unavailable") : pct(point.value), source: t("corporate.calc.growth.components.annualGrowthSource") })),
        { label: t("corporate.calc.growth.components.displayOverride"), value: t("corporate.calc.growth.components.displayOverrideValue"), source: t("corporate.calc.growth.components.displayOverrideSource") },
      ],
      formula: t("corporate.calc.growth.formula"),
      result: pct(assumptions.growth),
      sourcing: [
        { label: t("corporate.calc.common.growthRate"), value: pct(assumptions.growth), source: t("corporate.calc.growth.sourcing.growthSource") },
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: t("corporate.calc.growth.sourcing.reinvestmentSource") },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.growth.sourcing.roicSource") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.growth.sim.readRevenue"), source: t("corporate.calc.growth.sim.readRevenueSource") },
        { label: "2", value: t("corporate.calc.growth.sim.applyBasis", { basis: growthBasisLabel }), source: sourceLabel },
        { label: "3", value: pct(assumptions.growth), source: t("corporate.calc.growth.sim.finalGrowthSource") },
      ],
      auditMetric: "growth",
    },
    roic: assumptionDetail({
      title: t("corporate.calc.roic.name"),
      label: t("corporate.calc.roic.name"),
      value: pct(assumptions.roic),
      unit: t("corporate.calc.common.percent"),
      rawInputs: [
        { label: t("corporate.calc.roic.raw.nopatProxy"), value: pct(assumptions.roic), source: t("corporate.calc.roic.raw.nopatProxySource") },
        { label: t("corporate.calc.roic.raw.investedCapital"), value: t("corporate.calc.roic.raw.investedCapitalValue"), source: t("corporate.calc.roic.raw.investedCapitalSource") },
        { label: t("corporate.calc.roic.raw.selectedBasis"), value: roicBasisLabel, source: t("corporate.calc.roic.raw.selectedBasisSource") },
        ...annualRoicValues.map((point) => ({ label: t("corporate.calc.roic.raw.yearRoic", { year: point.year }), value: point.value == null ? t("corporate.calc.common.unavailable") : pct(point.value), source: t("corporate.calc.roic.raw.yearRoicSource") })),
      ],
      source: t("corporate.calc.roic.source"),
      timeHorizon: t("corporate.calc.roic.timeHorizon", { basis: roicBasisLabel }),
      formula: t("corporate.calc.roic.formula"),
      auditMetric: "roic",
      simulation: [
        { label: "1", value: `${pct(assumptions.roic)} / 100.0`, source: numberText(assumptions.roic / 100) },
        { label: "2", value: `${numberText(assumptions.roic / 100)} x 100`, source: pct(assumptions.roic) },
        { label: "3", value: pct(assumptions.roic), source: t("corporate.calc.roic.sim.finalSource") },
      ],
    }),
    wacc: assumptionDetail({
      title: t("corporate.calc.wacc.name"),
      label: t("corporate.calc.wacc.name"),
      value: pct(assumptions.wacc),
      unit: t("corporate.calc.common.percent"),
      rawInputs: [
        { label: t("corporate.calc.wacc.raw.costOfEquity"), value: pct(derived.bottomUpKe), source: t("corporate.calc.wacc.raw.costOfEquitySource") },
        { label: t("corporate.calc.wacc.raw.debtRatio"), value: pct(assumptions.debtRatio), source: t("corporate.calc.wacc.raw.debtRatioSource") },
        { label: t("corporate.calc.wacc.raw.taxRate"), value: pct(taxRate * 100), source: t("corporate.calc.wacc.raw.taxRateSource") },
      ],
      source: t("corporate.calc.wacc.source"),
      timeHorizon: t("corporate.calc.wacc.timeHorizon"),
      formula: t("corporate.calc.wacc.formula"),
      auditMetric: "wacc",
      simulation: [
        { label: "1", value: t("corporate.calc.wacc.sim.selectedInput", { value: pct(assumptions.wacc) }), source: sourceLabel },
        { label: "2", value: t("corporate.calc.wacc.sim.compareKe", { value: pct(derived.bottomUpKe) }), source: t("corporate.calc.wacc.sim.compareKeSource", { value: pct(assumptions.roic - assumptions.wacc) }) },
        { label: "3", value: pct(assumptions.wacc), source: t("corporate.calc.wacc.sim.finalSource") },
      ],
    }),
    debtRatio: assumptionDetail({
      title: t("corporate.calc.debtRatio.name"),
      label: t("corporate.calc.debtRatio.name"),
      value: pct(assumptions.debtRatio),
      unit: t("corporate.calc.debtRatio.unit"),
      rawInputs: [
        { label: t("corporate.calc.debtRatio.raw.debtWeight"), value: pct(assumptions.debtRatio), source: t("corporate.calc.debtRatio.raw.debtWeightSource") },
        { label: t("corporate.calc.debtRatio.raw.equityWeight"), value: pct(100 - assumptions.debtRatio), source: t("corporate.calc.debtRatio.raw.equityWeightSource") },
      ],
      source: t("corporate.calc.debtRatio.source"),
      timeHorizon: t("corporate.calc.debtRatio.timeHorizon"),
      formula: t("corporate.calc.debtRatio.formula"),
      simulation: [
        { label: "1", value: t("corporate.calc.debtRatio.sim.debtWeight", { value: pct(assumptions.debtRatio) }), source: sourceLabel },
        { label: "2", value: `100.0% - ${pct(assumptions.debtRatio)} = ${pct(100 - assumptions.debtRatio)}`, source: t("corporate.calc.debtRatio.sim.equityWeight") },
        { label: "3", value: pct(assumptions.debtRatio), source: t("corporate.calc.debtRatio.sim.finalSource") },
      ],
    }),
    unleveredBeta: assumptionDetail({
      title: t("corporate.calc.unleveredBeta.name"),
      label: t("corporate.calc.unleveredBeta.name"),
      value: numberText(assumptions.unleveredBeta),
      unit: t("corporate.calc.unleveredBeta.unit"),
      rawInputs: [
        { label: t("corporate.calc.unleveredBeta.raw.rawBeta"), value: numberText(assumptions.unleveredBeta), source: t("corporate.calc.unleveredBeta.raw.rawBetaSource") },
        { label: t("corporate.calc.common.leveredBeta"), value: numberText2(derived.leveredBeta), source: t("corporate.calc.unleveredBeta.raw.leveredBetaSource") },
        { label: t("corporate.calc.unleveredBeta.raw.betaDifference"), value: numberText2(derived.leveredBeta - assumptions.unleveredBeta), source: t("corporate.calc.unleveredBeta.raw.betaDifferenceSource") },
        { label: t("corporate.calc.unleveredBeta.raw.betaInterpretation"), value: betaInterpretation(assumptions.unleveredBeta, t), source: t("corporate.calc.unleveredBeta.raw.betaInterpretationSource") },
        { label: t("corporate.calc.unleveredBeta.raw.debtToEquity"), value: numberText(derived.debtToEquity), source: t("corporate.calc.unleveredBeta.raw.debtToEquitySource") },
      ],
      source: t("corporate.calc.unleveredBeta.source"),
      timeHorizon: t("corporate.calc.unleveredBeta.timeHorizon"),
      formula: t("corporate.calc.unleveredBeta.formula"),
      simulation: [
        { label: "1", value: t("corporate.calc.unleveredBeta.sim.useBetaU", { value: numberText(assumptions.unleveredBeta) }), source: sourceLabel },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "3", value: numberText(assumptions.unleveredBeta), source: t("corporate.calc.unleveredBeta.sim.finalSource") },
      ],
    }),
    leveredBeta: {
      title: t("corporate.calc.leveredBeta.title", { company: companyName }),
      timeHorizon: t("corporate.calc.leveredBeta.timeHorizon"),
      summary: [
        { label: t("corporate.calc.common.leveredBeta"), value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? t("corporate.calc.leveredBeta.summary.fromWacc") : t("corporate.calc.common.hamadaFormula") },
        { label: t("corporate.calc.leveredBeta.summary.interpretation"), value: betaInterpretation(derived.leveredBeta, t), source: t("corporate.calc.leveredBeta.summary.interpretationSource") },
        { label: t("corporate.calc.common.unleveredBeta"), value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: t("corporate.calc.leveredBeta.summary.debtEquity"), value: numberText(derived.debtToEquity), source: t("corporate.calc.leveredBeta.summary.debtEquitySource", { debt: pct(assumptions.debtRatio), equity: pct(100 - assumptions.debtRatio) }) },
        { label: t("corporate.calc.leveredBeta.summary.taxShield"), value: pct((1 - taxRate) * 100), source: t("corporate.calc.leveredBeta.summary.taxShieldSource", { rate: pct(taxRate * 100) }) },
      ],
      components: [
        { label: t("corporate.calc.leveredBeta.components.beta1"), value: t("corporate.calc.leveredBeta.components.beta1Value"), source: t("corporate.calc.leveredBeta.components.beta1Source") },
        { label: t("corporate.calc.leveredBeta.components.betaAbove"), value: t("corporate.calc.leveredBeta.components.betaAboveValue"), source: t("corporate.calc.leveredBeta.components.betaAboveSource") },
        { label: t("corporate.calc.leveredBeta.components.betaBelow"), value: t("corporate.calc.leveredBeta.components.betaBelowValue"), source: t("corporate.calc.leveredBeta.components.betaBelowSource") },
        { label: t("corporate.calc.leveredBeta.components.businessRisk"), value: numberText(assumptions.unleveredBeta), source: t("corporate.calc.leveredBeta.components.businessRiskSource") },
        { label: t("corporate.calc.leveredBeta.components.financialLeverage"), value: numberText(derived.debtToEquity), source: t("corporate.calc.leveredBeta.components.financialLeverageSource") },
        { label: t("corporate.calc.leveredBeta.components.taxShield"), value: pct((1 - taxRate) * 100), source: t("corporate.calc.leveredBeta.components.taxShieldSource") },
      ],
      formula: t("corporate.calc.leveredBeta.formula"),
      result: numberText2(derived.leveredBeta),
      sourcing: [
        { label: t("corporate.calc.common.unleveredBeta"), value: numberText(assumptions.unleveredBeta), source: t("corporate.calc.leveredBeta.sourcing.unleveredSource") },
        { label: t("corporate.calc.common.debtRatio"), value: pct(assumptions.debtRatio), source: t("corporate.calc.leveredBeta.sourcing.debtRatioSource") },
        { label: t("corporate.calc.common.taxRate"), value: pct(taxRate * 100), source: t("corporate.calc.leveredBeta.sourcing.taxRateSource") },
      ],
      simulation: [
        { label: "1", value: `D/E = ${pct(assumptions.debtRatio)} / ${pct(100 - assumptions.debtRatio)}`, source: numberText(derived.debtToEquity) },
        { label: "2", value: `1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}`, source: numberText(1 + (1 - taxRate) * derived.debtToEquity) },
        { label: "3", value: `${numberText(assumptions.unleveredBeta)} x ${numberText(1 + (1 - taxRate) * derived.debtToEquity)}`, source: numberText2(derived.leveredBeta) },
      ],
    },
    crp: assumptionDetail({
      title: t("corporate.calc.crp.name"),
      label: t("corporate.calc.crp.name"),
      value: pct(koreaCountryRiskPremium),
      unit: t("corporate.calc.crp.unit"),
      rawInputs: [
        { label: t("corporate.calc.crp.raw.crpLabel"), value: pct(koreaCountryRiskPremium), source: t("corporate.calc.common.crpSource") },
      ],
      source: t("corporate.calc.crp.source"),
      timeHorizon: t("corporate.calc.crp.timeHorizon"),
      formula: t("corporate.calc.crp.formula"),
      simulation: [
        { label: "1", value: t("corporate.calc.crp.sim.useCrp", { value: pct(koreaCountryRiskPremium) }), source: t("corporate.calc.common.crpSource") },
        { label: "2", value: t("corporate.calc.crp.sim.keFeed", { rf: pct(riskFreeRate), erp: pct(equityRiskPremium), crp: pct(koreaCountryRiskPremium) }), source: t("corporate.calc.crp.sim.keFeedSource") },
      ],
    }),
    erp: {
      title: t("corporate.calc.erp.title", { company: companyName }),
      timeHorizon: t("corporate.calc.erp.timeHorizon"),
      summary: [
        { label: t("corporate.calc.erp.summary.indexLevel"), value: numberText(impliedErpInputs.indexLevel), source: hasSp500Data ? t("corporate.calc.erp.summary.indexLevelMarketApi") : t("corporate.calc.erp.summary.indexLevelFallback") },
        { label: t("corporate.calc.erp.summary.expectedReturn"), value: pct(impliedMarketReturn), source: t("corporate.calc.erp.summary.expectedReturnSource") },
        { label: t("corporate.calc.erp.summary.impliedErp"), value: pct(impliedErp), source: t("corporate.calc.erp.summary.impliedErpSource") },
        { label: t("corporate.calc.common.leveredBeta"), value: numberText2(derived.leveredBeta), source: t("corporate.calc.common.hamadaFormula") },
        { label: t("corporate.calc.erp.summary.erpUsed"), value: pct(equityRiskPremium), source: t("corporate.calc.erp.summary.erpUsedSource") },
        { label: t("corporate.calc.erp.summary.betaErp"), value: pct(derived.leveredBeta * equityRiskPremium), source: t("corporate.calc.erp.summary.betaErpSource") },
        { label: t("corporate.calc.common.bottomUpKe"), value: pct(derived.bottomUpKe), source: t("corporate.calc.erp.summary.bottomUpKeSource") },
      ],
      components: [
        { label: t("corporate.calc.erp.components.currentPrice"), value: numberText(impliedErpInputs.indexLevel), source: t("corporate.calc.erp.components.currentPriceSource") },
        { label: t("corporate.calc.erp.components.cashFlows"), value: t("corporate.calc.erp.components.cashFlowsValue", { dividends: pct(impliedErpInputs.dividendYield), buybacks: pct(impliedErpInputs.buybackYield) }), source: t("corporate.calc.erp.components.cashFlowsSource") },
        { label: t("corporate.calc.erp.components.growthAssumptions"), value: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "), source: t("corporate.calc.erp.components.growthAssumptionsSource") },
        { label: t("corporate.calc.erp.components.stableGrowth"), value: pct(impliedErpInputs.stableGrowth), source: t("corporate.calc.erp.components.stableGrowthSource") },
        { label: t("corporate.calc.erp.components.impliedErp"), value: pct(impliedErp), source: t("corporate.calc.erp.components.impliedErpSource") },
        { label: t("corporate.calc.erp.components.betaMultiplier"), value: numberText2(derived.leveredBeta), source: t("corporate.calc.common.leveredBeta") },
        { label: t("corporate.calc.erp.components.contribution"), value: pct(derived.leveredBeta * equityRiskPremium), source: t("corporate.calc.erp.components.contributionSource", { erp: pct(equityRiskPremium) }) },
      ],
      formula: t("corporate.calc.erp.formula"),
      result: pct(derived.leveredBeta * equityRiskPremium),
      sourcing: [
        { label: t("corporate.calc.erp.sourcing.sp500Price"), value: numberText(impliedErpInputs.indexLevel), source: t("corporate.calc.erp.sourcing.sp500PriceSource") },
        { label: t("corporate.calc.erp.sourcing.cashFlowYield"), value: pct(impliedErpInputs.dividendYield + impliedErpInputs.buybackYield), source: t("corporate.calc.erp.sourcing.cashFlowYieldSource") },
        { label: t("corporate.calc.erp.sourcing.growth"), value: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "), source: t("corporate.calc.erp.sourcing.growthSource") },
        { label: t("corporate.calc.erp.sourcing.stableGrowth"), value: pct(impliedErpInputs.stableGrowth), source: t("corporate.calc.erp.sourcing.stableGrowthSource") },
        { label: t("corporate.calc.common.leveredBeta"), value: numberText2(derived.leveredBeta), source: t("corporate.calc.erp.sourcing.leveredBetaSource") },
        { label: t("corporate.calc.erp.sourcing.riskFree"), value: pct(riskFreeRate), source: t("corporate.calc.erp.sourcing.riskFreeSource") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.erp.sim.solveIrr", { price: numberText(impliedErpInputs.indexLevel) }), source: pct(impliedMarketReturn) },
        { label: "2", value: `${pct(impliedMarketReturn)} - ${pct(riskFreeRate)}`, source: pct(impliedErp) },
        { label: "3", value: t("corporate.calc.erp.sim.contribution", { beta: numberText2(derived.leveredBeta), erp: pct(equityRiskPremium) }), source: pct(derived.leveredBeta * equityRiskPremium) },
        { label: "4", value: `${pct(riskFreeRate)} + ${pct(derived.leveredBeta * equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    reinvestment: assumptionDetail({
      title: t("corporate.calc.reinvestment.name"),
      label: t("corporate.calc.reinvestment.name"),
      value: pct(assumptions.reinvestment),
      unit: t("corporate.calc.reinvestment.unit"),
      rawInputs: [
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: t("corporate.calc.reinvestment.raw.reinvestmentSource") },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.reinvestment.raw.roicSource") },
      ],
      source: t("corporate.calc.reinvestment.source"),
      timeHorizon: t("corporate.calc.reinvestment.timeHorizon"),
      formula: t("corporate.calc.reinvestment.formula"),
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `${numberText(assumptions.reinvestment)} x ${numberText(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "3", value: pct(assumptions.reinvestment), source: t("corporate.calc.reinvestment.sim.finalSource") },
      ],
    }),
    innovation: assumptionDetail({
      title: t("corporate.calc.innovation.name"),
      label: t("corporate.calc.innovation.name"),
      value: numberText(assumptions.innovation),
      unit: t("corporate.calc.common.score0to100"),
      rawInputs: [
        { label: t("corporate.calc.innovation.raw.score"), value: numberText(assumptions.innovation), source: t("corporate.calc.innovation.raw.scoreSource") },
      ],
      source: t("corporate.calc.innovation.source"),
      timeHorizon: t("corporate.calc.innovation.timeHorizon"),
      formula: t("corporate.calc.innovation.formula"),
      simulation: [
        { label: "1", value: t("corporate.calc.innovation.sim.normalize", { value: numberText(assumptions.innovation) }), source: t("corporate.calc.common.scale0to100") },
        { label: "2", value: numberText(assumptions.innovation), source: t("corporate.calc.innovation.sim.finalSource") },
      ],
    }),
    governance: assumptionDetail({
      title: t("corporate.calc.governance.name"),
      label: t("corporate.calc.governance.name"),
      value: numberText(assumptions.governance),
      unit: t("corporate.calc.common.score0to100"),
      rawInputs: [
        { label: t("corporate.calc.governance.raw.score"), value: numberText(assumptions.governance), source: t("corporate.calc.governance.raw.scoreSource") },
      ],
      source: t("corporate.calc.governance.source"),
      timeHorizon: t("corporate.calc.governance.timeHorizon"),
      formula: t("corporate.calc.governance.formula"),
      simulation: [
        { label: "1", value: numberText(assumptions.governance), source: t("corporate.calc.governance.sim.finalSource") },
      ],
    }),
    esgPenalty: assumptionDetail({
      title: t("corporate.calc.esgPenalty.name"),
      label: t("corporate.calc.esgPenalty.name"),
      value: numberText(assumptions.esgPenalty),
      unit: t("corporate.calc.esgPenalty.unit"),
      rawInputs: [
        { label: t("corporate.calc.esgPenalty.raw.score"), value: numberText(assumptions.esgPenalty), source: t("corporate.calc.esgPenalty.raw.scoreSource") },
      ],
      source: t("corporate.calc.esgPenalty.source"),
      timeHorizon: t("corporate.calc.esgPenalty.timeHorizon"),
      formula: t("corporate.calc.esgPenalty.formula"),
      simulation: [
        { label: "1", value: numberText(assumptions.esgPenalty), source: t("corporate.calc.esgPenalty.sim.finalSource") },
      ],
    }),
    spread: {
      title: t("corporate.calc.spread.title", { company: companyName }),
      timeHorizon: t("corporate.calc.spread.timeHorizon"),
      summary: [
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: t("corporate.calc.spread.spread"), value: pct(derived.spread), source: t("corporate.calc.shared.realtimeCalculation") },
        { label: t("corporate.calc.spread.status"), value: derived.spread >= 0 ? t("corporate.calc.spread.valueCreation") : t("corporate.calc.spread.valueDestruction"), source: t("corporate.calc.spread.ruleRoicWacc") },
      ],
      components: [
        { label: t("corporate.calc.spread.returnOnCapital"), value: pct(assumptions.roic), source: t("corporate.calc.shared.tickerMetric") },
        { label: t("corporate.calc.spread.waccFull"), value: pct(assumptions.wacc), source: t("corporate.calc.shared.tickerMetric") },
      ],
      formula: t("corporate.calc.spread.formula", { roic: pct(assumptions.roic), wacc: pct(assumptions.wacc) }),
      result: pct(derived.spread),
      sourcing: [
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.spread.roicSource") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.spread.waccSource") },
        { label: t("corporate.calc.spread.benchmark"), value: t("corporate.calc.spread.positiveSpread"), source: t("corporate.calc.spread.valueRule") },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`, source: pct(derived.spread) },
        { label: "2", value: `${numberText(assumptions.roic)} - ${numberText(assumptions.wacc)}`, source: numberText(derived.spread) },
        { label: "3", value: pct(derived.spread), source: t("corporate.calc.spread.finalSpread") },
      ],
      auditMetric: "spread",
    },
    bottomUpKe: {
      title: t("corporate.calc.bottomUpKe.title", { company: companyName }),
      timeHorizon: t("corporate.calc.bottomUpKe.timeHorizon"),
      summary: [
        { label: t("corporate.calc.shared.riskFreeRate"), value: pct(riskFreeRate), source: t("corporate.calc.bottomUpKe.manualMacro") },
        { label: t("corporate.calc.common.leveredBeta"), value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? t("corporate.calc.bottomUpKe.yahooBetaInWacc") : t("corporate.calc.bottomUpKe.hamadaNoWacc") },
        { label: t("corporate.calc.bottomUpKe.equityRiskPremium"), value: pct(equityRiskPremium), source: t("corporate.calc.bottomUpKe.policyErpSource") },
        { label: t("corporate.calc.common.countryRiskPremium"), value: pct(koreaCountryRiskPremium), source: t("corporate.calc.common.crpSource") },
        { label: t("corporate.calc.common.bottomUpKe"), value: pct(derived.bottomUpKe), source: derived.keFromWacc ? t("corporate.calc.bottomUpKe.keInWacc") : t("corporate.calc.bottomUpKe.reRelevered") },
      ],
      components: [
        { label: t("corporate.calc.common.unleveredBeta"), value: numberText(assumptions.unleveredBeta), source: t("corporate.calc.shared.tickerMetric") },
        { label: t("corporate.calc.bottomUpKe.debtEquity"), value: numberText(derived.debtToEquity), source: t("corporate.calc.bottomUpKe.debtRatioDetail", { debt: pct(assumptions.debtRatio), equity: pct(100 - assumptions.debtRatio) }) },
        { label: t("corporate.calc.bottomUpKe.taxShield"), value: pct((1 - taxRate) * 100), source: t("corporate.calc.bottomUpKe.taxRateDetail", { tax: pct(taxRate * 100) }) },
        { label: t("corporate.calc.common.leveredBeta"), value: numberText2(derived.leveredBeta), source: t("corporate.calc.bottomUpKe.betaFormula") },
      ],
      formula: `Ke = ${pct(riskFreeRate)} + ${numberText2(derived.leveredBeta)} x ${pct(equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`,
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: t("corporate.calc.shared.riskFreeRate"), value: pct(riskFreeRate), source: t("corporate.calc.bottomUpKe.manualMacro") },
        { label: "ERP", value: pct(equityRiskPremium), source: t("corporate.calc.bottomUpKe.policyErpSource") },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: t("corporate.calc.common.crpSource") },
        { label: t("corporate.calc.common.debtRatio"), value: pct(assumptions.debtRatio), source: t("corporate.calc.bottomUpKe.debtRatioSource") },
        { label: t("corporate.calc.common.unleveredBeta"), value: numberText(assumptions.unleveredBeta), source: t("corporate.calc.bottomUpKe.unleveredBetaSource") },
      ],
      simulation: [
        { label: "1", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "2", value: `${pct(riskFreeRate)} + ${numberText2(derived.leveredBeta)} x ${pct(equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
        { label: "3", value: pct(derived.bottomUpKe), source: t("corporate.calc.bottomUpKe.finalKe") },
      ],
    },
    backendDcf: {
      title: t("corporate.calc.intrinsicDcf.title", { company: companyName }),
      timeHorizon: t("corporate.calc.intrinsicDcf.timeHorizon"),
      summary: [
        { label: t("corporate.calc.intrinsicDcf.intrinsicValue"), value: fairValueText(t("corporate.calc.shared.calculating")), source: t("corporate.calc.shared.backendDcfEngine") },
        { label: t("corporate.calc.shared.currentPrice"), value: dcfData ? moneyText(dcfData.current_price) : t("corporate.calc.common.loading"), source: t("corporate.calc.shared.priceCache") },
        { label: t("corporate.calc.intrinsicDcf.upsideDownside"), value: upsideText(t("corporate.calc.common.loading")), source: t("corporate.calc.shared.realtimeCalculation") },
        { label: t("corporate.calc.intrinsicDcf.status"), value: dcfData?.status ?? t("corporate.calc.shared.calculating"), source: t("corporate.calc.intrinsicDcf.dcfValueRule") },
      ],
      components: [
        { label: t("corporate.calc.intrinsicDcf.revenueGrowth"), value: pct(assumptions.growth), source: t("corporate.calc.shared.realtimeControl") },
        { label: t("corporate.calc.intrinsicDcf.marginProxy"), value: pct(clamp(assumptions.roic, -100, 100)), source: t("corporate.calc.intrinsicDcf.marginSource") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.shared.realtimeControl") },
        { label: t("corporate.calc.intrinsicDcf.terminalGrowth"), value: dcfData ? pct(dcfData.terminal_growth_used * 100) : t("corporate.calc.common.loading"), source: t("corporate.calc.intrinsicDcf.terminalSource") },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.shared.realtimeControl") },
      ],
      formula: t("corporate.calc.intrinsicDcf.formula", { growth: pct(assumptions.growth), wacc: pct(assumptions.wacc), fcff: moneyText(assumptions.fcff) }),
      result: dcfData
        ? t("corporate.calc.intrinsicDcf.resultValue", { value: fairValueText(t("corporate.calc.shared.calculating")), upside: upsideText(t("corporate.calc.common.loading")) })
        : t("corporate.calc.shared.calculating"),
      sourcing: [
        { label: t("corporate.calc.shared.endpoint"), value: `/corporate/dcf/${assumptions.ticker}`, source: t("corporate.calc.shared.fastApi") },
        { label: t("corporate.calc.shared.assumptions"), value: t("corporate.calc.intrinsicDcf.debouncedUi"), source: t("corporate.calc.intrinsicDcf.uiSource") },
        { label: t("corporate.calc.intrinsicDcf.marketPrice"), value: dcfData ? moneyText(dcfData.current_price) : t("corporate.calc.common.loading"), source: t("corporate.calc.shared.priceCache") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.intrinsicDcf.sendPayload", { growth: pct(assumptions.growth), wacc: pct(assumptions.wacc), fcff: moneyText(assumptions.fcff) }), source: t("corporate.calc.shared.dcfRequestPayload") },
        {
          label: "2",
          value: dcfData
            ? t("corporate.calc.intrinsicDcf.dcfStep", { value: fairValueText(t("corporate.calc.shared.calculating")), price: moneyText(dcfData.current_price) })
            : t("corporate.calc.shared.waitingBackend"),
          source: upsideText(t("corporate.calc.common.loading")),
        },
        {
          label: "3",
          value: dcfData ? t("corporate.calc.intrinsicDcf.valueIntrinsic", { value: fairValueText(t("corporate.calc.shared.calculating")) }) : t("corporate.calc.shared.calculating"),
          source: t("corporate.calc.shared.backendDcfFinal"),
        },
      ],
    },
    sustainableGrowth: {
      title: t("corporate.calc.sustainableGrowth.title", { company: companyName }),
      timeHorizon: t("corporate.calc.sustainableGrowth.timeHorizon"),
      summary: [
        { label: t("corporate.calc.shared.sustainableGrowth"), value: pct(derived.sustainableGrowth), source: t("corporate.calc.shared.realtimeCalculation") },
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: t("corporate.calc.sustainableGrowth.userGrowthRate"), value: pct(assumptions.growth), source: t("corporate.calc.shared.realtimeControl") },
      ],
      components: [
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: t("corporate.calc.sustainableGrowth.reinvestmentShare") },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.sustainableGrowth.roicReturn") },
        { label: t("corporate.calc.sustainableGrowth.growthGap"), value: pct(assumptions.growth - derived.sustainableGrowth), source: t("corporate.calc.sustainableGrowth.growthGapSource") },
      ],
      formula: t("corporate.calc.sustainableGrowth.formula", { reinvestment: pct(assumptions.reinvestment), roic: pct(assumptions.roic) }),
      result: pct(derived.sustainableGrowth),
      sourcing: [
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: t("corporate.calc.sustainableGrowth.reinvestmentSource") },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.sustainableGrowth.roicSource") },
        { label: t("corporate.calc.sustainableGrowth.comparisonGrowth"), value: pct(assumptions.growth), source: t("corporate.calc.sustainableGrowth.comparisonSource") },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `${numberText(assumptions.reinvestment)} x ${numberText(assumptions.roic)} / 100`, source: numberText(derived.sustainableGrowth) },
        { label: "3", value: pct(derived.sustainableGrowth), source: t("corporate.calc.sustainableGrowth.finalSustainable") },
      ],
    },
    hurdleDecomposition: {
      title: t("corporate.calc.hurdle.title", { company: companyName }),
      timeHorizon: t("corporate.calc.hurdle.timeHorizon"),
      summary: [
        { label: t("corporate.calc.shared.riskFreeRate"), value: pct(riskFreeRate), source: t("corporate.calc.hurdle.fredMacro") },
        { label: t("corporate.calc.hurdle.expectedReturn"), value: pct(impliedMarketReturn), source: t("corporate.calc.hurdle.expectedReturnSource") },
        { label: t("corporate.calc.hurdle.impliedErp"), value: pct2(impliedErp), source: t("corporate.calc.hurdle.impliedErpSource") },
        { label: t("corporate.calc.hurdle.betaErp"), value: pct(derived.leveredBeta * equityRiskPremium), source: t("corporate.calc.hurdle.betaErpSource", { erp: pct(equityRiskPremium) }) },
        { label: t("corporate.calc.hurdle.crp"), value: pct(koreaCountryRiskPremium), source: t("corporate.calc.common.crpSource") },
        { label: t("corporate.calc.common.bottomUpKe"), value: pct(derived.bottomUpKe), source: t("corporate.calc.hurdle.realtimeHurdle") },
      ],
      components: [
        { label: t("corporate.calc.shared.riskFreeRate"), value: pct(riskFreeRate), source: t("corporate.calc.hurdle.fredMacro") },
        { label: t("corporate.calc.hurdle.betaErp"), value: pct(derived.leveredBeta * equityRiskPremium), source: t("corporate.calc.hurdle.betaErpComponent", { beta: numberText2(derived.leveredBeta), erp: pct(equityRiskPremium) }) },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: t("corporate.calc.hurdle.crpComponentSource") },
      ],
      formula: t("corporate.calc.hurdle.formula"),
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: t("corporate.calc.hurdle.leveredBeta"), value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? t("corporate.calc.hurdle.betaInWacc") : t("corporate.calc.hurdle.relevered") },
        { label: "ERP", value: pct(equityRiskPremium), source: t("corporate.calc.hurdle.ermReference") },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: t("corporate.calc.hurdle.crpSource") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.hurdle.componentsSim"), source: t("corporate.calc.hurdle.hurdleComponents") },
        { label: "2", value: t("corporate.calc.hurdle.erpPolicy", { erp: pct(equityRiskPremium), implied: pct2(impliedErp) }), source: pct(equityRiskPremium) },
        { label: "3", value: t("corporate.calc.hurdle.leveredPremium", { beta: numberText2(derived.leveredBeta), erp: pct(equityRiskPremium) }), source: pct(derived.leveredBeta * equityRiskPremium) },
        { label: "4", value: `${pct(riskFreeRate)} + ${pct(derived.leveredBeta * equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    betaWaccCurve: {
      title: t("corporate.calc.bottomUpBeta.title", { company: companyName }),
      timeHorizon: t("corporate.calc.bottomUpBeta.timeHorizon"),
      summary: [
        { label: t("corporate.calc.common.unleveredBeta"), value: numberText2(assumptions.unleveredBeta), source: sourceLabel },
        { label: t("corporate.calc.bottomUpBeta.debtEquity"), value: numberText(derived.debtToEquity), source: t("corporate.calc.bottomUpBeta.debtEquitySource") },
        { label: t("corporate.calc.bottomUpBeta.financialBeta"), value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? t("corporate.calc.bottomUpBeta.betaInWacc") : t("corporate.calc.common.hamadaFormula") },
        { label: t("corporate.calc.bottomUpBeta.currentDebtRatio"), value: pct(assumptions.debtRatio), source: t("corporate.calc.bottomUpBeta.debtRatioSource") },
      ],
      components: [
        {
          label: t("corporate.calc.bottomUpBeta.betaUComponent"),
          value: numberText2(assumptions.unleveredBeta),
          source: t("corporate.calc.bottomUpBeta.betaUSource", { interpretation: betaInterpretation(assumptions.unleveredBeta, t) }),
        },
        {
          label: t("corporate.calc.bottomUpBeta.betaLComponent"),
          value: numberText2(derived.leveredBeta),
          source: t("corporate.calc.bottomUpBeta.betaLSource", {
            inWacc: derived.keFromWacc ? t("corporate.calc.bottomUpBeta.leveredInWacc") : t("corporate.calc.bottomUpBeta.reReleveredKe"),
            interpretation: betaInterpretation(derived.leveredBeta, t),
          }),
        },
      ],
      formula: t("corporate.calc.bottomUpBeta.formula"),
      result: t("corporate.calc.bottomUpBeta.result", { beta: numberText2(derived.leveredBeta), wacc: pct(assumptions.wacc) }),
      sourcing: [
        { label: t("corporate.calc.bottomUpBeta.betaUComponent"), value: numberText2(assumptions.unleveredBeta), source: t("corporate.calc.bottomUpBeta.betaUSourceFull") },
        {
          label: t("corporate.calc.bottomUpBeta.betaLComponent"),
          value: numberText2(derived.leveredBeta),
          source: derived.keFromWacc ? t("corporate.calc.bottomUpBeta.betaLSourceFull") : t("corporate.calc.bottomUpBeta.betaLSourceCalc"),
        },
        { label: t("corporate.calc.bottomUpBeta.betaConvention"), value: betaInterpretation(derived.leveredBeta, t), source: t("corporate.calc.bottomUpBeta.betaSourceNote") },
        { label: t("corporate.calc.common.debtRatio"), value: pct(assumptions.debtRatio), source: t("corporate.calc.bottomUpBeta.debtRatioAvg") },
        { label: t("corporate.calc.common.taxRate"), value: pct(taxRate * 100), source: t("corporate.calc.bottomUpBeta.taxAssumption") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.bottomUpBeta.debtEquityStep", { debt: pct(assumptions.debtRatio), equity: pct(100 - assumptions.debtRatio) }), source: numberText(derived.debtToEquity) },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
      ],
    },
    valueDriverMatrix: {
      title: t("corporate.calc.matrix.title", { company: companyName }),
      timeHorizon: t("corporate.calc.matrix.timeHorizon"),
      summary: [
        { label: t("corporate.calc.matrix.growth"), value: pct(assumptions.growth), source: t("corporate.calc.matrix.xAxis") },
        { label: "ROIC - WACC", value: pct(derived.spread), source: t("corporate.calc.matrix.yAxis") },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.matrix.bubbleSize") },
        { label: t("corporate.calc.matrix.quadrant"), value: t(QUADRANT_KEY[valueQuadrant(assumptions.growth, derived.spread, riskFreeRate)]), source: t("corporate.calc.matrix.quadrantSource", { riskFree: pct(riskFreeRate) }) },
      ],
      components: valueMatrix.map((item) => ({
        label: item.name,
        value: t("corporate.calc.matrix.componentValue", { growth: pct(item.growth), spread: pct(item.spread), fcff: numberText(item.fcff) }),
        source: item.name === companyName ? t("corporate.calc.matrix.currentSegment") : t("corporate.calc.matrix.watchlist"),
      })),
      formula: t("corporate.calc.matrix.formula"),
      result: t("corporate.calc.matrix.result", { growth: pct(assumptions.growth), spread: pct(derived.spread) }),
      sourcing: [
        { label: t("corporate.calc.matrix.growth"), value: pct(assumptions.growth), source: t("corporate.calc.shared.yahooRevenueAvg") },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.shared.yahooNopatAvg") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.shared.yahooStatementAvg") },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.shared.yahooFcffAvg") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.matrix.xStep", { growth: pct(assumptions.growth) }), source: t("corporate.calc.matrix.matrixX") },
        { label: "2", value: `Y = ${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`, source: pct(derived.spread) },
        { label: "3", value: t("corporate.calc.matrix.bubbleStep", { fcff: numberText(assumptions.fcff) }), source: numberText(clamp(assumptions.fcff / 1.6, 10, 100)) },
      ],
    },
    dcfCoreModules: {
      title: t("corporate.calc.dcfModules.title", { company: companyName }),
      timeHorizon: t("corporate.calc.dcfModules.timeHorizon"),
      summary: [
        { label: t("corporate.calc.shared.sustainableGrowth"), value: pct(derived.sustainableGrowth), source: t("corporate.calc.dcfModules.reinvestmentXRoic") },
        { label: t("corporate.calc.dcfModules.terminalValueShare"), value: terminalShareText(t("corporate.calc.shared.calculating")), source: t("corporate.calc.shared.backendDcfEngine") },
        { label: t("corporate.calc.dcfModules.fcffMagnitude"), value: `${moneyText(assumptions.fcff)}B`, source: sourceLabel },
        { label: t("corporate.calc.dcfModules.intrinsicValue"), value: fairValueText("N/A"), source: t("corporate.calc.shared.backendDcfEngine") },
      ],
      components: [
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: t("corporate.calc.dcfModules.sustainableComponent") },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.dcfModules.sustainableComponent") },
        { label: t("corporate.calc.dcfModules.growth"), value: pct(assumptions.growth), source: t("corporate.calc.dcfModules.projectedFcff") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.dcfModules.discountRate") },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.shared.yahooFcffAvg") },
      ],
      formula: t("corporate.calc.dcfModules.formula"),
      result: t("corporate.calc.dcfModules.result", { growth: pct(derived.sustainableGrowth), share: terminalShareText(t("corporate.calc.dcfModules.terminalShareCalc")) }),
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.shared.yahooFcffAvg") },
        { label: t("corporate.calc.shared.endpoint"), value: `/corporate/dcf/${assumptions.ticker}`, source: t("corporate.calc.shared.fastApi") },
        { label: t("corporate.calc.shared.currentPrice"), value: dcfData ? moneyText(dcfData.current_price) : t("corporate.calc.common.loading"), source: t("corporate.calc.shared.priceCache") },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: t("corporate.calc.dcfModules.pvStep"), source: terminalShareText(t("corporate.calc.shared.waitingBackend")) },
        {
          label: "3",
          value: dcfData ? t("corporate.calc.dcfModules.vsStep", { value: fairValueText("N/A"), price: moneyText(dcfData.current_price) }) : t("corporate.calc.shared.waitingBackend"),
          source: upsideText(t("corporate.calc.common.loading")),
        },
      ],
    },
    terminalValueShare: {
      title: t("corporate.calc.terminalShare.title", { company: companyName }),
      timeHorizon: t("corporate.calc.terminalShare.timeHorizon"),
      summary: [
        { label: t("corporate.calc.dcfModules.terminalValueShare"), value: terminalShareText(t("corporate.calc.shared.calculating")), source: t("corporate.calc.terminalShare.measureSource") },
        { label: t("corporate.calc.common.growthRate"), value: pct(assumptions.growth), source: t("corporate.calc.terminalShare.growthSummary") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.terminalShare.waccSummary") },
        { label: t("corporate.calc.terminalShare.whatItMeasures"), value: t("corporate.calc.terminalShare.measureValue"), source: t("corporate.calc.terminalShare.concentrationSource") },
      ],
      components: [
        { label: t("corporate.calc.terminalShare.pvTerminal"), value: t("corporate.calc.terminalShare.pvTerminalValue"), source: t("corporate.calc.terminalShare.numeratorSource") },
        { label: t("corporate.calc.terminalShare.enterpriseValue"), value: t("corporate.calc.terminalShare.enterpriseValueValue"), source: t("corporate.calc.terminalShare.denominatorSource") },
        { label: t("corporate.calc.terminalShare.terminalDenominator"), value: t("corporate.calc.terminalShare.denominatorValue", { wacc: pct(assumptions.wacc) }), source: t("corporate.calc.terminalShare.denominatorSensitivity") },
      ],
      formula: t("corporate.calc.terminalShare.formula"),
      result: terminalShareText(t("corporate.calc.shared.calculating")),
      sourcing: [
        { label: t("corporate.calc.common.growthRate"), value: pct(assumptions.growth), source: t("corporate.calc.terminalShare.growthSourceFull") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.terminalShare.waccSourceFull") },
        { label: t("corporate.calc.terminalShare.terminalModel"), value: t("corporate.calc.terminalShare.gordon"), source: "packages/core_finance/dcf.py" },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.terminalShare.discountExplicit"), source: t("corporate.calc.terminalShare.pvExplicit") },
        { label: "2", value: t("corporate.calc.terminalShare.discountTerminal"), source: t("corporate.calc.terminalShare.pvTerminalSource") },
        { label: "3", value: t("corporate.calc.terminalShare.shareStep"), source: terminalShareText(t("corporate.calc.shared.waitingBackend")) },
      ],
    },
    fcffMagnitude: {
      title: t("corporate.calc.fcff.title", { company: companyName }),
      timeHorizon: t("corporate.calc.fcff.timeHorizon"),
      summary: [
        { label: t("corporate.calc.fcff.magnitude"), value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.fcff.periodLtm", { source: sourceLabel }) },
        { label: "ROIC", value: pct(assumptions.roic), source: t("corporate.calc.fcff.operatingReturn") },
        { label: t("corporate.calc.common.reinvestmentRate"), value: pct(assumptions.reinvestment), source: t("corporate.calc.fcff.reinvestmentContext") },
        { label: t("corporate.calc.fcff.bubbleSizeProxy"), value: numberText(clamp(assumptions.fcff / 1.6, 10, 100)), source: t("corporate.calc.fcff.matrixScale") },
      ],
      components: [
        { label: t("corporate.calc.fcff.rawInput"), value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.shared.yahooFcffAvg") },
        { label: t("corporate.calc.fcff.valueMatrixScale"), value: numberText(clamp(assumptions.fcff / 1.6, 10, 100)), source: t("corporate.calc.fcff.clampSource") },
        { label: t("corporate.calc.shared.dcfPayload"), value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.fcff.payloadSource") },
      ],
      formula: t("corporate.calc.fcff.formula"),
      result: `${moneyText(assumptions.fcff)}B`,
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.fcff.fcffSource") },
        { label: t("corporate.calc.common.ticker"), value: assumptions.ticker, source: t("corporate.calc.common.registry") },
        { label: t("corporate.calc.shared.endpoint"), value: `/corporate/dcf/${assumptions.ticker}`, source: t("corporate.calc.fcff.fastApiPayload") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.fcff.readFcff", { fcff: moneyText(assumptions.fcff) }), source: sourceLabel },
        { label: "2", value: `clamp(${numberText(assumptions.fcff)} / 1.6, 10.0, 100.0)`, source: numberText(clamp(assumptions.fcff / 1.6, 10, 100)) },
        { label: "3", value: t("corporate.calc.fcff.sendFcff", { fcff: moneyText(assumptions.fcff) }), source: t("corporate.calc.shared.dcfPayload") },
      ],
    },
    backendFairValue: {
      title: t("corporate.calc.intrinsicDcfValue.title", { company: companyName }),
      timeHorizon: t("corporate.calc.intrinsicDcfValue.timeHorizon"),
      summary: [
        { label: t("corporate.calc.intrinsicDcfValue.intrinsicValue"), value: fairValueText("N/A"), source: t("corporate.calc.intrinsicDcfValue.backendPeriod") },
        { label: t("corporate.calc.shared.currentPrice"), value: dcfData ? moneyText(dcfData.current_price) : t("corporate.calc.common.loading"), source: t("corporate.calc.intrinsicDcfValue.priceSource") },
        { label: t("corporate.calc.intrinsicDcfValue.upsideDownside"), value: upsideText(t("corporate.calc.common.loading")), source: t("corporate.calc.intrinsicDcfValue.upsideSource") },
        { label: t("corporate.calc.intrinsicDcfValue.statusLabel"), value: dcfData?.status ?? t("corporate.calc.shared.calculating"), source: t("corporate.calc.intrinsicDcfValue.statusSource") },
      ],
      components: [
        { label: t("corporate.calc.intrinsicDcfValue.revenueGrowth"), value: pct(assumptions.growth), source: t("corporate.calc.intrinsicDcfValue.payloadPeriod") },
        { label: t("corporate.calc.intrinsicDcfValue.marginProxy"), value: pct(clamp(assumptions.roic, -100, 100)), source: t("corporate.calc.intrinsicDcfValue.marginPeriod") },
        { label: "WACC", value: pct(assumptions.wacc), source: t("corporate.calc.intrinsicDcfValue.marketSnapshot") },
        { label: t("corporate.calc.intrinsicDcfValue.terminalGrowth"), value: dcfData ? pct(dcfData.terminal_growth_used * 100) : t("corporate.calc.common.loading"), source: t("corporate.calc.intrinsicDcfValue.terminalSource") },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: t("corporate.calc.intrinsicDcfValue.fcffPeriod") },
      ],
      formula: t("corporate.calc.intrinsicDcfValue.formula"),
      result: fairValueText("N/A"),
      sourcing: [
        { label: t("corporate.calc.shared.endpoint"), value: `/corporate/dcf/${assumptions.ticker}`, source: t("corporate.calc.shared.fastApi") },
        { label: t("corporate.calc.shared.currentPrice"), value: dcfData ? moneyText(dcfData.current_price) : t("corporate.calc.common.loading"), source: t("corporate.calc.intrinsicDcfValue.priceSource") },
        { label: t("corporate.calc.shared.assumptions"), value: t("corporate.calc.intrinsicDcfValue.assumptionsValue"), source: t("corporate.calc.intrinsicDcfValue.assumptionsSource") },
      ],
      simulation: [
        { label: "1", value: t("corporate.calc.intrinsicDcfValue.postRequest", { growth: pct(assumptions.growth), wacc: pct(assumptions.wacc), terminal: pct(clamp(assumptions.growth, -10, 10)) }), source: t("corporate.calc.intrinsicDcfValue.backendRequest") },
        {
          label: "2",
          value: dcfData ? t("corporate.calc.intrinsicDcfValue.valueStep", { value: fairValueText("N/A"), price: moneyText(dcfData.current_price) }) : t("corporate.calc.shared.waitingBackend"),
          source: upsideText(t("corporate.calc.common.loading")),
        },
        { label: "3", value: fairValueText("N/A"), source: t("corporate.calc.intrinsicDcfValue.finalValue") },
      ],
    },
  };
}
