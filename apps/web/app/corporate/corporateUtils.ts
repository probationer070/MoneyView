import { getApiBaseUrl } from "@/lib/api";
import type {
  DcfAssumptionSummary as DCFAssumptionSummary,
  DcfSummaryResponse as DCFResult,
} from "../../../../packages/shared-types";
import {
  COMPANIES,
  KOREA_COUNTRY_RISK_PREMIUM,
  TAX_RATE,
  initialAssumptions,
} from "./corporateConstants";
import type {
  AnnualMetricPoint,
  ComparisonUniverse,
  CorporateAssumptions,
  CorporateCompany,
  CorporateMetricsApi,
  DcfRequestSnapshot,
  ImpliedErpInputs,
  QuarterlyStatementRow,
  RawDatasetRow,
  RoicBasis,
  StockPriceRow,
} from "./corporateTypes";

export function mergeCompanies(apiCompanies: CorporateCompany[] = []) {
  const byTicker = new Map<string, CorporateCompany>();
  for (const company of COMPANIES) {
    byTicker.set(company.ticker, company);
  }
  for (const company of apiCompanies) {
    const ticker = company.ticker.toUpperCase();
    byTicker.set(ticker, {
      ...byTicker.get(ticker),
      ...company,
      ticker,
    });
  }
  return Array.from(byTicker.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function companyForTicker(ticker: string, companies: CorporateCompany[] = COMPANIES) {
  return companies.find((company) => company.ticker === ticker) ?? { ticker, name: ticker, source: "manual" };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function dcfRequestBody(snapshot: DcfRequestSnapshot) {
  return {
    revenue_growth_rate: snapshot.growth / 100,
    operating_margin: clamp(snapshot.roic / 100, -1, 1),
    wacc: snapshot.wacc / 100,
    tax_rate: TAX_RATE,
    terminal_growth_rate: clamp(snapshot.growth / 100, -0.1, 0.1),
    fcff: snapshot.fcff,
    esg_penalty: snapshot.esgPenalty,
    reinvestment: snapshot.reinvestment,
    unlevered_beta: snapshot.unleveredBeta,
    debt_ratio: snapshot.debtRatio,
  };
}

export function mergeDcfSummary(summary: DCFResult, assumptions: DCFAssumptionSummary | null): DCFResult {
  return {
    ...summary,
    wacc_used: assumptions?.wacc_used ?? summary.wacc_used ?? 0,
    margin_used: assumptions?.margin_used ?? summary.margin_used ?? 0,
    growth_used: assumptions?.growth_used ?? summary.growth_used ?? 0,
    fcff_used: assumptions?.fcff_used ?? summary.fcff_used ?? 0,
    esg_penalty_used: assumptions?.esg_penalty_used ?? summary.esg_penalty_used ?? 0,
    terminal_growth_used: assumptions?.terminal_growth_used ?? summary.terminal_growth_used ?? 0,
    enterprise_value_index: assumptions?.enterprise_value_index ?? summary.enterprise_value_index ?? 0,
  };
}

export async function streamCorporateDcfSummary(
  snapshot: DcfRequestSnapshot,
  signal: AbortSignal,
  onEvent: (payload: Record<string, unknown>) => void,
) {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/corporate/dcf/${snapshot.ticker}/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dcfRequestBody(snapshot)),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`DCF stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";

    for (const message of messages) {
      const dataLines = message
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;
      onEvent(JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
    }
  }
}

function stableSeed(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function generatedDefaultsFor(company: CorporateCompany | undefined, ticker: string) {
  if (company?.preset) return company.preset;

  const sector = company?.sector?.toLowerCase() ?? "";
  const seed = stableSeed(`${ticker}:${sector}`);
  let growth = 5 + (seed % 9);
  let roic = 10 + (seed % 18);
  let wacc = 8 + (seed % 18) * 0.25;
  let debtRatio = 12 + (seed % 36);
  let unleveredBeta = 0.8 + (seed % 13) * 0.07;

  if (["semiconductor", "software", "cloud", "ai", "technology"].some((term) => sector.includes(term))) {
    growth += 2;
    roic += 3;
    unleveredBeta += 0.15;
  } else if (["energy", "oil", "gas", "nuclear"].some((term) => sector.includes(term))) {
    growth -= 1.5;
    debtRatio += 5;
    wacc += 0.5;
  } else if (["financial", "bank", "insurance"].some((term) => sector.includes(term))) {
    roic -= 2;
    debtRatio += 10;
    unleveredBeta -= 0.05;
  } else if (["utility", "water", "electric"].some((term) => sector.includes(term))) {
    growth -= 2;
    debtRatio += 14;
    unleveredBeta -= 0.15;
  }

  return {
    growth: Number(Math.max(growth, 1).toFixed(1)),
    roic: Number(Math.max(roic, 5).toFixed(1)),
    wacc: Number(Math.max(wacc, 6).toFixed(1)),
    debtRatio: Number(Math.min(Math.max(debtRatio, 5), 70).toFixed(1)),
    unleveredBeta: Number(Math.min(Math.max(unleveredBeta, 0.55), 2.4).toFixed(1)),
  };
}

export function defaultAssumptionsFor(ticker: string, companies: CorporateCompany[] = COMPANIES): CorporateAssumptions {
  const company = companies.find((entry) => entry.ticker === ticker);
  const seed = stableSeed(`${ticker}:${company?.sector ?? ""}`);
  return {
    ...initialAssumptions,
    ticker,
    ...generatedDefaultsFor(company, ticker),
    crp: KOREA_COUNTRY_RISK_PREMIUM,
    reinvestment: Number((24 + (seed % 36)).toFixed(1)),
    fcff: Number((45 + (seed % 140)).toFixed(1)),
    innovation: Number((48 + (seed % 45)).toFixed(1)),
    marketShare: Number((28 + (seed % 52)).toFixed(1)),
    governance: Number((52 + (seed % 38)).toFixed(1)),
    esgPenalty: Number((8 + (seed % 32)).toFixed(1)),
  };
}

export function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function pct2(value: number) {
  return `${value.toFixed(2)}%`;
}

export function numberText(value: number) {
  return value.toFixed(1);
}

export function numberText2(value: number) {
  return value.toFixed(2);
}

export function moneyText(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

export function dateTimeText(value: string) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function comparisonUniverseLabel(value: ComparisonUniverse | "portfolio_plus_benchmark") {
  switch (value) {
    case "portfolio_plus_benchmark":
      return "Portfolio + Benchmark";
    case "watchlist_plus_benchmark":
      return "Watchlist + Benchmark";
    case "custom":
      return "Custom Universe";
    default:
      return value;
  }
}

export function readSessionCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session cache is an optional optimization layer.
  }
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  if (typeof window === "undefined") return;
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export function downloadRawDatasetCsv(ticker: string, rows: RawDatasetRow[]) {
  downloadCsv(`${ticker}-raw-analysis-datasets.csv`, [
    ["dataset", "field", "value", "source"],
    ...rows.map((row) => [row.dataset, row.field, row.value, row.source]),
  ]);
}

export function downloadHistoricalPriceCsv(ticker: string, rows: StockPriceRow[]) {
  downloadCsv(`${ticker}-5y-historical-prices.csv`, [
    ["date", "open", "high", "low", "close", "volume"],
    ...rows.map((row) => [row.date, row.open, row.high, row.low, row.close, row.volume]),
  ]);
}

export function downloadQuarterlyStatementsCsv(ticker: string, rows: QuarterlyStatementRow[]) {
  downloadCsv(`${ticker}-quarterly-financial-statements.csv`, [
    ["statement", "period", "metric", "value"],
    ...rows.map((row) => [row.statement, row.period, row.metric, row.value]),
  ]);
}

function presentValueOfImpliedMarketCashFlows(discountRate: number, inputs: ImpliedErpInputs) {
  const cashYield = (inputs.dividendYield + inputs.buybackYield) / 100;
  const stableGrowth = inputs.stableGrowth / 100;
  let projectedCashFlow = inputs.indexLevel * cashYield;
  let presentValue = 0;

  inputs.growthRates.forEach((growthRate, index) => {
    projectedCashFlow *= 1 + growthRate / 100;
    presentValue += projectedCashFlow / Math.pow(1 + discountRate, index + 1);
  });

  const terminalCashFlow = projectedCashFlow * (1 + stableGrowth);
  const terminalSpread = Math.max(discountRate - stableGrowth, 0.001);
  const terminalValue = terminalCashFlow / terminalSpread;
  return presentValue + terminalValue / Math.pow(1 + discountRate, inputs.growthRates.length);
}

export function solveImpliedMarketReturn(inputs: ImpliedErpInputs) {
  const stableGrowth = inputs.stableGrowth / 100;
  let low = stableGrowth + 0.001;
  let high = 0.20;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const presentValue = presentValueOfImpliedMarketCashFlows(mid, inputs);
    if (presentValue > inputs.indexLevel) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return ((low + high) / 2) * 100;
}

export function metricBasisParams(roicBasis: RoicBasis, roicYear: string) {
  const params: Record<string, string | number> = {
    roic_basis: roicBasis,
  };
  if (roicBasis === "annual" && roicYear) params.roic_year = roicYear;
  return params;
}

export function selectedMetricValue(
  basis: RoicBasis,
  selectedYear: string,
  annualValues: AnnualMetricPoint[],
  recentAverage: number | null | undefined,
  allYearAverage?: number | null,
) {
  if (basis === "annual") {
    const targetYear = selectedYear || String(annualValues.findLast((point) => point.value != null)?.year ?? "");
    return annualValues.find((point) => String(point.year) === targetYear)?.value ?? null;
  }
  if (basis === "all_year_average") return allYearAverage ?? null;
  if (basis === "recent_average") return recentAverage ?? null;
  return null;
}

export function annualMetricRows(points: AnnualMetricPoint[]) {
  const byYear = new Map(points.map((point) => [point.year, point.value]));
  return [2021, 2022, 2023, 2024, 2025].map((year) => ({
    year,
    value: byYear.get(year) ?? null,
  }));
}

export function fromApiMetrics(metrics: CorporateMetricsApi): CorporateAssumptions {
  return {
    ticker: metrics.ticker,
    growth: metrics.growth,
    roic: metrics.roic,
    wacc: metrics.wacc,
    debtRatio: metrics.debt_ratio,
    unleveredBeta: metrics.unlevered_beta,
    crp: KOREA_COUNTRY_RISK_PREMIUM,
    reinvestment: metrics.reinvestment,
    fcff: metrics.fcff,
    innovation: metrics.innovation,
    marketShare: metrics.market_share,
    governance: metrics.governance,
    esgPenalty: metrics.esg_penalty,
  };
}

export function toApiMetrics(assumptions: CorporateAssumptions): CorporateMetricsApi {
  return {
    ticker: assumptions.ticker,
    growth: assumptions.growth,
    roic: assumptions.roic,
    wacc: assumptions.wacc,
    debt_ratio: assumptions.debtRatio,
    unlevered_beta: assumptions.unleveredBeta,
    crp: KOREA_COUNTRY_RISK_PREMIUM,
    reinvestment: assumptions.reinvestment,
    fcff: assumptions.fcff,
    innovation: assumptions.innovation,
    market_share: assumptions.marketShare,
    governance: assumptions.governance,
    esg_penalty: assumptions.esgPenalty,
  };
}
