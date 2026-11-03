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
        { label: t("corporate.calc.unleveredBeta.raw.betaInterpretation"), value: betaInterpretation(assumptions.unleveredBeta), source: t("corporate.calc.unleveredBeta.raw.betaInterpretationSource") },
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
        { label: t("corporate.calc.leveredBeta.summary.interpretation"), value: betaInterpretation(derived.leveredBeta), source: t("corporate.calc.leveredBeta.summary.interpretationSource") },
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
      title: `${companyName} ROIC - WACC Spread`,
      timeHorizon: "Realtime calculation from current ROIC and WACC assumptions.",
      summary: [
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: "Spread", value: pct(derived.spread), source: "Realtime calculation" },
        { label: "Status", value: derived.spread >= 0 ? "Value creation" : "Value destruction", source: "ROIC > WACC rule" },
      ],
      components: [
        { label: "Return on Invested Capital", value: pct(assumptions.roic), source: "Ticker-specific corporate metric" },
        { label: "Weighted Average Cost of Capital", value: pct(assumptions.wacc), source: "Ticker-specific corporate metric" },
      ],
      formula: `ROIC - WACC = ${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`,
      result: pct(derived.spread),
      sourcing: [
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values averaged from 2021 onward" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement average capital weights plus Yahoo beta and model rate inputs" },
        { label: "Benchmark", value: "Positive spread", source: "Corporate finance value-creation rule" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`, source: pct(derived.spread) },
        { label: "2", value: `${numberText(assumptions.roic)} - ${numberText(assumptions.wacc)}`, source: numberText(derived.spread) },
        { label: "3", value: pct(derived.spread), source: "Final ROIC - WACC spread" },
      ],
      auditMetric: "spread",
    },
    bottomUpKe: {
      title: `${companyName} Bottom-up Ke`,
      timeHorizon: "The Ke inside the WACC: fixed risk-free rate and ERP (model policy), the country risk premium by reporting currency, and the WACC's levered beta.",
      summary: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "Manual macro assumption" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? "Yahoo beta, the one inside the WACC" : "Hamada formula (no WACC beta for these metrics)" },
        { label: "Equity Risk Premium", value: pct(equityRiskPremium), source: "Model policy input, the same ERP as the WACC" },
        { label: "Country Risk Premium", value: pct(koreaCountryRiskPremium), source: "By reporting currency: USD, CAD, EUR 0%; otherwise 0.8%" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: derived.keFromWacc ? "The Ke inside the WACC" : "Re-levered with the WACC's ERP" },
      ],
      components: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Ticker-specific corporate metric" },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: `Debt Ratio ${pct(assumptions.debtRatio)} / Equity Ratio ${pct(100 - assumptions.debtRatio)}` },
        { label: "Tax Shield", value: pct((1 - taxRate) * 100), source: `1 - tax rate ${pct(taxRate * 100)}` },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "betaU x [1 + (1 - tax) x D/E]" },
      ],
      formula: `Ke = ${pct(riskFreeRate)} + ${numberText2(derived.leveredBeta)} x ${pct(equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`,
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "Manual macro assumption" },
        { label: "ERP", value: pct(equityRiskPremium), source: "Model policy input, the same ERP as the WACC" },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: "By reporting currency: USD, CAD, EUR 0%; otherwise 0.8%" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt ratios averaged from 2021 onward" },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo beta de-levered with averaged annual statement D/E and tax rate" },
      ],
      simulation: [
        { label: "1", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "2", value: `${pct(riskFreeRate)} + ${numberText2(derived.leveredBeta)} x ${pct(equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
        { label: "3", value: pct(derived.bottomUpKe), source: "Final Bottom-up Ke" },
      ],
    },
    backendDcf: {
      title: `${companyName} Intrinsic DCF`,
      timeHorizon: "Current realtime assumption set sent to the backend DCF endpoint; market price uses the latest available quote/cache point.",
      summary: [
        { label: "Intrinsic DCF Value", value: fairValueText("Calculating"), source: "Backend DCF engine" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
        { label: "Upside / Downside", value: upsideText("Loading"), source: "Realtime calculation" },
        { label: "Status", value: dcfData?.status ?? "Calculating", source: "DCF value-vs-price rule" },
      ],
      components: [
        { label: "Revenue Growth", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
        { label: "Operating Margin Proxy", value: pct(clamp(assumptions.roic, -100, 100)), source: "ROIC input mapped to backend margin" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Realtime Assumptions control" },
        { label: "Terminal Growth", value: dcfData ? pct(dcfData.terminal_growth_used * 100) : "Loading", source: "Derived by the backend: revenue growth bounded by the long-run ceiling and WACC" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Realtime Assumptions control" },
      ],
      formula: `Intrinsic DCF request = growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, terminal growth derived by the backend, FCFF ${moneyText(assumptions.fcff)}B`,
      result: dcfData ? `${fairValueText("Calculating")} intrinsic value, ${upsideText("Loading")} versus current price` : "Calculating",
      sourcing: [
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Assumptions", value: "Debounced ticker inputs", source: "Corporate Analysis UI" },
        { label: "Market price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `Send growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, FCFF ${moneyText(assumptions.fcff)}B`, source: "DCF request payload" },
        { label: "2", value: dcfData ? `${fairValueText("Calculating")} / ${moneyText(dcfData.current_price)} - 1` : "Waiting for backend result", source: upsideText("Loading") },
        { label: "3", value: dcfData ? `${fairValueText("Calculating")} intrinsic value` : "Calculating", source: "Final Backend DCF result" },
      ],
    },
    sustainableGrowth: {
      title: `${companyName} Sustainable Growth`,
      timeHorizon: "Realtime calculation from current reinvestment rate and ROIC assumptions; source inputs typically use 5-year normalized history or LTM fallback.",
      summary: [
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Realtime calculation" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "User Growth Rate", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
      ],
      components: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Share of after-tax operating income reinvested" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Return generated on invested capital" },
        { label: "Growth Gap", value: pct(assumptions.growth - derived.sustainableGrowth), source: "User growth minus sustainable growth" },
      ],
      formula: `Sustainable Growth = Reinvestment Rate x ROIC = ${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`,
      result: pct(derived.sustainableGrowth),
      sourcing: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Yahoo annual reinvestment / NOPAT values averaged from 2021 onward" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values averaged from 2021 onward" },
        { label: "Comparison Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `${numberText(assumptions.reinvestment)} x ${numberText(assumptions.roic)} / 100`, source: numberText(derived.sustainableGrowth) },
        { label: "3", value: pct(derived.sustainableGrowth), source: "Final Sustainable Growth" },
      ],
    },
    hurdleDecomposition: {
      title: `${companyName} Hurdle Rate Decomposition`,
      timeHorizon: "Fixed model inputs: risk-free rate 4.2%, and an implied ERP solved from a fixed cash yield and growth path. The company's own CRP is set by its reporting currency.",
      summary: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "FRED / macro assumption" },
        { label: "Expected Market Return (IRR)", value: pct(impliedMarketReturn), source: "Fixed model: first-year cash yield and a 5-year growth path, both constants. The cash flows scale with the index, so the index level cancels out and this does not move with the market" },
        { label: "Implied ERP (reference)", value: pct2(impliedErp), source: "Expected market return - risk-free rate; not used in Ke" },
        { label: "Beta x ERP", value: pct(derived.leveredBeta * equityRiskPremium), source: `Levered beta x ERP ${pct(equityRiskPremium)}, the WACC's ERP` },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: "By reporting currency: USD, CAD, EUR 0%; otherwise 0.8%" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Realtime hurdle-rate model" },
      ],
      components: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "FRED / macro assumption" },
        { label: "Beta x ERP", value: pct(derived.leveredBeta * equityRiskPremium), source: `Levered beta ${numberText2(derived.leveredBeta)} x ERP ${pct(equityRiskPremium)}` },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: "Country risk premium by reporting currency: USD, CAD, EUR 0%; otherwise 0.8%" },
      ],
      formula: "Bottom-up Ke = risk-free rate + levered beta x ERP (5.5%, as in WACC) + CRP. The implied ERP is a reference, not an input",
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: "Levered beta", value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? "The beta inside the WACC (Yahoo regression beta)" : "Unlevered beta re-levered with the current debt ratio: βU x [1 + (1 - t) x D/E]" },
        { label: "ERP", value: pct(equityRiskPremium), source: "Model policy ERP, the same as in the WACC; the implied ERP is a reference only" },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: "Country risk premium by reporting currency" },
      ],
      simulation: [
        { label: "1", value: "Read the three components: risk-free rate, levered beta x ERP, CRP", source: "Hurdle components" },
        { label: "2", value: `ERP = model policy ${pct(equityRiskPremium)} (implied ERP ${pct2(impliedErp)} shown for reference)`, source: pct(equityRiskPremium) },
        { label: "3", value: `Levered beta premium = ${numberText2(derived.leveredBeta)} x ${pct(equityRiskPremium)}`, source: pct(derived.leveredBeta * equityRiskPremium) },
        { label: "4", value: `${pct(riskFreeRate)} + ${pct(derived.leveredBeta * equityRiskPremium)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    betaWaccCurve: {
      title: `${companyName} Bottom-up Beta`,
      timeHorizon: "5-year beta convention for business risk, with the current capital structure.",
      summary: [
        { label: "Unlevered Beta", value: numberText2(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: "Debt ratio conversion" },
        { label: "Financial Beta", value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? "The beta inside the WACC" : "Hamada formula" },
        { label: "Current Debt Ratio", value: pct(assumptions.debtRatio), source: "Latest statement debt / (debt + equity)" },
      ],
      components: [
        {
          label: "β_U (unlevered)",
          value: numberText2(assumptions.unleveredBeta),
          source: `This company's own Yahoo regression beta, de-levered by the backend with the latest statement D/E and the tax rate; not an industry average. ${betaInterpretation(assumptions.unleveredBeta)}`,
        },
        {
          label: "β_L (levered)",
          value: numberText2(derived.leveredBeta),
          source: `${derived.keFromWacc ? "The levered beta inside the WACC, the one in Ke" : "β_U re-levered with the current debt ratio, the one in Ke"}. ${betaInterpretation(derived.leveredBeta)}`,
        },
      ],
      formula: "Levered Beta = betaU x [1 + (1 - tax) x D/E]",
      result: `${numberText2(derived.leveredBeta)} beta; current WACC ${pct(assumptions.wacc)}`,
      sourcing: [
        { label: "β_U (unlevered)", value: numberText2(assumptions.unleveredBeta), source: "Yahoo regression beta de-levered: β_U = β / [1 + (1 - t) x D/E], with the latest statement D/E and the tax rate; a saved or default value when Yahoo metrics are not loaded" },
        { label: "β_L (levered)", value: numberText2(derived.leveredBeta), source: derived.keFromWacc ? "The levered beta inside the WACC: business risk plus the leverage risk of debt" : "β_U x [1 + (1 - t) x D/E] at the current debt ratio" },
        { label: "Beta convention", value: betaInterpretation(derived.leveredBeta), source: "Beta 1.0 = average market risk; beta above/below 1.0 means proportionally higher/lower volatility" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt / (debt + equity), averaged from 2021 onward" },
        { label: "Tax Rate", value: pct(taxRate * 100), source: "Corporate tax assumption" },
      ],
      simulation: [
        { label: "1", value: `D/E = ${pct(assumptions.debtRatio)} / ${pct(100 - assumptions.debtRatio)}`, source: numberText(derived.debtToEquity) },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
      ],
    },
    valueDriverMatrix: {
      title: `${companyName} 4-Quadrant Value Driver Matrix`,
      timeHorizon: "Current company assumptions. The chart's grey points are up to four same-sector watchlist companies, from their own metrics.",
      summary: [
        { label: "Growth", value: pct(assumptions.growth), source: "X-axis" },
        { label: "ROIC - WACC", value: pct(derived.spread), source: "Y-axis" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Bubble size" },
        { label: "Quadrant", value: t(QUADRANT_KEY[valueQuadrant(assumptions.growth, derived.spread, riskFreeRate)]), source: `ROIC - WACC against 0; growth against the long-run reference, the risk-free rate ${pct(riskFreeRate)}` },
      ],
      components: valueMatrix.map((item) => ({
        label: item.name,
        value: `growth ${pct(item.growth)}, spread ${pct(item.spread)}, FCFF ${numberText(item.fcff)}`,
        source: item.name === companyName ? "Current company segment" : "Same-sector watchlist company",
      })),
      formula: "Matrix point = (growth, ROIC - WACC); bubble size = FCFF magnitude",
      result: `${pct(assumptions.growth)} growth, ${pct(derived.spread)} spread`,
      sourcing: [
        { label: "Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values averaged from 2021 onward when available" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement averages plus Yahoo beta and model rate inputs" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
      ],
      simulation: [
        { label: "1", value: `X = growth = ${pct(assumptions.growth)}`, source: "Matrix X-axis" },
        { label: "2", value: `Y = ${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`, source: pct(derived.spread) },
        { label: "3", value: `Bubble = clamp(${numberText(assumptions.fcff)} / 1.6, 10.0, 100.0)`, source: numberText(clamp(assumptions.fcff / 1.6, 10, 100)) },
      ],
    },
    dcfCoreModules: {
      title: `${companyName} DCF Core Modules`,
      timeHorizon: "Current realtime assumption set; FCFF uses LTM or normalized annual-report input; current price is comparison context only.",
      summary: [
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Reinvestment x ROIC" },
        { label: "Terminal Value Share", value: terminalShareText("Calculating"), source: "Backend DCF engine" },
        { label: "FCFF Magnitude", value: `${moneyText(assumptions.fcff)}B`, source: sourceLabel },
        { label: "Intrinsic DCF Value", value: fairValueText("N/A"), source: "Backend DCF engine" },
      ],
      components: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Sustainable growth component" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Sustainable growth component" },
        { label: "Growth", value: pct(assumptions.growth), source: "Projected FCFF component" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Discount rate and terminal denominator" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
      ],
      formula: "Sustainable Growth = reinvestment x ROIC / 100; Terminal Value Share = PV(terminal value) / enterprise value",
      result: `${pct(derived.sustainableGrowth)} sustainable growth; ${terminalShareText("terminal value share calculating")} terminal value share`,
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: "PV(terminal value) / enterprise value", source: terminalShareText("Waiting for backend result") },
        { label: "3", value: dcfData ? `${fairValueText("N/A")} vs ${moneyText(dcfData.current_price)}` : "Waiting for backend result", source: upsideText("Loading") },
      ],
    },
    terminalValueShare: {
      title: `${companyName} Terminal Value Share`,
      timeHorizon: "Measured from the backend DCF that ran against the current assumption set. Not bounded: a share near 100% is a real reading about this valuation, and clamping it would hide the concentration it is reporting.",
      summary: [
        { label: "Terminal Value Share", value: terminalShareText("Calculating"), source: "Backend DCF engine | Period: current realtime scenario" },
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available | Period: current override can replace backend value" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement averages plus Yahoo beta and model rate inputs | Period: current model snapshot" },
        { label: "What it measures", value: "Share of enterprise value from the perpetuity", source: "Terminal-value concentration | Period: model definition" },
      ],
      components: [
        { label: "PV of terminal value", value: "Terminal value discounted over the 5-year forecast", source: "Numerator | Period: current realtime scenario" },
        { label: "Enterprise value", value: "PV of explicit FCFF + PV of terminal value", source: "Denominator | Period: current realtime scenario" },
        { label: "Terminal denominator", value: `WACC - terminal growth, from ${pct(assumptions.wacc)} WACC`, source: "What the share is most sensitive to | Period: current assumption state" },
      ],
      formula: "Terminal Value Share = PV(terminal value) / enterprise value",
      result: terminalShareText("Calculating"),
      sourcing: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates from 2021 onward / saved fallback / browser override" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo-derived WACC / saved fallback / browser override" },
        { label: "Terminal model", value: "Gordon growth perpetuity", source: "packages/core_finance/dcf.py" },
      ],
      simulation: [
        { label: "1", value: "Discount the 5 explicit FCFF years at WACC", source: "PV of explicit forecast" },
        { label: "2", value: "Discount the Gordon terminal value over the same 5 years", source: "PV of terminal value" },
        { label: "3", value: "PV(terminal) / (PV(explicit) + PV(terminal))", source: terminalShareText("Waiting for backend result") },
      ],
    },
    fcffMagnitude: {
      title: `${companyName} FCFF Magnitude`,
      timeHorizon: "LTM or normalized annual-report FCFF input from the current ticker row; browser slider overrides are current-session realtime values.",
      summary: [
        { label: "FCFF Magnitude", value: `${moneyText(assumptions.fcff)}B`, source: `${sourceLabel} | Period: LTM or normalized annual report` },
        { label: "ROIC", value: pct(assumptions.roic), source: "Operating return context | Period: LTM or 5-year normalized" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Cash-flow reinvestment context | Period: LTM or 5-year normalized" },
        { label: "Bubble Size Proxy", value: numberText(clamp(assumptions.fcff / 1.6, 10, 100)), source: "Value Driver Matrix visualization scale | Period: current chart scenario" },
      ],
      components: [
        { label: "FCFF raw input", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
        { label: "Value matrix scale", value: numberText(clamp(assumptions.fcff / 1.6, 10, 100)), source: "clamp(FCFF / 1.6, 10, 100) | Period: current chart scenario" },
        { label: "DCF payload", value: `${moneyText(assumptions.fcff)}B`, source: "Submitted to backend DCF endpoint | Period: current debounced request" },
      ],
      formula: "FCFF Magnitude = normalized annual-report FCFF input; visualization size = clamp(FCFF / 1.6, 10, 100)",
      result: `${moneyText(assumptions.fcff)}B`,
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward / saved fallback / browser override" },
        { label: "Ticker", value: assumptions.ticker, source: "Corporate company registry" },
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend payload field" },
      ],
      simulation: [
        { label: "1", value: `Read FCFF input ${moneyText(assumptions.fcff)}B`, source: sourceLabel },
        { label: "2", value: `clamp(${numberText(assumptions.fcff)} / 1.6, 10.0, 100.0)`, source: numberText(clamp(assumptions.fcff / 1.6, 10, 100)) },
        { label: "3", value: `Send ${moneyText(assumptions.fcff)}B to backend DCF`, source: "DCF payload" },
      ],
    },
    backendFairValue: {
      title: `${companyName} Intrinsic DCF Value`,
      timeHorizon: "Current backend DCF response using debounced realtime assumptions and the latest available market price/cache point.",
      summary: [
        { label: "Intrinsic DCF Value", value: fairValueText("N/A"), source: "Backend DCF engine | Period: current debounced request" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache | Period: latest available quote/cache point" },
        { label: "Upside / Downside", value: upsideText("Loading"), source: "Fair value vs current price | Period: current backend response" },
        { label: "Status", value: dcfData?.status ?? "Calculating", source: "Backend valuation classification | Period: current backend response" },
      ],
      components: [
        { label: "Revenue Growth", value: pct(assumptions.growth), source: "DCF payload | Period: 5-year normalized or current override" },
        { label: "Operating Margin Proxy", value: pct(clamp(assumptions.roic, -100, 100)), source: "ROIC mapped to backend margin | Period: LTM or 5-year normalized" },
        { label: "WACC", value: pct(assumptions.wacc), source: "DCF payload | Period: current market snapshot" },
        { label: "Terminal Growth", value: dcfData ? pct(dcfData.terminal_growth_used * 100) : "Loading", source: "Backend-derived: revenue growth bounded by the long-run ceiling and WACC | Period: current DCF request" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "DCF payload | Period: LTM or normalized annual report" },
      ],
      formula: "Intrinsic DCF Value = backend DCF endpoint output from FCFF, terminal value, and the equity bridge; Upside = intrinsic value / current price - 1",
      result: fairValueText("N/A"),
      sourcing: [
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache | Period: latest available quote/cache point" },
        { label: "Assumptions", value: "Debounced realtime UI state", source: "Corporate Analysis controls | Period: current session" },
      ],
      simulation: [
        { label: "1", value: `POST growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, terminal growth ${pct(clamp(assumptions.growth, -10, 10))}`, source: "Backend DCF request" },
        { label: "2", value: dcfData ? `${fairValueText("N/A")} / ${moneyText(dcfData.current_price)} - 1` : "Waiting for backend result", source: upsideText("Loading") },
        { label: "3", value: fairValueText("N/A"), source: "Final Intrinsic DCF Value" },
      ],
    },
  };
}
