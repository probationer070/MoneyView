"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  BetaWaccCurveGraph,
  CompanyStatusGraph,
  DcfCoreModulesGraph,
  HurdleRateDecompositionGraph,
  RiskReturnMinardGraph,
  ValueDriverMatrixGraph,
} from "./components/CorporateGraphs";

// Domain models shared by the corporate analysis UI and API calls.
interface CorporateCompany {
  ticker: string;
  name: string;
  sector?: string;
  source?: string;
  preset?: {
    growth: number;
    roic: number;
    wacc: number;
    debtRatio: number;
    unleveredBeta: number;
  };
}

// Built-in company presets are used before API data or user-added companies load.
const COMPANIES: CorporateCompany[] = [
  { ticker: "AAPL", name: "Apple", preset: { growth: 6, roic: 18, wacc: 10, debtRatio: 18, unleveredBeta: 1.05 } },
  { ticker: "MSFT", name: "Microsoft", preset: { growth: 7, roic: 22, wacc: 9, debtRatio: 15, unleveredBeta: 0.95 } },
  { ticker: "NVDA", name: "Nvidia", preset: { growth: 16, roic: 32, wacc: 12, debtRatio: 10, unleveredBeta: 1.55 } },
  { ticker: "TSLA", name: "Tesla", preset: { growth: 12, roic: 13, wacc: 13, debtRatio: 22, unleveredBeta: 1.7 } },
  { ticker: "AMZN", name: "Amazon", preset: { growth: 9, roic: 12, wacc: 10.5, debtRatio: 24, unleveredBeta: 1.15 } },
  { ticker: "GOOGL", name: "Alphabet", preset: { growth: 8, roic: 20, wacc: 9.5, debtRatio: 8, unleveredBeta: 1.0 } },
  { ticker: "META", name: "Meta Platforms", preset: { growth: 10, roic: 24, wacc: 10.25, debtRatio: 12, unleveredBeta: 1.2 } },
  { ticker: "NFLX", name: "Netflix", preset: { growth: 8, roic: 16, wacc: 11, debtRatio: 26, unleveredBeta: 1.25 } },
  { ticker: "AMD", name: "AMD", preset: { growth: 11, roic: 11, wacc: 12, debtRatio: 18, unleveredBeta: 1.45 } },
  { ticker: "AVGO", name: "Broadcom", preset: { growth: 8, roic: 21, wacc: 10.75, debtRatio: 35, unleveredBeta: 1.1 } },
  { ticker: "JPM", name: "JPMorgan Chase", preset: { growth: 4, roic: 10, wacc: 8.75, debtRatio: 42, unleveredBeta: 0.9 } },
  { ticker: "V", name: "Visa", preset: { growth: 7, roic: 28, wacc: 8.5, debtRatio: 16, unleveredBeta: 0.85 } },
  { ticker: "UNH", name: "UnitedHealth", preset: { growth: 6, roic: 15, wacc: 8.75, debtRatio: 28, unleveredBeta: 0.8 } },
  { ticker: "XOM", name: "Exxon Mobil", preset: { growth: 3, roic: 12, wacc: 9.25, debtRatio: 20, unleveredBeta: 0.95 } },
  { ticker: "LEU", name: "Centrus Energy", preset: { growth: 14, roic: 14, wacc: 14, debtRatio: 30, unleveredBeta: 1.8 } },
];
const TAX_RATE = 0.25;
const RISK_FREE_RATE = 4.2;
const KOREA_COUNTRY_RISK_PREMIUM = 0.8;
const IMPLIED_ERP_FALLBACK_INDEX_LEVEL = 100;
const IMPLIED_ERP_DIVIDEND_YIELD = 1.4;
const IMPLIED_ERP_BUYBACK_YIELD = 2.3;
const IMPLIED_ERP_FIVE_YEAR_GROWTH = [7.0, 6.0, 5.0, 4.5, 4.2];

// Main assumption state that drives both frontend visualizations and backend DCF requests.
interface CorporateAssumptions {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debtRatio: number;
  unleveredBeta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  marketShare: number;
  governance: number;
  esgPenalty: number;
}

interface DCFResult {
  estimated_value: number;
  current_price: number;
  upside_pct: number;
  wacc_used: number;
  margin_used: number;
  growth_used: number;
  status: string;
}

interface StockPriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ImpliedErpInputs {
  indexLevel: number;
  dividendYield: number;
  buybackYield: number;
  growthRates: number[];
  stableGrowth: number;
  riskFreeRate: number;
}

interface CorporateMetricsApi {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debt_ratio: number;
  unlevered_beta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  market_share: number;
  governance: number;
  esg_penalty: number;
}

type GrowthBasis = "cagr" | "recent_average" | "annual";
type RoicBasis = "recent_average" | "all_year_average" | "annual";

interface AnnualMetricPoint {
  year: number;
  value: number | null;
}

interface CorporateMetricHistoryApi {
  ticker: string;
  start_year: number;
  country_risk_premium: number;
  growth_cagr: number | null;
  growth_recent_average: number | null;
  annual_growth_rates: AnnualMetricPoint[];
  roic_recent_average: number | null;
  roic_all_year_average: number | null;
  annual_roic: AnnualMetricPoint[];
}

interface QuarterlyStatementRow {
  ticker: string;
  statement: string;
  period: string;
  metric: string;
  value: number;
}

interface QuarterlyStatementsApi {
  ticker: string;
  source: string;
  rows: QuarterlyStatementRow[];
}

type CalculationDetailKey =
  | "realtime"
  | "growth"
  | "roic"
  | "wacc"
  | "debtRatio"
  | "unleveredBeta"
  | "leveredBeta"
  | "crp"
  | "erp"
  | "failureProbability"
  | "reinvestment"
  | "innovation"
  | "governance"
  | "esgPenalty"
  | "spread"
  | "bottomUpKe"
  | "backendDcf"
  | "sustainableGrowth"
  | "companyStatus"
  | "hurdleDecomposition"
  | "betaWaccCurve"
  | "valueDriverMatrix"
  | "riskReturnMinard"
  | "dcfCoreModules"
  | "terminalValueShare"
  | "fcffMagnitude"
  | "backendFairValue";

interface CalculationRow {
  label: string;
  value: string;
  source: string;
}

interface RawDatasetRow {
  dataset: string;
  field: string;
  value: string;
  source: string;
}

interface CalculationDetail {
  title: string;
  timeHorizon: string;
  summary: CalculationRow[];
  components: CalculationRow[];
  formula: string;
  result: string;
  sourcing: CalculationRow[];
  simulation: CalculationRow[];
}

const initialAssumptions: CorporateAssumptions = {
  ticker: "AAPL",
  growth: 6,
  roic: 18,
  wacc: 10,
  debtRatio: 18,
  unleveredBeta: 1.05,
  crp: 1.1,
  reinvestment: 34,
  fcff: 92,
  innovation: 82,
  marketShare: 64,
  governance: 74,
  esgPenalty: 22,
};

const STORAGE_KEY = "moneyview:corporate-assumptions:v2";

// Company registry helpers merge static presets, API companies, and deterministic fallbacks.
function mergeCompanies(apiCompanies: CorporateCompany[] = []) {
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

function companyForTicker(ticker: string, companies: CorporateCompany[] = COMPANIES) {
  return companies.find((company) => company.ticker === ticker) ?? { ticker, name: ticker, source: "manual" };
}

function stableSeed(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

// Deterministic fallback assumptions keep manually added or missing tickers usable.
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

function defaultAssumptionsFor(ticker: string, companies: CorporateCompany[] = COMPANIES): CorporateAssumptions {
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Display formatters keep numeric precision consistent across cards, charts, and modals.
function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function pct2(value: number) {
  return `${value.toFixed(2)}%`;
}

function numberText(value: number) {
  return value.toFixed(1);
}

function numberText2(value: number) {
  return value.toFixed(2);
}

function moneyText(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

// CSV export helpers power the raw data download controls inside the detail modal.
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

function downloadRawDatasetCsv(ticker: string, rows: RawDatasetRow[]) {
  downloadCsv(`${ticker}-raw-analysis-datasets.csv`, [
    ["dataset", "field", "value", "source"],
    ...rows.map((row) => [row.dataset, row.field, row.value, row.source]),
  ]);
}

function downloadHistoricalPriceCsv(ticker: string, rows: StockPriceRow[]) {
  downloadCsv(`${ticker}-5y-historical-prices.csv`, [
    ["date", "open", "high", "low", "close", "volume"],
    ...rows.map((row) => [row.date, row.open, row.high, row.low, row.close, row.volume]),
  ]);
}

function downloadQuarterlyStatementsCsv(ticker: string, rows: QuarterlyStatementRow[]) {
  downloadCsv(`${ticker}-quarterly-financial-statements.csv`, [
    ["statement", "period", "metric", "value"],
    ...rows.map((row) => [row.statement, row.period, row.metric, row.value]),
  ]);
}

// Implied ERP model: solve the discount rate that prices projected market cash flows.
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

function solveImpliedMarketReturn(inputs: ImpliedErpInputs) {
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

function betaInterpretation(beta: number) {
  if (Math.abs(beta - 1) < 0.05) return "Beta 1.0 indicates average market risk.";
  if (beta > 1) return `Beta ${numberText2(beta)} implies about ${numberText((beta - 1) * 100)}% higher volatility than the market.`;
  return `Beta ${numberText2(beta)} implies about ${numberText((1 - beta) * 100)}% lower volatility than the market.`;
}

function metricBasisParams(
  growthBasis: GrowthBasis,
  growthYear: string,
  roicBasis: RoicBasis,
  roicYear: string,
) {
  const params: Record<string, string | number> = {
    growth_basis: growthBasis,
    roic_basis: roicBasis,
  };
  if (growthBasis === "annual" && growthYear) params.growth_year = growthYear;
  if (roicBasis === "annual" && roicYear) params.roic_year = roicYear;
  return params;
}

function selectedMetricValue(
  basis: GrowthBasis | RoicBasis,
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

function annualMetricRows(points: AnnualMetricPoint[]) {
  const byYear = new Map(points.map((point) => [point.year, point.value]));
  return [2021, 2022, 2023, 2024, 2025].map((year) => ({
    year,
    value: byYear.get(year) ?? null,
  }));
}

// API mapping helpers isolate snake_case backend payloads from camelCase UI state.
function fromApiMetrics(metrics: CorporateMetricsApi): CorporateAssumptions {
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

function toApiMetrics(assumptions: CorporateAssumptions): CorporateMetricsApi {
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

// Reusable slider row for realtime assumption controls.
function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = "%",
  description,
  onDetailClick,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  description?: string;
  onDetailClick?: () => void;
  onChange: (value: number) => void;
}) {
  return (
    <label className="group/range block space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-[var(--text-muted)] transition-colors group-hover/range:text-[var(--text-primary)]">
          {onDetailClick ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onDetailClick();
              }}
              className="text-left underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
            >
              {description ? <InfoTooltip label={label} description={description} /> : label}
            </button>
          ) : description ? (
            <InfoTooltip label={label} description={description} />
          ) : (
            label
          )}
        </span>
        <span className="text-[var(--text-primary)] transition-colors group-hover/range:text-[var(--surface)]">
          {numberText(value)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--surface)]"
      />
    </label>
  );
}

// Modal used by every clickable metric/chart title to expose formulas and source lineage.
function CalculationDetailModal({
  detail,
  ticker,
  rawDatasetRows,
  historicalPrices,
  historicalStatus,
  quarterlyStatementRows,
  quarterlyStatementStatus,
  onClose,
}: {
  detail: CalculationDetail;
  ticker: string;
  rawDatasetRows: RawDatasetRow[];
  historicalPrices: StockPriceRow[];
  historicalStatus: string;
  quarterlyStatementRows: QuarterlyStatementRow[];
  quarterlyStatementStatus: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const renderRows = (rows: CalculationRow[]) => (
    <tbody>
      {rows.map((row, index) => (
        <tr key={`${row.label}-${row.source}-${index}`} className="border-t border-[var(--border)]">
          <td className="max-w-64 break-words px-3 py-2 font-bold text-black">{row.label}</td>
          <td className="max-w-72 break-words px-3 py-2 font-bold tabular-nums text-black">{row.value}</td>
          <td className="max-w-80 break-words px-3 py-2 font-bold text-black">{row.source}</td>
        </tr>
      ))}
    </tbody>
  );

  const rawDataAccessRows: CalculationRow[] = [
    ...detail.simulation.map((row) => ({
      label: `Step ${row.label}`,
      value: row.value,
      source: `Output: ${row.source}; Data Period: ${detail.timeHorizon}`,
    })),
    ...detail.sourcing.map((row) => ({
      label: row.label,
      value: row.value,
      source: `${row.source}; Data Period: ${detail.timeHorizon}`,
    })),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-[min(56rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden rounded-[var(--radius)] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div id="modal-header" className="sticky top-0 flex items-start justify-between border-b border-[var(--border)] bg-white p-5 z-0">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)]">{detail.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Calculation transparency and data lineage</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => downloadRawDatasetCsv(ticker, rawDatasetRows)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Download Raw CSV
            </button>
            <button
              type="button"
              onClick={() => downloadHistoricalPriceCsv(ticker, historicalPrices)}
              disabled={historicalPrices.length === 0}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download 5Y Prices
            </button>
            <button
              type="button"
              onClick={() => downloadQuarterlyStatementsCsv(ticker, quarterlyStatementRows)}
              disabled={quarterlyStatementRows.length === 0}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download Quarterly Statements
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Data Table</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black z-10">
                  <tr>
                    <th className="px-3 py-2">Data Point</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                {renderRows(detail.summary)}
              </table>
            </div>
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Time Horizon</h3>
            <p className="mt-2 text-sm text-[var(--text-primary)]">{detail.timeHorizon}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Component Breakdown</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black z-10">
                  <tr>
                    <th className="px-3 py-2">Component</th>
                    <th className="px-3 py-2">Assigned Value</th>
                    <th className="px-3 py-2">Basis</th>
                  </tr>
                </thead>
                {renderRows(detail.components)}
              </table>
            </div>
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Calculation Formula</h3>
            <p className="mt-2 font-mono text-sm font-bold text-black">{detail.formula}</p>
            <p className="mt-2 text-sm font-bold text-black">Data Period: {detail.timeHorizon}</p>
            <p className="mt-3 text-sm font-bold text-black">Result: {detail.result}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Source Attribution</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black z-10">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Current Value</th>
                    <th className="px-3 py-2">Origin</th>
                  </tr>
                </thead>
                {renderRows(detail.sourcing)}
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">View Details</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black z-10">
                  <tr>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Arithmetic</th>
                    <th className="px-3 py-2">Output</th>
                  </tr>
                </thead>
                {renderRows(detail.simulation)}
              </table>
            </div>
          </section>

          <section>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Raw Historical Data Table</h3>
              <p className="text-xs text-[var(--text-muted)]">{historicalStatus}</p>
            </div>
            <div className="mt-2 max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--border)] z-10">
              <table className="w-full min-w-[48rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black z-10">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Open</th>
                    <th className="px-3 py-2">High</th>
                    <th className="px-3 py-2">Low</th>
                    <th className="px-3 py-2">Close</th>
                    <th className="px-3 py-2">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalPrices.length > 0 ? historicalPrices.map((row) => (
                    <tr key={`${ticker}-${row.date}`} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-bold text-black">{row.date}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{numberText(row.open)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{numberText(row.high)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{numberText(row.low)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{numberText(row.close)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{Math.round(row.volume).toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr className="border-t border-[var(--border)]">
                      <td className="px-3 py-3 text-sm font-bold text-black" colSpan={6}>
                        Historical stock price rows are not available for this ticker yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Quarterly Financial Statements</h3>
              <p className="text-xs text-[var(--text-muted)]">{quarterlyStatementStatus}</p>
            </div>
            <div className="mt-2 max-h-96 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[56rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Statement</th>
                    <th className="px-3 py-2">Quarter</th>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {quarterlyStatementRows.length > 0 ? quarterlyStatementRows.map((row, index) => (
                    <tr key={`${row.statement}-${row.period}-${row.metric}-${index}`} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-bold text-black">{row.statement}</td>
                      <td className="px-3 py-2 font-bold text-black">{row.period}</td>
                      <td className="max-w-80 break-words px-3 py-2 font-bold text-black">{row.metric}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{numberText(row.value)}</td>
                    </tr>
                  )) : (
                    <tr className="border-t border-[var(--border)]">
                      <td className="px-3 py-3 text-sm font-bold text-black" colSpan={4}>
                        Quarterly financial statement rows are not available for this ticker yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Raw Data Access</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Calculation Step</th>
                    <th className="px-3 py-2">Raw Input / Arithmetic</th>
                    <th className="px-3 py-2">Source Attribution / Data Period</th>
                  </tr>
                </thead>
                {renderRows(rawDataAccessRows)}
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">All Raw Datasets Used</h3>
            <div className="mt-2 max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Dataset</th>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rawDatasetRows.map((row, index) => (
                    <tr key={`${row.dataset}-${row.field}-${index}`} className="border-t border-[var(--border)]">
                      <td className="max-w-64 break-words px-3 py-2 font-bold text-black">{row.dataset}</td>
                      <td className="max-w-48 break-words px-3 py-2 font-bold text-black">{row.field}</td>
                      <td className="max-w-64 break-words px-3 py-2 font-bold tabular-nums text-black">{row.value}</td>
                      <td className="max-w-80 break-words px-3 py-2 font-bold text-black">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function CorporateAnalysisPage() {
  // Local UI state: selected ticker assumptions, search input, add-company form, and active modal.
  const queryClient = useQueryClient();
  const hydratingTickerRef = useRef<string | null>(initialAssumptions.ticker);
  const [assumptions, setAssumptions] = useState<CorporateAssumptions>(() => {
    if (typeof window === "undefined") return initialAssumptions;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return defaultAssumptionsFor(initialAssumptions.ticker);
      const byTicker = JSON.parse(stored) as Record<string, CorporateAssumptions>;
      return byTicker[initialAssumptions.ticker] ?? defaultAssumptionsFor(initialAssumptions.ticker);
    } catch {
      return defaultAssumptionsFor(initialAssumptions.ticker);
    }
  });
  const [companySearch, setCompanySearch] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanySymbol, setNewCompanySymbol] = useState("");
  const [activeCalculation, setActiveCalculation] = useState<CalculationDetailKey | null>(null);
  const [growthBasis, setGrowthBasis] = useState<GrowthBasis>("cagr");
  const [growthYear, setGrowthYear] = useState("2025");
  const [roicBasis, setRoicBasis] = useState<RoicBasis>("recent_average");
  const [roicYear, setRoicYear] = useState("2025");
  const [includeSubjectiveHealth, setIncludeSubjectiveHealth] = useState(false);
  const debounced = useDebounce(assumptions, 250);
  const selectedMetricParams = useMemo(
    () => metricBasisParams(growthBasis, growthYear, roicBasis, roicYear),
    [growthBasis, growthYear, roicBasis, roicYear],
  );

  // Company search data combines server-side saved companies with local presets.
  const companiesQuery = useQuery<CorporateCompany[]>({
    queryKey: ["corporate-companies"],
    queryFn: () => fetchApi<CorporateCompany[]>("/corporate/companies"),
    staleTime: 30_000,
  });

  const companies = useMemo(() => mergeCompanies(companiesQuery.data), [companiesQuery.data]);
  const activeCompany = companyForTicker(assumptions.ticker, companies);
  const showCompanyResults = companySearch.trim().length > 0;
  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) return companies;
    const startsWith = companies.filter((company) => company.name.toLowerCase().startsWith(query));
    return startsWith.length > 0
      ? startsWith
      : companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companies, companySearch]);

  // Hydrate and persist assumption state across backend storage and browser fallback storage.
  const metricsHistoryQuery = useQuery<CorporateMetricHistoryApi>({
    queryKey: ["corporate-metric-history", assumptions.ticker],
    queryFn: ({ signal }) =>
      fetchApi<CorporateMetricHistoryApi>(`/corporate/metrics/${assumptions.ticker}/history`, { signal }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  const quarterlyStatementsQuery = useQuery<QuarterlyStatementsApi>({
    queryKey: ["corporate-quarterly-statements", assumptions.ticker],
    queryFn: ({ signal }) =>
      fetchApi<QuarterlyStatementsApi>(`/corporate/metrics/${assumptions.ticker}/quarterly-statements`, { signal }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const ticker = assumptions.ticker;
    hydratingTickerRef.current = ticker;
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${ticker}`, { params: selectedMetricParams })
      .then((metrics) => {
        setAssumptions((current) => (
          current.ticker === ticker ? fromApiMetrics(metrics) : current
        ));
      })
      .catch(() => {
        // Local storage remains the fallback when backend hydration is unavailable.
      })
      .finally(() => {
        if (hydratingTickerRef.current === ticker) {
          hydratingTickerRef.current = null;
        }
      });
  }, [assumptions.ticker, selectedMetricParams]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const byTicker = stored ? (JSON.parse(stored) as Record<string, CorporateAssumptions>) : {};
      byTicker[assumptions.ticker] = assumptions;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byTicker));
    } catch {
      // Browser storage is optional; realtime calculations still work without it.
    }
  }, [assumptions]);

  useEffect(() => {
    if (hydratingTickerRef.current === debounced.ticker) return;
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${debounced.ticker}`, {
      method: "PUT",
      body: JSON.stringify(toApiMetrics(debounced)),
    }).catch(() => {
      // Local storage preserves ticker state if the backend is temporarily unavailable.
    });
  }, [debounced]);

  const update = <K extends keyof CorporateAssumptions>(key: K, value: CorporateAssumptions[K]) => {
    setAssumptions((current) => ({ ...current, [key]: value }));
  };

  const applyMetricHistorySelection = ({
    nextGrowthBasis = growthBasis,
    nextGrowthYear = growthYear,
    nextRoicBasis = roicBasis,
    nextRoicYear = roicYear,
  }: {
    nextGrowthBasis?: GrowthBasis;
    nextGrowthYear?: string;
    nextRoicBasis?: RoicBasis;
    nextRoicYear?: string;
  }) => {
    const history = metricsHistoryQuery.data;
    if (!history || history.ticker !== assumptions.ticker) return;

    const growthValue = nextGrowthBasis === "cagr"
      ? history.growth_cagr
      : selectedMetricValue(nextGrowthBasis, nextGrowthYear, history.annual_growth_rates, history.growth_recent_average);
    const roicValue = selectedMetricValue(
      nextRoicBasis,
      nextRoicYear,
      history.annual_roic,
      history.roic_recent_average,
      history.roic_all_year_average,
    );

    setAssumptions((current) => {
      if (current.ticker !== history.ticker) return current;
      return {
        ...current,
        growth: growthValue == null ? current.growth : growthValue,
        roic: roicValue == null ? current.roic : roicValue,
      };
    });
  };

  const selectTicker = (ticker: string) => {
    setCompanySearch("");
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const byTicker = stored ? (JSON.parse(stored) as Record<string, CorporateAssumptions>) : {};
      setAssumptions(byTicker[ticker] ?? defaultAssumptionsFor(ticker, companies));
    } catch {
      setAssumptions(defaultAssumptionsFor(ticker, companies));
    }
  };

  const addCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = newCompanySymbol.trim().toUpperCase();
    const name = newCompanyName.trim();
    if (!ticker || !name) return;

    const saved = await fetchApi<CorporateCompany>("/corporate/companies", {
      method: "POST",
      body: JSON.stringify({ ticker, name, source: "manual" }),
    });
    queryClient.setQueryData<CorporateCompany[]>(["corporate-companies"], (current = []) => {
      const next = current.filter((company) => company.ticker.toUpperCase() !== saved.ticker.toUpperCase());
      return [...next, saved];
    });
    setNewCompanyName("");
    setNewCompanySymbol("");
    selectTicker(saved.ticker.toUpperCase());
  };

  // Market and valuation queries feed the implied ERP model and backend DCF card.
  const sp500Query = useQuery<StockPriceRow[]>({
    queryKey: ["corporate-market-index", "^GSPC", "5y"],
    queryFn: ({ signal }) =>
      fetchApi<StockPriceRow[]>("/market/index/%5EGSPC", {
        params: { period: "5y" },
        signal,
      }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  const impliedErpInputs = useMemo<ImpliedErpInputs>(() => ({
    indexLevel: sp500Query.data?.at(-1)?.close ?? IMPLIED_ERP_FALLBACK_INDEX_LEVEL,
    dividendYield: IMPLIED_ERP_DIVIDEND_YIELD,
    buybackYield: IMPLIED_ERP_BUYBACK_YIELD,
    growthRates: IMPLIED_ERP_FIVE_YEAR_GROWTH,
    stableGrowth: RISK_FREE_RATE,
    riskFreeRate: RISK_FREE_RATE,
  }), [sp500Query.data]);

  const impliedMarketReturn = useMemo(() => solveImpliedMarketReturn(impliedErpInputs), [impliedErpInputs]);
  const impliedErp = Math.max(impliedMarketReturn - RISK_FREE_RATE, 0);

  // Derived metrics are the frontend valuation layer used by cards, charts, and detail modals.
  const derived = useMemo(() => {
    const debtToEquity = assumptions.debtRatio / Math.max(100 - assumptions.debtRatio, 1);
    const leveredBeta = assumptions.unleveredBeta * (1 + (1 - TAX_RATE) * debtToEquity);
    const bottomUpKe = RISK_FREE_RATE + leveredBeta * impliedErp + KOREA_COUNTRY_RISK_PREMIUM;
    const spread = assumptions.roic - assumptions.wacc;
    const sustainableGrowth = (assumptions.reinvestment / 100) * assumptions.roic;
    const terminalValueShare = clamp(62 + assumptions.growth * 1.8 - assumptions.wacc * 1.2, 20, 88);
    const successProbability = clamp(55 + spread * 2.3 + assumptions.growth - assumptions.esgPenalty * 0.25, 5, 95);
    const agencyRisk = clamp(100 - assumptions.governance + assumptions.esgPenalty, 0, 100);
    const lifeCyclePosition = clamp(35 + assumptions.growth * 2.5 - assumptions.debtRatio * 0.3, 0, 100);
    const leveredBetaRiskScore = clamp(100 - Math.max(leveredBeta - 1, 0) * 35, 0, 100);
    const objectiveHealthInputs = [
      assumptions.growth * 2,
      assumptions.marketShare,
      lifeCyclePosition,
      leveredBetaRiskScore,
    ];
    const subjectiveHealthInputs = [
      assumptions.innovation,
      assumptions.governance,
      100 - agencyRisk,
    ];
    const healthInputs = includeSubjectiveHealth
      ? [...objectiveHealthInputs, ...subjectiveHealthInputs]
      : objectiveHealthInputs;
    const healthScore = clamp(
      healthInputs.reduce((sum, value) => sum + value, 0) / healthInputs.length,
      0,
      100,
    );

    return {
      debtToEquity,
      leveredBeta,
      bottomUpKe,
      spread,
      sustainableGrowth,
      terminalValueShare,
      successProbability,
      agencyRisk,
      lifeCyclePosition,
      leveredBetaRiskScore,
      healthScore,
    };
  }, [assumptions, impliedErp, includeSubjectiveHealth]);

  const dcfQuery = useQuery<DCFResult>({
    queryKey: [
      "corporate-dcf",
      debounced.ticker,
      debounced.growth,
      debounced.wacc,
      debounced.roic,
      debounced.debtRatio,
      debounced.unleveredBeta,
      debounced.crp,
      debounced.reinvestment,
      debounced.fcff,
      debounced.esgPenalty,
    ],
    queryFn: ({ signal }) =>
      fetchApi<DCFResult>(`/corporate/dcf/${debounced.ticker}`, {
        method: "POST",
        signal,
        body: JSON.stringify({
          revenue_growth_rate: debounced.growth / 100,
          operating_margin: clamp(debounced.roic / 100, -1, 1),
          wacc: debounced.wacc / 100,
          tax_rate: TAX_RATE,
          terminal_growth_rate: clamp(debounced.growth / 100, -0.1, 0.1),
          fcff: debounced.fcff,
          esg_penalty: debounced.esgPenalty,
          reinvestment: debounced.reinvestment,
          unlevered_beta: debounced.unleveredBeta,
          debt_ratio: debounced.debtRatio,
        }),
      }),
    placeholderData: (previous) => previous,
    staleTime: 0,
  });

  const historicalPricesQuery = useQuery<StockPriceRow[]>({
    queryKey: ["corporate-ohlcv", assumptions.ticker, "5y"],
    queryFn: ({ signal }) =>
      fetchApi<StockPriceRow[]>(`/detail/${assumptions.ticker}/ohlcv`, {
        params: { period: "5y" },
        signal,
      }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  // Chart datasets keep each visualization declarative and reuse the same derived model.
  const healthRadar = [
    { subject: "Growth", score: clamp(assumptions.growth * 7, 0, 100), peer: 58 },
    { subject: "Market Share", score: assumptions.marketShare, peer: 62 },
    { subject: "Life Cycle", score: derived.lifeCyclePosition, peer: 60 },
    { subject: "Levered Beta Risk", score: derived.leveredBetaRiskScore, peer: 70 },
    ...(includeSubjectiveHealth
      ? [
        { subject: "Innovation", score: assumptions.innovation, peer: 66 },
        { subject: "Governance", score: assumptions.governance, peer: 65 },
        { subject: "Agency Risk", score: 100 - derived.agencyRisk, peer: 62 },
      ]
      : []),
  ];

  const hurdleBars = [
    { name: "Risk-free", value: RISK_FREE_RATE, fill: "#9DA5A2" },
    { name: "Beta x Implied ERP", value: derived.leveredBeta * impliedErp, fill: "#60CAAD" },
    { name: "CRP", value: KOREA_COUNTRY_RISK_PREMIUM, fill: "#444444" },
  ];

  const regionalMinard = [
    { region: "US", rf: RISK_FREE_RATE, erp: impliedErp, defaultSpread: 0.0, riskMultiplier: 0.0, crp: 0.0, revenue: 46 },
    { region: "EU", rf: RISK_FREE_RATE + 0.2, erp: impliedErp + 0.4, defaultSpread: 0.3, riskMultiplier: 1.0, crp: 0.3, revenue: 22 },
    { region: "Korea", rf: RISK_FREE_RATE + 0.4, erp: impliedErp + 1.2, defaultSpread: KOREA_COUNTRY_RISK_PREMIUM, riskMultiplier: 1.0, crp: KOREA_COUNTRY_RISK_PREMIUM, revenue: 12 },
    { region: "Emerging", rf: RISK_FREE_RATE + 0.9, erp: impliedErp + 2.1, defaultSpread: KOREA_COUNTRY_RISK_PREMIUM, riskMultiplier: 1.35, crp: Number((KOREA_COUNTRY_RISK_PREMIUM * 1.35).toFixed(1)), revenue: 20 },
  ];

  const betaTreemapProxy = [
    { name: "Industry", beta: Number(assumptions.unleveredBeta.toFixed(1)), size: 42 },
    { name: "Operating", beta: Number(clamp(0.75 + assumptions.reinvestment / 100, 0.6, 1.8).toFixed(1)), size: 28 },
    { name: "Financial", beta: Number(derived.leveredBeta.toFixed(2)), size: 30 },
  ];

  const waccCurve = Array.from({ length: 10 }, (_, idx) => {
    const debt = idx * 10;
    const curve = assumptions.wacc - 2.4 * (debt / 45) + 3.2 * Math.pow(debt / 70, 2);
    return { debt, wacc: Number(curve.toFixed(1)) };
  });

  const companyName = activeCompany.name;

  const valueMatrix = [
    {
      name: companyName,
      growth: assumptions.growth,
      spread: derived.spread,
      efficiency: clamp(assumptions.fcff / 1.6, 10, 100),
      fcff: assumptions.fcff,
    },
    { name: "Peer A", growth: 4.2, spread: 3.4, efficiency: 56, fcff: 70 },
    { name: "Peer B", growth: 8.5, spread: -1.8, efficiency: 44, fcff: 42 },
    { name: "Peer C", growth: 2.1, spread: 7.2, efficiency: 68, fcff: 60 },
  ];

  const riskReturn = [
    { risk: "Inflation", npv: derived.spread * 12 - 18, success: Number((derived.successProbability - 12).toFixed(1)), fail: Number((100 - derived.successProbability + 12).toFixed(2)) },
    { risk: "FX", npv: derived.spread * 10 - 6, success: Number((derived.successProbability - 5).toFixed(1)), fail: Number((100 - derived.successProbability + 5).toFixed(2)) },
    { risk: "Demand", npv: derived.spread * 9 + assumptions.growth, success: Number(derived.successProbability.toFixed(1)), fail: Number((100 - derived.successProbability).toFixed(2)) },
    { risk: "Margin", npv: derived.spread * 11 + assumptions.roic, success: Number((derived.successProbability + 4).toFixed(1)), fail: Number((96 - derived.successProbability).toFixed(2)) },
  ];

  // Downloadable raw dataset mirrors the assumptions, derived metrics, and chart inputs.
  const rawDatasetRows: RawDatasetRow[] = (() => {
    const rows: RawDatasetRow[] = [];
    const pushRecord = (dataset: string, record: object, source: string) => {
      Object.entries(record).forEach(([field, value]) => {
        rows.push({ dataset, field, value: value == null ? "" : String(value), source });
      });
    };
    const pushSeries = (dataset: string, series: object[], source: string) => {
      series.forEach((record, index) => pushRecord(`${dataset}[${index + 1}]`, record, source));
    };

    pushRecord("active_assumptions", assumptions, "Realtime controls, SQLite corporate_metrics, and browser localStorage fallback");
    pushRecord("derived_metrics", {
      debtToEquity: numberText(derived.debtToEquity),
      leveredBeta: numberText2(derived.leveredBeta),
      impliedMarketReturn: pct(impliedMarketReturn),
      impliedErp: pct(impliedErp),
      bottomUpKe: pct(derived.bottomUpKe),
      spread: pct(derived.spread),
      sustainableGrowth: pct(derived.sustainableGrowth),
      terminalValueShare: pct(derived.terminalValueShare),
      successProbability: pct(derived.successProbability),
      failureProbability: pct2(100 - derived.successProbability),
      agencyRisk: numberText(derived.agencyRisk),
      lifeCyclePosition: numberText(derived.lifeCyclePosition),
      healthScore: numberText(derived.healthScore),
    }, "Frontend formulas shown in View Details");
    pushRecord("implied_erp_inputs", {
      sp500IndexLevel: numberText(impliedErpInputs.indexLevel),
      dividendYield: pct(impliedErpInputs.dividendYield),
      buybackYield: pct(impliedErpInputs.buybackYield),
      fiveYearGrowthPath: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "),
      stableGrowth: pct(impliedErpInputs.stableGrowth),
      expectedMarketReturnIrr: pct(impliedMarketReturn),
      impliedErp: pct(impliedErp),
    }, "S&P 500 implied ERP model: price from market API; cash-flow yields and consensus growth path are model assumptions until constituent-level estimates are wired");
    if (dcfQuery.data) pushRecord("backend_dcf", dcfQuery.data, "FastAPI /corporate/dcf response");
    pushSeries("company_status_radar", healthRadar, "Company Status Diagnosis chart dataset");
    pushSeries("hurdle_rate_decomposition", regionalMinard, "Hurdle Rate Decomposition chart dataset");
    pushSeries("hurdle_bar_components", hurdleBars, "Bottom-up Ke component dataset");
    pushSeries("beta_wacc_curve_beta_components", betaTreemapProxy, "Bottom-up Beta chart dataset");
    pushSeries("wacc_curve", waccCurve, "WACC U-Curve chart dataset");
    pushSeries("value_driver_matrix", valueMatrix, "4-Quadrant Value Driver Matrix dataset");
    pushSeries("risk_return_minard", riskReturn, "Risk-Return Minard chart dataset");
    return rows;
  })();

  const annualGrowthRates = annualMetricRows(metricsHistoryQuery.data?.annual_growth_rates ?? []);
  const annualRoicValues = annualMetricRows(metricsHistoryQuery.data?.annual_roic ?? []);
  const selectedGrowthYearValue = annualGrowthRates.find((point) => String(point.year) === growthYear)?.value;
  const selectedRoicYearValue = annualRoicValues.find((point) => String(point.year) === roicYear)?.value;
  const growthYearUnavailableMessage = growthBasis === "annual" && selectedGrowthYearValue == null
    ? `${growthYear} Growth unavailable from Yahoo statements. Retaining the current/manual Growth Rate value.`
    : "";
  const roicYearUnavailableMessage = roicBasis === "annual" && selectedRoicYearValue == null
    ? `${roicYear} ROIC unavailable from Yahoo statements. Retaining the current/manual ROIC value.`
    : "";
  const growthBasisLabel = growthBasis === "cagr"
    ? "5-year CAGR"
    : growthBasis === "recent_average"
      ? "recent multi-year average"
      : `annual ${growthYear || annualGrowthRates.at(-1)?.year || ""}`.trim();
  const roicBasisLabel = roicBasis === "recent_average"
    ? "recent multi-year average"
    : roicBasis === "all_year_average"
      ? "all available years average"
      : `annual ${roicYear || annualRoicValues.at(-1)?.year || ""}`.trim();

  const sourceLabel = "Yahoo Finance annual financial statements from fiscal years 2021+ when available; current slider/browser values and saved presets are fallbacks or manual overrides";

  // Detail metadata powers the calculation transparency modal for every clickable section.
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
  }): CalculationDetail => ({
    title: `${companyName} ${title}`,
    timeHorizon,
    summary: [
      { label, value, source: "Final realtime assumption" },
      { label: "Ticker", value: assumptions.ticker, source: "Corporate company registry" },
      { label: "Unit", value: unit, source: "Display convention" },
      ...rawInputs,
    ],
    components: rawInputs,
    formula,
    result: value,
    sourcing: [
      { label: "Primary origin", value: source, source },
      { label: "Local persistence", value: "corporate_metrics", source: "SQLite" },
      { label: "Browser override", value: STORAGE_KEY, source: "localStorage fallback" },
      { label: "Fallback model", value: "Built-in preset or deterministic sector default", source: "Used only when no ticker-specific row exists" },
    ],
    simulation,
  });

  const calculationDetails: Record<CalculationDetailKey, CalculationDetail> = {
    realtime: {
      title: `${companyName} Realtime Assumptions`,
      timeHorizon: "Yahoo Finance annual statement window from fiscal years 2021+ where available. Growth uses 2021+ CAGR by default, ROIC can use annual or recent-average values, WACC and debt ratio use the latest available statement data, and CRP is fixed to South Korea.",
      summary: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: sourceLabel },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Country Risk Premium", value: pct(KOREA_COUNTRY_RISK_PREMIUM), source: "Fixed South Korea country risk premium" },
        { label: "FCFF", value: `$${numberText(assumptions.fcff)}B`, source: sourceLabel },
      ],
      components: [
        { label: "Ticker mapping", value: companyName, source: "Corporate company registry" },
        { label: "Primary storage key", value: assumptions.ticker, source: "Internal market-data identifier" },
        { label: "Persistence layer", value: "corporate_metrics", source: "SQLite" },
        { label: "Frontend cache", value: STORAGE_KEY, source: "Browser localStorage fallback" },
      ],
      formula: "Active assumptions = Yahoo annual statements from 2021 onward -> saved corporate_metrics fallback -> browser override/current slider state -> generated company/sector default",
      result: `${companyName} loaded with WACC ${pct(assumptions.wacc)}, ROIC ${pct(assumptions.roic)}, beta ${numberText(assumptions.unleveredBeta)}`,
      sourcing: [
        { label: "Company Name", value: companyName, source: "Corporate company registry / Portfolio watchlist" },
        { label: "Financial assumptions", value: "Yahoo annual statements from 2021 onward", source: "Primary source for statement-derived metrics" },
        { label: "Generated defaults", value: "Deterministic company/sector model", source: "Used only when Yahoo statements or saved ticker metrics are unavailable" },
        { label: "Market price for DCF", value: dcfQuery.data ? moneyText(dcfQuery.data.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `Read ${assumptions.ticker} Yahoo annual statements from 2021 onward`, source: "FastAPI corporate metrics endpoint" },
        { label: "2", value: `Apply browser override from ${STORAGE_KEY}`, source: "localStorage when present" },
        { label: "3", value: `Render ${pct(assumptions.growth)} growth, ${pct(assumptions.roic)} ROIC, ${pct(assumptions.wacc)} WACC`, source: "Final UI state" },
      ],
    },
    growth: {
      title: `${companyName} Growth Rate`,
      timeHorizon: `Yahoo Finance annual revenue values from fiscal years 2021+. Current display basis: ${growthBasisLabel}. Annual growth rates are shown below because 2021 can distort the full-period comparison.`,
      summary: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: sourceLabel },
        { label: "Selected basis", value: growthBasisLabel, source: "Growth basis control" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Realtime calculation" },
      ],
      components: [
        { label: "User growth input", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
        { label: "5-year CAGR", value: metricsHistoryQuery.data?.growth_cagr == null ? "Unavailable" : pct(metricsHistoryQuery.data.growth_cagr), source: "Yahoo annual revenue from 2021 onward" },
        { label: "Recent average", value: metricsHistoryQuery.data?.growth_recent_average == null ? "Unavailable" : pct(metricsHistoryQuery.data.growth_recent_average), source: "Average of the most recent annual growth rates" },
        ...annualGrowthRates.map((point) => ({ label: `${point.year} annual growth`, value: point.value == null ? "Unavailable" : pct(point.value), source: "Yahoo annual revenue YoY growth" })),
        { label: "Display override", value: "Slider/local browser value may override", source: "Realtime assumptions UI" },
      ],
      formula: "Growth Rate = average((Revenue_t / Revenue_t-1) - 1) x 100 across available Yahoo annual statement years from 2021 onward",
      result: pct(assumptions.growth),
      sourcing: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates, averaged across available years from 2021 onward" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Yahoo annual capex and D&A reinvestment proxy, averaged across available years from 2021 onward" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital, averaged across available years from 2021 onward" },
      ],
      simulation: [
        { label: "1", value: `Read Yahoo annual revenue from 2021 onward`, source: "Corporate metrics history endpoint" },
        { label: "2", value: `Apply selected basis: ${growthBasisLabel}`, source: sourceLabel },
        { label: "3", value: pct(assumptions.growth), source: "Final Growth Rate" },
      ],
    },
    roic: assumptionDetail({
      title: "ROIC",
      label: "ROIC",
      value: pct(assumptions.roic),
      unit: "Percent",
      rawInputs: [
        { label: "NOPAT proxy", value: pct(assumptions.roic), source: "Yahoo operating income x (1 - average statement tax rate)" },
        { label: "Invested capital proxy", value: "Debt + equity - cash", source: "Yahoo annual balance sheet" },
        { label: "Selected basis", value: roicBasisLabel, source: "ROIC basis control" },
        ...annualRoicValues.map((point) => ({ label: `${point.year} ROIC`, value: point.value == null ? "Unavailable" : pct(point.value), source: "Annual Yahoo NOPAT / invested capital" })),
      ],
      source: "Yahoo annual statements: calculate ROIC for each available fiscal year from 2021 onward, then average annual ROIC values",
      timeHorizon: `Annual values from fiscal years 2021+. Current display basis: ${roicBasisLabel}; ROIC can be set to a single year or a recent/all-year average.`,
      formula: "ROIC = NOPAT / Invested Capital x 100",
      simulation: [
        { label: "1", value: `${pct(assumptions.roic)} / 100.0`, source: numberText(assumptions.roic / 100) },
        { label: "2", value: `${numberText(assumptions.roic / 100)} x 100`, source: pct(assumptions.roic) },
        { label: "3", value: pct(assumptions.roic), source: "Final ROIC assumption" },
      ],
    }),
    wacc: assumptionDetail({
      title: "WACC",
      label: "WACC",
      value: pct(assumptions.wacc),
      unit: "Percent",
      rawInputs: [
        { label: "Cost of equity", value: pct(derived.bottomUpKe), source: "Risk-free rate + implied ERP + beta model" },
        { label: "Debt ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual statement average debt ratio from 2021 onward when available" },
        { label: "Tax rate", value: pct(TAX_RATE * 100), source: "Corporate tax assumption" },
      ],
      source: "Yahoo beta plus the latest available Yahoo annual statement debt/equity/tax/cost-of-debt inputs; South Korea CRP and base market rates are model inputs",
      timeHorizon: "WACC uses the most recent available annual statement capital structure rather than a 5-year average.",
      formula: "WACC = E/V x Ke + D/V x Kd x (1 - tax)",
      simulation: [
        { label: "1", value: `Selected WACC input ${pct(assumptions.wacc)}`, source: sourceLabel },
        { label: "2", value: `Compare with bottom-up Ke ${pct(derived.bottomUpKe)}`, source: `Spread ${pct(assumptions.roic - assumptions.wacc)}` },
        { label: "3", value: pct(assumptions.wacc), source: "Final WACC assumption" },
      ],
    }),
    debtRatio: assumptionDetail({
      title: "Debt Ratio",
      label: "Debt Ratio",
      value: pct(assumptions.debtRatio),
      unit: "Percent of enterprise capital",
      rawInputs: [
        { label: "Debt weight", value: pct(assumptions.debtRatio), source: "Most recent Yahoo annual debt / (debt + equity)" },
        { label: "Equity weight", value: pct(100 - assumptions.debtRatio), source: "1 - debt weight" },
      ],
      source: "Yahoo annual balance sheet debt and equity values",
      timeHorizon: "Uses the most recent available annual Yahoo balance sheet, not a 5-year average.",
      formula: "Debt Ratio = Debt / (Debt + Equity) x 100",
      simulation: [
        { label: "1", value: `${pct(assumptions.debtRatio)} debt weight`, source: sourceLabel },
        { label: "2", value: `100.0% - ${pct(assumptions.debtRatio)} = ${pct(100 - assumptions.debtRatio)}`, source: "Equity weight" },
        { label: "3", value: pct(assumptions.debtRatio), source: "Final Debt Ratio assumption" },
      ],
    }),
    unleveredBeta: assumptionDetail({
      title: "Unlevered Beta",
      label: "Unlevered Beta",
      value: numberText(assumptions.unleveredBeta),
      unit: "Beta multiple",
      rawInputs: [
        { label: "Raw beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo Finance levered beta de-levered with average Yahoo statement D/E and tax rate" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Equity beta after applying financial leverage" },
        { label: "Beta Difference", value: numberText2(derived.leveredBeta - assumptions.unleveredBeta), source: "Levered beta - unlevered beta" },
        { label: "Beta interpretation", value: betaInterpretation(assumptions.unleveredBeta), source: "Beta convention: 1.0 average market risk; above 1.0 more volatile; below 1.0 less volatile" },
        { label: "Debt-to-equity", value: numberText(derived.debtToEquity), source: "Debt ratio conversion" },
      ],
      source: "Yahoo Finance market beta plus Yahoo annual statement average debt/equity and tax-rate inputs",
      timeHorizon: "Unlevered beta is derived from Yahoo beta and averaged annual statement capital structure from fiscal years 2021+; it is not directly reported in financial statements.",
      formula: "Unlevered Beta = Levered Beta / [1 + (1 - tax) x D/E]",
      simulation: [
        { label: "1", value: `Use betaU ${numberText(assumptions.unleveredBeta)}`, source: sourceLabel },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - TAX_RATE) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "3", value: numberText(assumptions.unleveredBeta), source: "Final Unlevered Beta assumption" },
      ],
    }),
    leveredBeta: {
      title: `${companyName} Levered Beta`,
      timeHorizon: "5-year beta convention for business risk, adjusted with the current debt ratio and tax-rate assumption.",
      summary: [
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Interpretation", value: betaInterpretation(derived.leveredBeta), source: "Market-risk convention" },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: `Debt ratio ${pct(assumptions.debtRatio)} / equity ratio ${pct(100 - assumptions.debtRatio)}` },
        { label: "Tax Shield", value: pct((1 - TAX_RATE) * 100), source: `1 - tax rate ${pct(TAX_RATE * 100)}` },
      ],
      components: [
        { label: "Beta = 1.0", value: "Average market risk", source: "Benchmark interpretation" },
        { label: "Beta > 1.0", value: "More volatile than the market", source: "Example: beta 1.5 implies 50.0% higher risk than the market" },
        { label: "Beta < 1.0", value: "Less volatile than the market", source: "Example: beta 0.7 implies 30.0% lower risk than the market" },
        { label: "Business risk", value: numberText(assumptions.unleveredBeta), source: "Unlevered beta" },
        { label: "Financial leverage", value: numberText(derived.debtToEquity), source: "Debt / equity conversion" },
        { label: "Tax shield", value: pct((1 - TAX_RATE) * 100), source: "After-tax leverage adjustment" },
      ],
      formula: "Levered Beta = betaU x [1 + (1 - tax rate) x D/E]",
      result: numberText2(derived.leveredBeta),
      sourcing: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo beta de-levered with averaged annual statement D/E and tax rate from 2021 onward" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt / (debt + equity), averaged from 2021 onward" },
        { label: "Tax Rate", value: pct(TAX_RATE * 100), source: "Corporate tax assumption | Period: current model policy" },
      ],
      simulation: [
        { label: "1", value: `D/E = ${pct(assumptions.debtRatio)} / ${pct(100 - assumptions.debtRatio)}`, source: numberText(derived.debtToEquity) },
        { label: "2", value: `1 + ${pct((1 - TAX_RATE) * 100)} x ${numberText(derived.debtToEquity)}`, source: numberText(1 + (1 - TAX_RATE) * derived.debtToEquity) },
        { label: "3", value: `${numberText(assumptions.unleveredBeta)} x ${numberText(1 + (1 - TAX_RATE) * derived.debtToEquity)}`, source: numberText2(derived.leveredBeta) },
      ],
    },
    crp: assumptionDetail({
      title: "Country Risk Premium",
      label: "Country Risk Premium",
      value: pct(KOREA_COUNTRY_RISK_PREMIUM),
      unit: "Percent",
      rawInputs: [
        { label: "South Korea CRP", value: pct(KOREA_COUNTRY_RISK_PREMIUM), source: "Fixed country-risk assumption" },
      ],
      source: "Country risk fallback; Yahoo financial statements do not report country risk premium",
      timeHorizon: "Fixed South Korea country-risk assumption. This metric cannot be fetched from Yahoo financial statements.",
      formula: "CRP = fixed South Korea country risk premium",
      simulation: [
        { label: "1", value: `Use South Korea CRP ${pct(KOREA_COUNTRY_RISK_PREMIUM)}`, source: "Fixed country-risk assumption" },
        { label: "2", value: `${pct(RISK_FREE_RATE)} + beta x implied ERP + ${pct(KOREA_COUNTRY_RISK_PREMIUM)}`, source: "Feeds Bottom-up Ke" },
      ],
    }),
    erp: {
      title: `${companyName} Implied Equity Risk Premium`,
      timeHorizon: "Current S&P 500 level from the market API when available; cash-flow yields and 5-year growth path are model assumptions until constituent-level dividends, buybacks, and analyst estimates are connected.",
      summary: [
        { label: "S&P 500 Level", value: numberText(impliedErpInputs.indexLevel), source: sp500Query.data ? "Market API /market/index/^GSPC latest close" : "Fallback normalized index level" },
        { label: "Expected Market Return (IRR)", value: pct(impliedMarketReturn), source: "Reverse-engineered from projected cash flows" },
        { label: "Implied ERP", value: pct(impliedErp), source: "Expected market return - risk-free rate" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Beta x Implied ERP", value: pct(derived.leveredBeta * impliedErp), source: "Equity risk premium contribution" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Hurdle-rate model" },
      ],
      components: [
        { label: "Current Price", value: numberText(impliedErpInputs.indexLevel), source: "S&P 500 index level" },
        { label: "Cash Flows", value: `${pct(impliedErpInputs.dividendYield)} dividends + ${pct(impliedErpInputs.buybackYield)} buybacks`, source: "Aggregate cash-flow yield proxy" },
        { label: "5Y Growth Assumptions", value: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "), source: "Analyst-consensus growth path proxy" },
        { label: "Stable Growth", value: pct(impliedErpInputs.stableGrowth), source: "Converges to risk-free rate after year 5" },
        { label: "Implied ERP", value: pct(impliedErp), source: "IRR - risk-free rate" },
        { label: "Company beta multiplier", value: numberText2(derived.leveredBeta), source: "Levered Beta" },
        { label: "Contribution to Ke", value: pct(derived.leveredBeta * impliedErp), source: "Levered Beta x Implied ERP" },
      ],
      formula: "Implied ERP = Expected Market Return (IRR) - Risk-Free Rate; Equity Risk Premium Contribution = Levered Beta x Implied ERP",
      result: pct(derived.leveredBeta * impliedErp),
      sourcing: [
        { label: "S&P 500 Price", value: numberText(impliedErpInputs.indexLevel), source: "Market API /market/index/^GSPC | Period: current latest close or normalized fallback" },
        { label: "Cash Flow Yield", value: pct(impliedErpInputs.dividendYield + impliedErpInputs.buybackYield), source: "Dividend + share-buyback yield proxy | Replace with constituent aggregation when available" },
        { label: "Growth", value: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "), source: "5-year analyst-consensus growth path proxy" },
        { label: "Stable Growth", value: pct(impliedErpInputs.stableGrowth), source: "Risk-free rate as long-term economic growth proxy" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada beta model | Period: 5-year beta convention plus current leverage" },
        { label: "Risk-free Rate", value: pct(RISK_FREE_RATE), source: "FRED / macro assumption | Period: current market snapshot" },
      ],
      simulation: [
        { label: "1", value: `Solve IRR where S&P 500 price ${numberText(impliedErpInputs.indexLevel)} equals PV of dividends + buybacks and terminal value`, source: pct(impliedMarketReturn) },
        { label: "2", value: `${pct(impliedMarketReturn)} - ${pct(RISK_FREE_RATE)}`, source: pct(impliedErp) },
        { label: "3", value: `${numberText2(derived.leveredBeta)} x ${pct(impliedErp)}`, source: pct(derived.leveredBeta * impliedErp) },
        { label: "4", value: `${pct(RISK_FREE_RATE)} + ${pct(derived.leveredBeta * impliedErp)} + ${pct(KOREA_COUNTRY_RISK_PREMIUM)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    failureProbability: {
      title: `${companyName} Failure Probability`,
      timeHorizon: "Current realtime risk-return scenario projected across Inflation, FX, Demand, and Margin risk segments.",
      summary: [
        { label: "Failure Probability", value: pct2(100 - derived.successProbability), source: "100 - success probability" },
        { label: "Success Probability", value: pct(derived.successProbability), source: "Risk-return scenario score" },
        { label: "Spread", value: pct(derived.spread), source: "ROIC - WACC" },
        { label: "ESG / Agency Penalty", value: numberText(assumptions.esgPenalty), source: "Risk penalty input" },
      ],
      components: riskReturn.map((item) => ({
        label: item.risk,
        value: `fail ${pct2(item.fail)}, success ${pct(item.success)}, NPV ${numberText(item.npv)}`,
        source: "Risk-return segment simulation",
      })),
      formula: "Failure Probability = 100 - clamp(55 + spread x 2.3 + growth - ESG penalty x 0.25, 5, 95)",
      result: pct2(100 - derived.successProbability),
      sourcing: [
        { label: "Spread", value: pct(derived.spread), source: "Realtime ROIC and WACC | Period: current assumption state" },
        { label: "Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward, or current override" },
        { label: "ESG / Agency Penalty", value: numberText(assumptions.esgPenalty), source: "Governance risk input / SQLite corporate_metrics | Period: latest governance review" },
      ],
      simulation: [
        { label: "1", value: `Success = 55.0 + ${numberText(derived.spread)} x 2.3 + ${numberText(assumptions.growth)} - ${numberText(assumptions.esgPenalty)} x 0.25`, source: pct(derived.successProbability) },
        { label: "2", value: `100.00% - ${pct2(derived.successProbability)}`, source: pct2(100 - derived.successProbability) },
        { label: "3", value: pct2(100 - derived.successProbability), source: "Final Failure Probability" },
      ],
    },
    reinvestment: assumptionDetail({
      title: "Reinvestment Rate",
      label: "Reinvestment Rate",
      value: pct(assumptions.reinvestment),
      unit: "Percent",
      rawInputs: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Yahoo annual max(capex - D&A, 0) / NOPAT, averaged across available years from 2021 onward" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Return on invested capital input" },
      ],
      source: "Yahoo annual cash-flow and income-statement values",
      timeHorizon: "Annual reinvestment rates from fiscal years 2021+ are averaged; this is not calculated from one pooled 5-year total.",
      formula: "Reinvestment Rate = Reinvestment / NOPAT x 100",
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `${numberText(assumptions.reinvestment)} x ${numberText(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "3", value: pct(assumptions.reinvestment), source: "Final Reinvestment Rate assumption" },
      ],
    }),
    innovation: assumptionDetail({
      title: "Innovation Index",
      label: "Innovation Index",
      value: numberText(assumptions.innovation),
      unit: "0-100 score",
      rawInputs: [
        { label: "Product / R&D score", value: numberText(assumptions.innovation), source: "Yahoo annual R&D / revenue intensity proxy, scaled to a 0-100 score and averaged from 2021 onward" },
        { label: "Radar peer baseline", value: "66.0", source: "UI peer benchmark" },
      ],
      source: "Yahoo annual income statement R&D intensity proxy when available; saved/preset score is fallback",
      timeHorizon: "Annual R&D intensity values from fiscal years 2021+ are scaled and averaged; Yahoo does not directly report an Innovation Index.",
      formula: "Innovation Index = clamp((R&D / revenue x 100) x 10, 0, 100), averaged across annual statement years",
      simulation: [
        { label: "1", value: `Normalize raw innovation signal to ${numberText(assumptions.innovation)}`, source: "0-100 scale" },
        { label: "2", value: `${numberText(assumptions.innovation)} - 66.0`, source: `Peer gap ${numberText(assumptions.innovation - 66)}` },
        { label: "3", value: numberText(assumptions.innovation), source: "Final Innovation Index assumption" },
      ],
    }),
    governance: assumptionDetail({
      title: "Governance Quality",
      label: "Governance Quality",
      value: numberText(assumptions.governance),
      unit: "0-100 score",
      rawInputs: [
        { label: "Governance score", value: numberText(assumptions.governance), source: "Annual Report / proxy statement review" },
        { label: "ESG / Agency Penalty", value: numberText(assumptions.esgPenalty), source: "Risk penalty input" },
      ],
      source: "Annual Report, proxy statement, and governance review normalized into SQLite corporate_metrics",
      timeHorizon: "Latest annual report or proxy statement cycle.",
      formula: "Governance Quality = normalized governance score on a 0-100 scale",
      simulation: [
        { label: "1", value: `Agency risk = 100.0 - ${numberText(assumptions.governance)} + ${numberText(assumptions.esgPenalty)}`, source: numberText(derived.agencyRisk) },
        { label: "2", value: `Clamp ${numberText(derived.agencyRisk)} to 0.0-100.0`, source: numberText(derived.agencyRisk) },
        { label: "3", value: numberText(assumptions.governance), source: "Final Governance Quality assumption" },
      ],
    }),
    esgPenalty: assumptionDetail({
      title: "ESG / Agency Penalty",
      label: "ESG / Agency Penalty",
      value: numberText(assumptions.esgPenalty),
      unit: "0-100 penalty score",
      rawInputs: [
        { label: "Penalty score", value: numberText(assumptions.esgPenalty), source: "ESG / agency risk review" },
        { label: "Governance offset", value: numberText(assumptions.governance), source: "Governance quality input" },
      ],
      source: "ESG risk review, governance notes, and sector preset normalized into SQLite corporate_metrics",
      timeHorizon: "Latest annual report, controversy, or governance review cycle.",
      formula: "Agency Risk = clamp(100 - Governance Quality + ESG / Agency Penalty, 0, 100)",
      simulation: [
        { label: "1", value: `100.0 - ${numberText(assumptions.governance)} + ${numberText(assumptions.esgPenalty)}`, source: numberText(derived.agencyRisk) },
        { label: "2", value: `Success probability penalty = ${numberText(assumptions.esgPenalty)} x 0.25`, source: numberText(assumptions.esgPenalty * 0.25) },
        { label: "3", value: numberText(assumptions.esgPenalty), source: "Final ESG / Agency Penalty assumption" },
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
    },
    bottomUpKe: {
      title: `${companyName} Bottom-up Ke`,
      timeHorizon: "Current market snapshot for risk-free rate and implied ERP; fixed South Korea CRP; latest Yahoo statement capital structure for leverage.",
      summary: [
        { label: "Risk-free Rate", value: pct(RISK_FREE_RATE), source: "Manual macro assumption" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Implied Equity Risk Premium", value: pct(impliedErp), source: "S&P 500 implied ERP model" },
        { label: "Country Risk Premium", value: pct(KOREA_COUNTRY_RISK_PREMIUM), source: "Fixed South Korea country risk premium" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Realtime calculation" },
      ],
      components: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Ticker-specific corporate metric" },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: `Debt Ratio ${pct(assumptions.debtRatio)} / Equity Ratio ${pct(100 - assumptions.debtRatio)}` },
        { label: "Tax Shield", value: pct((1 - TAX_RATE) * 100), source: `1 - tax rate ${pct(TAX_RATE * 100)}` },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "betaU x [1 + (1 - tax) x D/E]" },
      ],
      formula: `Ke = ${pct(RISK_FREE_RATE)} + ${numberText2(derived.leveredBeta)} x ${pct(impliedErp)} + ${pct(KOREA_COUNTRY_RISK_PREMIUM)}`,
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: "Risk-free Rate", value: pct(RISK_FREE_RATE), source: "Manual macro assumption" },
        { label: "Implied ERP", value: pct(impliedErp), source: "Expected market return IRR - risk-free rate" },
        { label: "CRP", value: pct(KOREA_COUNTRY_RISK_PREMIUM), source: "Fixed South Korea country risk premium" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt ratios averaged from 2021 onward" },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo beta de-levered with averaged annual statement D/E and tax rate" },
      ],
      simulation: [
        { label: "1", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - TAX_RATE) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "2", value: `${pct(RISK_FREE_RATE)} + ${numberText2(derived.leveredBeta)} x ${pct(impliedErp)} + ${pct(KOREA_COUNTRY_RISK_PREMIUM)}`, source: pct(derived.bottomUpKe) },
        { label: "3", value: pct(derived.bottomUpKe), source: "Final Bottom-up Ke" },
      ],
    },
    backendDcf: {
      title: `${companyName} Backend DCF`,
      timeHorizon: "Current realtime assumption set sent to the backend DCF endpoint; market price uses the latest available quote/cache point.",
      summary: [
        { label: "Estimated Fair Value", value: dcfQuery.data ? moneyText(dcfQuery.data.estimated_value) : "Calculating", source: "Backend DCF engine" },
        { label: "Current Price", value: dcfQuery.data ? moneyText(dcfQuery.data.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
        { label: "Upside / Downside", value: dcfQuery.data ? pct(dcfQuery.data.upside_pct) : "Loading", source: "Realtime calculation" },
        { label: "Status", value: dcfQuery.data?.status ?? "Calculating", source: "DCF value-vs-price rule" },
      ],
      components: [
        { label: "Revenue Growth", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
        { label: "Operating Margin Proxy", value: pct(clamp(assumptions.roic, -100, 100)), source: "ROIC input mapped to backend margin" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Realtime Assumptions control" },
        { label: "Terminal Growth", value: pct(clamp(assumptions.growth, -10, 10)), source: "Growth input clamped to backend boundary" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Realtime Assumptions control" },
      ],
      formula: `Backend DCF request = growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, terminal growth ${pct(clamp(assumptions.growth, -10, 10))}, FCFF ${moneyText(assumptions.fcff)}B`,
      result: dcfQuery.data ? `${moneyText(dcfQuery.data.estimated_value)} fair value, ${pct(dcfQuery.data.upside_pct)} versus current price` : "Calculating",
      sourcing: [
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Assumptions", value: "Debounced ticker inputs", source: "Corporate Analysis UI" },
        { label: "Market price", value: dcfQuery.data ? moneyText(dcfQuery.data.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `Send growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, FCFF ${moneyText(assumptions.fcff)}B`, source: "DCF request payload" },
        { label: "2", value: dcfQuery.data ? `${moneyText(dcfQuery.data.estimated_value)} / ${moneyText(dcfQuery.data.current_price)} - 1` : "Waiting for backend result", source: dcfQuery.data ? pct(dcfQuery.data.upside_pct) : "Loading" },
        { label: "3", value: dcfQuery.data ? `${moneyText(dcfQuery.data.estimated_value)} fair value` : "Calculating", source: "Final Backend DCF result" },
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
    companyStatus: {
      title: `${companyName} Company Status Diagnosis`,
      timeHorizon: `Current realtime assumption set. Subjective Innovation, Governance, and ESG/Agency inputs are ${includeSubjectiveHealth ? "included" : "excluded"} from the health score; peer baselines are static UI benchmarks.`,
      summary: [
        { label: "Health Score", value: numberText(derived.healthScore), source: "Radar composite" },
        { label: "Subjective inputs", value: includeSubjectiveHealth ? "Included" : "Excluded", source: "Company Status Diagnosis toggle" },
        { label: "Growth Axis", value: numberText(clamp(assumptions.growth * 7, 0, 100)), source: "How: growth rate x 7 clamped to 0-100 for radar display" },
        { label: "Market Share", value: numberText(assumptions.marketShare), source: "How: normalized competitive-position input on a 0-100 scale" },
        { label: "Life Cycle", value: numberText(derived.lifeCyclePosition), source: "How: clamp(35 + growth x 2.5 - debt ratio x 0.3, 0, 100)" },
        { label: "Levered Beta Risk", value: numberText(derived.leveredBetaRiskScore), source: `How: beta risk score from levered beta ${numberText2(derived.leveredBeta)}` },
        ...(includeSubjectiveHealth
          ? [
            { label: "Innovation", value: numberText(assumptions.innovation), source: "How: normalized product and R&D momentum input on a 0-100 scale" },
            { label: "Governance", value: numberText(assumptions.governance), source: "How: normalized ownership, disclosure, accountability, and alignment score" },
            { label: "Agency Risk Score", value: numberText(100 - derived.agencyRisk), source: "How: 100 - clamp(100 - governance + ESG penalty, 0, 100)" },
          ]
          : []),
      ],
      components: [
        { label: "Growth", value: numberText(clamp(assumptions.growth * 7, 0, 100)), source: `How: radar axis = clamp(${numberText(assumptions.growth)} x 7.0, 0.0, 100.0); composite contribution = ${numberText(assumptions.growth)} x 2.0. Why: growth captures reinvestment runway and terminal value capacity, but the composite dampens it to avoid letting growth dominate quality factors.` },
        { label: "Market Share", value: numberText(assumptions.marketShare), source: `How: normalized competitive-position and scale input on a 0.0-100.0 scale. Why: larger share can protect pricing power, margins, and forecast durability.` },
        { label: "Life Cycle", value: numberText(derived.lifeCyclePosition), source: `How: clamp(35.0 + growth ${numberText(assumptions.growth)} x 2.5 - debt ratio ${numberText(assumptions.debtRatio)} x 0.3, 0.0, 100.0). Why: life-cycle stage affects reinvestment needs, maturity risk, and terminal assumptions.` },
        { label: "Levered Beta Risk", value: numberText(derived.leveredBetaRiskScore), source: `How: clamp(100.0 - max(levered beta ${numberText2(derived.leveredBeta)} - 1.0, 0.0) x 35.0, 0.0, 100.0). Why: higher financial leverage raises equity risk versus unlevered business risk.` },
        ...(includeSubjectiveHealth
          ? [
            { label: "Innovation", value: numberText(assumptions.innovation), source: `How: normalized product, technology, and R&D momentum input on a 0.0-100.0 scale. Why: innovation supports moat renewal, future growth, and optionality.` },
            { label: "Governance", value: numberText(assumptions.governance), source: `How: normalized ownership, disclosure, voting alignment, accountability, and management-quality input on a 0.0-100.0 scale. Why: stronger governance improves capital allocation reliability and reduces agency-cost discounts.` },
            { label: "Agency Risk", value: numberText(100 - derived.agencyRisk), source: `How: raw risk = clamp(100.0 - governance ${numberText(assumptions.governance)} + ESG/agency penalty ${numberText(assumptions.esgPenalty)}, 0.0, 100.0) = ${numberText(derived.agencyRisk)}; displayed score = 100.0 - raw risk. Why: lower governance friction and lower agency costs reduce execution and valuation haircut risk.` },
          ]
          : []),
      ],
      formula: includeSubjectiveHealth
        ? "Health Score = average(growth x 2, market share, life cycle, levered beta risk, innovation, governance, 100 - agency risk)"
        : "Health Score = average(growth x 2, market share, life cycle, levered beta risk)",
      result: numberText(derived.healthScore),
      sourcing: [
        { label: "Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available | Method: radar axis = growth x 7; composite contribution = growth x 2" },
        { label: "Life Cycle", value: numberText(derived.lifeCyclePosition), source: "Growth and debt ratio inputs | Method: clamp(35 + growth x 2.5 - debt ratio x 0.3, 0, 100)" },
        { label: "Levered Beta Risk", value: numberText(derived.leveredBetaRiskScore), source: "Levered beta risk penalty included in Company Status Diagnosis" },
        { label: "Market Share", value: numberText(assumptions.marketShare), source: "Annual Report / sector preset / SQLite corporate_metrics | Method: normalized 0-100 score" },
        ...(includeSubjectiveHealth
          ? [
            { label: "Agency Risk", value: numberText(derived.agencyRisk), source: "Governance and ESG penalty inputs | Method: clamp(100 - governance + ESG penalty, 0, 100), then invert for the displayed score" },
            { label: "Governance", value: numberText(assumptions.governance), source: "Proxy statement / governance review / SQLite corporate_metrics | Method: normalized 0-100 score" },
            { label: "Innovation", value: numberText(assumptions.innovation), source: "Yahoo annual R&D / revenue intensity proxy averaged from 2021 onward when available | Method: normalized 0-100 score" },
          ]
          : []),
      ],
      simulation: [
        { label: "1", value: `Growth axis = clamp(${numberText(assumptions.growth)} x 7.0, 0.0, 100.0); composite growth = ${numberText(assumptions.growth)} x 2.0`, source: `${numberText(clamp(assumptions.growth * 7, 0, 100))} axis; ${numberText(assumptions.growth * 2)} composite` },
        { label: "2", value: `Levered beta risk = clamp(100.0 - max(${numberText2(derived.leveredBeta)} - 1.0, 0.0) x 35.0, 0.0, 100.0)`, source: numberText(derived.leveredBetaRiskScore) },
        { label: "3", value: `Life cycle = clamp(35.0 + ${numberText(assumptions.growth)} x 2.5 - ${numberText(assumptions.debtRatio)} x 0.3, 0.0, 100.0)`, source: numberText(derived.lifeCyclePosition) },
        { label: "4", value: includeSubjectiveHealth ? "Composite includes subjective innovation, governance, and agency scores" : "Composite excludes subjective innovation, governance, and agency scores", source: numberText(derived.healthScore) },
      ],
    },
    hurdleDecomposition: {
      title: `${companyName} Hurdle Rate Decomposition`,
      timeHorizon: "Current market snapshot for risk-free rate and market-implied ERP, shown across US, EU, Korea, and emerging-market hurdle-rate indicators. Korea uses the fixed Korea CRP assumption.",
      summary: [
        { label: "Risk-free Rate", value: pct(RISK_FREE_RATE), source: "FRED / macro assumption" },
        { label: "Expected Market Return (IRR)", value: pct(impliedMarketReturn), source: "S&P 500 implied return from price and projected cash flows" },
        { label: "Implied ERP", value: pct2(impliedErp), source: "Expected market return - risk-free rate" },
        { label: "Beta x Implied ERP", value: pct(derived.leveredBeta * impliedErp), source: "Levered beta multiplied by implied ERP" },
        { label: "CRP", value: pct(KOREA_COUNTRY_RISK_PREMIUM), source: "Fixed South Korea country risk premium" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Realtime hurdle-rate model" },
      ],
      components: regionalMinard.map((region) => ({
        label: region.region,
        value: `RF ${pct(region.rf)}, implied ERP ${pct2(region.erp)}, spread ${pct(region.defaultSpread)}, multiplier ${numberText(region.riskMultiplier)}, CRP ${pct(region.crp)}, revenue weight ${numberText(region.revenue)}`,
        source: region.region === "US"
          ? "US indicator uses mature-market CRP of 0.0%; market risk is carried through implied ERP."
          : region.region === "Korea"
            ? "Korea indicator applies the fixed Korea country risk premium."
            : `${region.region} indicator applies the regional default spread and risk multiplier proxy.`,
      })),
      formula: "Bottom-up Ke = risk-free rate + levered beta x implied ERP + selected-region CRP; Implied ERP = market IRR - risk-free rate",
      result: pct(derived.bottomUpKe),
      sourcing: [
        ...regionalMinard.map((region) => ({
          label: region.region,
          value: `RF ${pct(region.rf)}, implied ERP ${pct2(region.erp)}, CRP ${pct(region.crp)}`,
          source: region.region === "Korea" ? "Fixed Korea CRP assumption" : "Regional hurdle-rate indicator",
        })),
      ],
      simulation: [
        { label: "1", value: `Show US, EU, Korea, and emerging-market indicators`, source: "Regional hurdle-rate indicator set" },
        { label: "2", value: `Implied ERP = market IRR ${pct(impliedMarketReturn)} - risk-free rate ${pct(RISK_FREE_RATE)}`, source: pct2(impliedErp) },
        { label: "3", value: `Levered beta premium = ${numberText2(derived.leveredBeta)} x ${pct2(impliedErp)}`, source: pct(derived.leveredBeta * impliedErp) },
        { label: "4", value: `${pct(RISK_FREE_RATE)} + ${pct(derived.leveredBeta * impliedErp)} + ${pct(KOREA_COUNTRY_RISK_PREMIUM)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    betaWaccCurve: {
      title: `${companyName} Bottom-up Beta + WACC U-Curve`,
      timeHorizon: "5-year beta convention for business risk; WACC curve is a current scenario sweep from 0% to 90% debt.",
      summary: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: "Debt ratio conversion" },
        { label: "Financial Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Current Debt Ratio", value: pct(assumptions.debtRatio), source: "Reference line on WACC curve" },
      ],
      components: [
        ...betaTreemapProxy.map((item) => ({
          label: `${item.name} beta`,
          value: item.name === "Financial" ? numberText2(item.beta) : numberText(item.beta),
          source: item.name === "Industry"
            ? `Segment size ${numberText(item.size)}. Industry Beta is the pure business risk of the sector before company-specific capital structure. ${betaInterpretation(item.beta)}`
            : item.name === "Operating"
              ? `Segment size ${numberText(item.size)}. Operating Beta (Unlevered) is asset risk from the operating business excluding financial structure. ${betaInterpretation(item.beta)}`
              : `Segment size ${numberText(item.size)}. Financial Beta is the additional equity risk incurred from financial leverage and debt. ${betaInterpretation(item.beta)}`
        })),
        ...waccCurve.map((point) => ({ label: `${numberText(point.debt)}% debt`, value: pct(point.wacc), source: "WACC U-curve scenario point" })),
      ],
      formula: "Levered Beta = betaU x [1 + (1 - tax) x D/E]; WACC curve = WACC - 2.4 x debt/45 + 3.2 x (debt/70)^2",
      result: `${numberText2(derived.leveredBeta)} beta; current WACC ${pct(assumptions.wacc)}`,
      sourcing: [
        { label: "Industry Beta", value: numberText(assumptions.unleveredBeta), source: "Pure sector business risk before company capital structure adjustments" },
        { label: "Operating Beta (Unlevered)", value: numberText(assumptions.unleveredBeta), source: "Asset risk excluding financial structure; Yahoo beta de-levered with averaged annual statement D/E and tax rate" },
        { label: "Financial Beta", value: numberText2(derived.leveredBeta), source: "Additional leverage risk from Hamada formula after applying D/E and tax shield" },
        { label: "Beta convention", value: betaInterpretation(derived.leveredBeta), source: "Beta 1.0 = average market risk; beta above/below 1.0 means proportionally higher/lower volatility" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt / (debt + equity), averaged from 2021 onward" },
        { label: "Tax Rate", value: pct(TAX_RATE * 100), source: "Corporate tax assumption" },
      ],
      simulation: [
        { label: "1", value: `D/E = ${pct(assumptions.debtRatio)} / ${pct(100 - assumptions.debtRatio)}`, source: numberText(derived.debtToEquity) },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - TAX_RATE) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "3", value: `Current curve marker at ${pct(assumptions.debtRatio)}`, source: pct(assumptions.wacc) },
      ],
    },
    valueDriverMatrix: {
      title: `${companyName} 4-Quadrant Value Driver Matrix`,
      timeHorizon: "Current realtime company assumptions plus static peer scenario points used for quadrant context.",
      summary: [
        { label: "Growth", value: pct(assumptions.growth), source: "X-axis" },
        { label: "ROIC - WACC", value: pct(derived.spread), source: "Y-axis" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Bubble size" },
        { label: "Quadrant", value: derived.spread >= 0 && assumptions.growth >= 0 ? "Growth + value creation" : "Review required", source: "Quadrant rule" },
      ],
      components: valueMatrix.map((item) => ({
        label: item.name,
        value: `growth ${pct(item.growth)}, spread ${pct(item.spread)}, FCFF ${numberText(item.fcff)}`,
        source: item.name === companyName ? "Current company segment" : "Static peer scenario segment",
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
    riskReturnMinard: {
      title: `${companyName} Risk-Return Minard Chart`,
      timeHorizon: "Current realtime assumptions projected across static risk segments: Inflation, FX, Demand, and Margin.",
      summary: [
        { label: "Success Probability", value: pct(derived.successProbability), source: "Scenario score" },
        { label: "Failure Probability", value: pct2(100 - derived.successProbability), source: "100 - success probability" },
        { label: "X-axis", value: "Risk exposure segments", source: "Inflation, FX, Demand, and Margin are ordered scenario exposures used to compare expected return against failure probability." },
        { label: "Spread", value: pct(derived.spread), source: "ROIC - WACC" },
        { label: "Growth", value: pct(assumptions.growth), source: "Realtime Assumptions" },
      ],
      components: riskReturn.map((item) => ({
        label: item.risk,
        value: `NPV ${numberText(item.npv)}, success ${pct(item.success)}, fail ${pct2(item.fail)}`,
        source: "X-axis risk exposure segment; NPV approximates expected return path and failure area quantifies downside probability.",
      })),
      formula: "X-axis = risk exposure segment; Success Probability = clamp(55 + spread x 2.3 + growth - ESG penalty x 0.25, 5, 95); NPV path varies by segment",
      result: pct(derived.successProbability),
      sourcing: [
        { label: "Spread", value: pct(derived.spread), source: "Realtime ROIC and WACC" },
        { label: "Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available" },
        { label: "ESG / Agency Penalty", value: numberText(assumptions.esgPenalty), source: "Governance risk input / SQLite corporate_metrics" },
      ],
      simulation: [
        { label: "1", value: `55.0 + ${numberText(derived.spread)} x 2.3 + ${numberText(assumptions.growth)} - ${numberText(assumptions.esgPenalty)} x 0.25`, source: pct(derived.successProbability) },
        { label: "2", value: `Demand NPV = ${numberText(derived.spread)} x 9.0 + ${numberText(assumptions.growth)}`, source: numberText(derived.spread * 9 + assumptions.growth) },
        { label: "3", value: `Failure area = 100.00% - ${pct2(derived.successProbability)}`, source: pct2(100 - derived.successProbability) },
      ],
    },
    dcfCoreModules: {
      title: `${companyName} DCF Core Modules`,
      timeHorizon: "Current realtime assumption set; FCFF uses LTM or normalized annual-report input; backend fair value uses the latest available price/cache point.",
      summary: [
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Reinvestment x ROIC" },
        { label: "Terminal Value Share", value: pct(derived.terminalValueShare), source: "Growth and WACC scenario formula" },
        { label: "FCFF Magnitude", value: `${moneyText(assumptions.fcff)}B`, source: sourceLabel },
        { label: "Backend Fair Value", value: dcfQuery.data ? moneyText(dcfQuery.data.estimated_value) : "N/A", source: "Backend DCF engine" },
      ],
      components: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Sustainable growth component" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Sustainable growth component" },
        { label: "Growth", value: pct(assumptions.growth), source: "Terminal value share component" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Terminal value share component" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
      ],
      formula: "Sustainable Growth = reinvestment x ROIC / 100; Terminal Value Share = clamp(62 + growth x 1.8 - WACC x 1.2, 20, 88)",
      result: `${pct(derived.sustainableGrowth)} sustainable growth; ${pct(derived.terminalValueShare)} terminal value share`,
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Current Price", value: dcfQuery.data ? moneyText(dcfQuery.data.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `62.0 + ${numberText(assumptions.growth)} x 1.8 - ${numberText(assumptions.wacc)} x 1.2`, source: pct(derived.terminalValueShare) },
        { label: "3", value: dcfQuery.data ? `${moneyText(dcfQuery.data.estimated_value)} vs ${moneyText(dcfQuery.data.current_price)}` : "Waiting for backend result", source: dcfQuery.data ? pct(dcfQuery.data.upside_pct) : "Loading" },
      ],
    },
    terminalValueShare: {
      title: `${companyName} Terminal Value Share`,
      timeHorizon: "Current realtime DCF scenario using the active growth and WACC assumptions; terminal share is bounded to a 20.0%-88.0% sanity range.",
      summary: [
        { label: "Terminal Value Share", value: pct(derived.terminalValueShare), source: "DCF Core Modules scenario formula | Period: current realtime scenario" },
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available | Period: current override can replace backend value" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement averages plus Yahoo beta and model rate inputs | Period: current model snapshot" },
        { label: "Clamp Range", value: "20.0%-88.0%", source: "Terminal-value concentration guardrail | Period: model policy" },
      ],
      components: [
        { label: "Base terminal share", value: "62.0%", source: "Model anchor | Period: stable scenario baseline" },
        { label: "Growth contribution", value: pct(assumptions.growth * 1.8), source: `${pct(assumptions.growth)} x 1.8 | Period: current assumption state` },
        { label: "WACC drag", value: pct(assumptions.wacc * 1.2), source: `${pct(assumptions.wacc)} x 1.2 | Period: current assumption state` },
      ],
      formula: "Terminal Value Share = clamp(62 + growth x 1.8 - WACC x 1.2, 20, 88)",
      result: pct(derived.terminalValueShare),
      sourcing: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates from 2021 onward / saved fallback / browser override" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo-derived WACC / saved fallback / browser override" },
        { label: "Terminal model", value: "Bounded terminal concentration scenario", source: "MoneyView frontend DCF core module" },
      ],
      simulation: [
        { label: "1", value: `${numberText(assumptions.growth)} x 1.8`, source: pct(assumptions.growth * 1.8) },
        { label: "2", value: `${numberText(assumptions.wacc)} x 1.2`, source: pct(assumptions.wacc * 1.2) },
        { label: "3", value: `clamp(62.0 + ${numberText(assumptions.growth * 1.8)} - ${numberText(assumptions.wacc * 1.2)}, 20.0, 88.0)`, source: pct(derived.terminalValueShare) },
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
      title: `${companyName} Backend Fair Value`,
      timeHorizon: "Current backend DCF response using debounced realtime assumptions and the latest available market price/cache point.",
      summary: [
        { label: "Backend Fair Value", value: dcfQuery.data ? moneyText(dcfQuery.data.estimated_value) : "N/A", source: "Backend DCF engine | Period: current debounced request" },
        { label: "Current Price", value: dcfQuery.data ? moneyText(dcfQuery.data.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache | Period: latest available quote/cache point" },
        { label: "Upside / Downside", value: dcfQuery.data ? pct(dcfQuery.data.upside_pct) : "Loading", source: "Fair value vs current price | Period: current backend response" },
        { label: "Status", value: dcfQuery.data?.status ?? "Calculating", source: "Backend valuation classification | Period: current backend response" },
      ],
      components: [
        { label: "Revenue Growth", value: pct(assumptions.growth), source: "DCF payload | Period: 5-year normalized or current override" },
        { label: "Operating Margin Proxy", value: pct(clamp(assumptions.roic, -100, 100)), source: "ROIC mapped to backend margin | Period: LTM or 5-year normalized" },
        { label: "WACC", value: pct(assumptions.wacc), source: "DCF payload | Period: current market snapshot" },
        { label: "Terminal Growth", value: pct(clamp(assumptions.growth, -10, 10)), source: "Growth clamped to backend terminal-growth boundary | Period: current DCF request" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "DCF payload | Period: LTM or normalized annual report" },
      ],
      formula: "Backend Fair Value = backend DCF endpoint output; Upside = estimated value / current price - 1",
      result: dcfQuery.data ? moneyText(dcfQuery.data.estimated_value) : "N/A",
      sourcing: [
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Current Price", value: dcfQuery.data ? moneyText(dcfQuery.data.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache | Period: latest available quote/cache point" },
        { label: "Assumptions", value: "Debounced realtime UI state", source: "Corporate Analysis controls | Period: current session" },
      ],
      simulation: [
        { label: "1", value: `POST growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, terminal growth ${pct(clamp(assumptions.growth, -10, 10))}`, source: "Backend DCF request" },
        { label: "2", value: dcfQuery.data ? `${moneyText(dcfQuery.data.estimated_value)} / ${moneyText(dcfQuery.data.current_price)} - 1` : "Waiting for backend result", source: dcfQuery.data ? pct(dcfQuery.data.upside_pct) : "Loading" },
        { label: "3", value: dcfQuery.data ? moneyText(dcfQuery.data.estimated_value) : "N/A", source: "Final Backend Fair Value" },
      ],
    },
  };

  const activeCalculationDetail = activeCalculation ? calculationDetails[activeCalculation] : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Page header: title plus ticker navigation, backend DCF shortcut, and add-company form. */}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Corporate Analysis
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            {companyName}: life cycle, hurdle rate, bottom-up beta, DCF, and project risk
          </p>
        </div>

        <div className="flex w-full flex-wrap items-end gap-2">
          <div id="company-search-container" className="flex flex-1 flex-row gap-2 min-[1300px]:flex-row justify-end">
            <div className="max-[1300px]:w-full flex min-w-72 flex-col gap-2 text-sm font-semibold text-[var(--text-primary)]">
              {/* Company Search: absolute results overlay prevents the dropdown from pushing layout. */}
              <div className="relative flex flex-col gap-2">
                <label htmlFor="company-search">Company Search</label>
                <input
                  id="company-search"
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  placeholder="Type a company name"
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm"
                />
                {showCompanyResults && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-28 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-white p-1 shadow-lg">
                    {filteredCompanies.map((company) => (
                      <button
                        key={company.ticker}
                        type="button"
                        onClick={() => {
                          selectTicker(company.ticker);
                        }}
                        className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-[var(--surface)] ${company.ticker === assumptions.ticker ? "bg-[var(--surface)] font-bold text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                          }`}
                      >
                        {company.name}
                      </button>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No saved companies match that name.</div>
                    )}
                  </div>
                )}
              </div>
              {/* Backend DCF: quick link into the backend valuation detail modal. */}
              <button
                type="button"
                onClick={() => setActiveCalculation("backendDcf")}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-3 text-left text-sm shadow-sm transition hover:border-[var(--surface)]"
              >
                <div className="text-xs text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Backend DCF"
                    description="Backend fair value from the DCF engine using debounced realtime assumptions, current market price, FCFF, WACC, and terminal growth."
                  />
                </div>
                <div className="font-bold text-[var(--text-primary)]">
                  {dcfQuery.data ? moneyText(dcfQuery.data.estimated_value) : "Calculating"}
                  {dcfQuery.isFetching ? " ..." : ""}
                </div>
              </button>
            </div>
            {/* Add Company: persists a manual ticker and immediately selects it for analysis. */}
            <form onSubmit={addCompany} className="max-[1300px]:w-full grid min-w-72 grid-cols-2 gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-sm shadow-sm">
              <div className="col-span-2 text-xs font-semibold text-[var(--text-muted)]">Add Company</div>
              <input
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                placeholder="Company name"
                className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
              />
              <input
                value={newCompanySymbol}
                onChange={(event) => setNewCompanySymbol(event.target.value)}
                placeholder="Symbol"
                className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
              />
              <button
                type="submit"
                className="col-span-2 rounded-[var(--radius)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={!newCompanyName.trim() || !newCompanySymbol.trim()}
              >
                Add for Analysis
              </button>
            </form>

          </div>

        </div>
      </header>

      {/* Main analysis grid: assumption controls on the left, valuation cards and charts on the right. */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-6">
        {/* Realtime assumption controls drive the frontend model and debounced backend DCF request. */}
        <div id="realtime-assumptions-container" className="xl:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveCalculation("realtime")}
            className="mb-4 text-left text-sm font-bold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
          >
            <InfoTooltip
              label="Realtime Assumptions"
              description="Yahoo Finance annual statements from fiscal years 2021+ are the primary source where available. WACC and debt ratio use the most recent statement data."
            />
          </button>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs md:grid-cols-2 xl:grid-cols-1">
            <label className="grid gap-1 font-bold text-[var(--text-primary)]">
              Growth Basis
              <select
                value={growthBasis}
                onChange={(event) => {
                  const next = event.target.value as GrowthBasis;
                  setGrowthBasis(next);
                  applyMetricHistorySelection({ nextGrowthBasis: next, nextGrowthYear: growthYear });
                }}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-2 text-sm font-bold text-[var(--text-primary)]"
              >
                <option value="cagr">5-year CAGR</option>
                <option value="recent_average">Recent multi-year average</option>
                <option value="annual">Select annual value</option>
              </select>
            </label>
            {growthBasis === "annual" && (
              <label className="grid gap-1 font-bold text-[var(--text-primary)]">
                Growth Year
                <select
                  value={growthYear}
                  onChange={(event) => {
                    const nextYear = event.target.value;
                    setGrowthYear(nextYear);
                    applyMetricHistorySelection({ nextGrowthYear: nextYear });
                  }}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-2 text-sm font-bold text-[var(--text-primary)]"
                >
                  {annualGrowthRates.map((point) => (
                    <option key={point.year} value={point.year}>{point.year}: {point.value == null ? "Unavailable" : pct(point.value)}</option>
                  ))}
                </select>
                {growthYearUnavailableMessage && (
                  <span className="text-xs font-bold text-red-700">{growthYearUnavailableMessage}</span>
                )}
              </label>
            )}
            <label className="grid gap-1 font-bold text-[var(--text-primary)]">
              ROIC Basis
              <select
                value={roicBasis}
                onChange={(event) => {
                  const next = event.target.value as RoicBasis;
                  setRoicBasis(next);
                  applyMetricHistorySelection({ nextRoicBasis: next, nextRoicYear: roicYear });
                }}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-2 text-sm font-bold text-[var(--text-primary)]"
              >
                <option value="recent_average">Recent multi-year average</option>
                <option value="all_year_average">All available years average</option>
                <option value="annual">Select annual value</option>
              </select>
            </label>
            {roicBasis === "annual" && (
              <label className="grid gap-1 font-bold text-[var(--text-primary)]">
                ROIC Year
                <select
                  value={roicYear}
                  onChange={(event) => {
                    const nextYear = event.target.value;
                    setRoicYear(nextYear);
                    applyMetricHistorySelection({ nextRoicYear: nextYear });
                  }}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-2 text-sm font-bold text-[var(--text-primary)]"
                >
                  {annualRoicValues.map((point) => (
                    <option key={point.year} value={point.year}>{point.year}: {point.value == null ? "Unavailable" : pct(point.value)}</option>
                  ))}
                </select>
                {roicYearUnavailableMessage && (
                  <span className="text-xs font-bold text-red-700">{roicYearUnavailableMessage}</span>
                )}
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1">
            <RangeControl label="Growth Rate" description={`Yahoo annual revenue from 2021+. Current basis: ${growthBasisLabel}; annual rates are available in details.`} value={assumptions.growth} min={-5} max={20} step={0.5} onDetailClick={() => setActiveCalculation("growth")} onChange={(value) => update("growth", value)} />
            <RangeControl label="ROIC" description={`Yahoo annual NOPAT / invested capital from 2021+. Current basis: ${roicBasisLabel}.`} value={assumptions.roic} min={-5} max={45} step={0.5} onDetailClick={() => setActiveCalculation("roic")} onChange={(value) => update("roic", value)} />
            <RangeControl label="WACC" description="Derived from Yahoo beta and the most recent Yahoo annual statement capital structure, tax rate, and cost of debt; not directly reported by Yahoo statements." value={assumptions.wacc} min={2} max={24} step={0.25} onDetailClick={() => setActiveCalculation("wacc")} onChange={(value) => update("wacc", value)} />
            <RangeControl label="Debt Ratio" description="Uses the most recent Yahoo annual debt / (debt + equity), not a 5-year average." value={assumptions.debtRatio} min={0} max={90} step={1} onDetailClick={() => setActiveCalculation("debtRatio")} onChange={(value) => update("debtRatio", value)} />
            <RangeControl label="Unlevered Beta" description="Yahoo levered beta de-levered with the most recent annual D/E and tax rate from Yahoo statements; not directly reported in statements." value={assumptions.unleveredBeta} min={0.4} max={2.5} step={0.05} suffix="" onDetailClick={() => setActiveCalculation("unleveredBeta")} onChange={(value) => update("unleveredBeta", value)} />
            <button
              type="button"
              onClick={() => setActiveCalculation("crp")}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--surface)]"
            >
              <div className="text-xs font-bold text-black">Country Risk Premium</div>
              <div className="mt-1 text-xl font-black text-[var(--text-primary)]">{pct(KOREA_COUNTRY_RISK_PREMIUM)}</div>
            </button>
            <RangeControl label="Reinvestment Rate" description="Yahoo annual max(capex - D&A, 0) / NOPAT from 2021+: calculate each year, then average annual rates." value={assumptions.reinvestment} min={0} max={90} step={1} onDetailClick={() => setActiveCalculation("reinvestment")} onChange={(value) => update("reinvestment", value)} />
            <RangeControl label="Innovation Index" description="Yahoo annual R&D / revenue intensity from 2021+, scaled to a 0-100 proxy and averaged; Yahoo does not report a direct innovation score." value={assumptions.innovation} min={0} max={100} step={1} onDetailClick={() => setActiveCalculation("innovation")} onChange={(value) => update("innovation", value)} />
            <RangeControl label="Governance Quality" description="Proxy for ownership alignment, voting structure, disclosure quality, and management accountability." value={assumptions.governance} min={0} max={100} step={1} onDetailClick={() => setActiveCalculation("governance")} onChange={(value) => update("governance", value)} />
            <RangeControl label="ESG / Agency Penalty" description="Penalty score for agency costs, governance friction, and ESG-related execution risk." value={assumptions.esgPenalty} min={0} max={100} step={1} onDetailClick={() => setActiveCalculation("esgPenalty")} onChange={(value) => update("esgPenalty", value)} />
          </div>
        </div>

        {/* Dashboard surface: KPI cards, risk visuals, DCF modules, and chart-driven detail entry points. */}
        <div className="xl:col-span-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => setActiveCalculation("spread")}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--surface)]"
          >
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="ROIC - WACC"
                description={`Spread between return on invested capital and WACC. Basis: ${pct(assumptions.roic)} ROIC - ${pct(assumptions.wacc)} WACC = ${pct(derived.spread)}. Positive is good because returns exceed the hurdle rate; current status is ${derived.spread >= 0 ? "Good, value creation" : "Bad, value destruction"}.`}
              />
            </div>
            <div className={`mt-1 text-3xl font-black ${derived.spread >= 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]"}`}>
              {pct(derived.spread)}
            </div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {derived.spread >= 0 ? "Value creation" : "Value destruction"}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setActiveCalculation("bottomUpKe")}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--surface)]"
          >
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="Bottom-up Ke"
                description={`Cost of equity estimate. Basis: risk-free rate ${pct(RISK_FREE_RATE)} + levered beta ${numberText2(derived.leveredBeta)} x implied ERP ${pct(impliedErp)} + South Korea CRP ${pct(KOREA_COUNTRY_RISK_PREMIUM)} = ${pct(derived.bottomUpKe)}. Lower is generally better, but it must still reflect real risk.`}
              />
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--text-primary)]">{pct(derived.bottomUpKe)}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">rf + beta x implied ERP + CRP</div>
          </button>
          <button
            type="button"
            onClick={() => setActiveCalculation("leveredBeta")}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--surface)]"
          >
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="Levered Beta"
                description={`Equity risk after financial leverage. Basis: betaU ${numberText(assumptions.unleveredBeta)} x [1 + (1 - ${pct(TAX_RATE * 100)}) x D/E ${numberText(derived.debtToEquity)}] = ${numberText2(derived.leveredBeta)}. Beta 1.0 is average market risk; beta above 1.0 is more volatile than the market, so beta 1.5 means 50.0% higher risk; beta below 1.0 is less volatile, so beta 0.7 means 30.0% lower risk.`}
              />
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--text-primary)]">{numberText2(derived.leveredBeta)}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">Hamada adjusted</div>
          </button>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="Success Probability"
                description={`Scenario score from spread, growth, and agency/ESG penalty. Current basis: spread ${pct(derived.spread)}, growth ${pct(assumptions.growth)}, penalty ${numberText(assumptions.esgPenalty)}. Above 60% is good; current status is ${derived.successProbability >= 60 ? "Good" : "Weak"}.`}
              />
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--surface)]">{pct(derived.successProbability)}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">Risk-return scenario</div>
          </div>

          <CompanyStatusGraph
            companyName={companyName}
            healthScore={derived.healthScore}
            healthRadar={healthRadar}
            includeSubjectiveHealth={includeSubjectiveHealth}
            onIncludeSubjectiveHealthChange={setIncludeSubjectiveHealth}
            onOpenDetail={setActiveCalculation}
          />

          <HurdleRateDecompositionGraph
            hurdleBars={hurdleBars}
            regionalMinard={regionalMinard}
            onOpenDetail={setActiveCalculation}
          />

          <BetaWaccCurveGraph
            assumptionsDebtRatio={assumptions.debtRatio}
            betaTreemapProxy={betaTreemapProxy}
            waccCurve={waccCurve}
            onOpenDetail={setActiveCalculation}
          />

          <ValueDriverMatrixGraph
            companyName={companyName}
            valueMatrix={valueMatrix}
            onOpenDetail={setActiveCalculation}
          />

          <RiskReturnMinardGraph
            derivedSpread={derived.spread}
            successProbability={derived.successProbability}
            riskReturn={riskReturn}
            onOpenDetail={setActiveCalculation}
          />

          <DcfCoreModulesGraph
            sustainableGrowth={derived.sustainableGrowth}
            terminalValueShare={derived.terminalValueShare}
            fcff={assumptions.fcff}
            dcfResult={dcfQuery.data}
            onOpenDetail={setActiveCalculation}
          />
        </div>
      </section>
      {/* Calculation detail modal is mounted only when a metric or chart title is selected. */}
      {activeCalculationDetail && (
        <CalculationDetailModal
          detail={activeCalculationDetail}
          ticker={assumptions.ticker}
          rawDatasetRows={rawDatasetRows}
          historicalPrices={historicalPricesQuery.data ?? []}
          historicalStatus={
            historicalPricesQuery.isLoading
              ? "Loading 5-year historical price data"
              : historicalPricesQuery.isError
                ? "5-year historical price data unavailable"
                : `${historicalPricesQuery.data?.length ?? 0} daily rows from the 5-year OHLCV endpoint`
          }
          quarterlyStatementRows={quarterlyStatementsQuery.data?.rows ?? []}
          quarterlyStatementStatus={
            quarterlyStatementsQuery.isLoading
              ? "Loading Yahoo quarterly financial statements"
              : quarterlyStatementsQuery.isError
                ? "Yahoo quarterly financial statements unavailable"
                : `${quarterlyStatementsQuery.data?.rows.length ?? 0} rows from ${quarterlyStatementsQuery.data?.source ?? "Yahoo quarterly financial statements"}`
          }
          onClose={() => setActiveCalculation(null)}
        />
      )}
    </div>
  );
}
