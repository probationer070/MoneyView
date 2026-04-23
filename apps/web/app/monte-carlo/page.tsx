"use client";

import type {
  CorrelationInput,
  CorrelationResult,
  MonteCarloResult,
  PathSimulationInput,
  SharedSimulationResult,
  StockPriceLookup,
  SimulationWorkerResponse,
  ValuationInput,
  ValuationResult,
} from "./lib/types";
import {
  CorrelationModelSection,
  CorporateValuationSection,
  PathSimulationSection,
  ReturnDistributionSection,
  RiskAnalysisSection,
  TabButton,
} from "./components";
import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";

type SimulationTab = "path" | "risk" | "distribution" | "valuation" | "correlation";

const tabs: Array<{ key: SimulationTab; label: string; description: string }> = [
  { key: "path", label: "Path Simulation", description: "GBM + jump-diffusion path engine and percentile cone." },
  { key: "risk", label: "Risk Analysis", description: "VaR, CVaR, downside metrics, and loss diagnostics." },
  { key: "distribution", label: "Return Distribution", description: "Histogram, normal fit, and fat-tail inspection." },
  { key: "valuation", label: "Corporate Valuation", description: "DCF fair-value uncertainty and undervaluation probability." },
  { key: "correlation", label: "Correlation Model", description: "Multi-asset correlation structure and sensitivity." },
];

const defaultInput: PathSimulationInput = {
  initialInvestment: 10_000_000,
  expectedAnnualReturn: 10,
  annualVolatility: 20,
  investmentHorizonYears: 5,
  simulationCount: 1_000,
  executionMode: "interactive",
  jumpProbabilityMonthly: 2,
  jumpIntensityMultiplier: 2,
  riskFreeRate: 3,
  seed: 42,
};

const defaultValuationInput: ValuationInput = {
  ticker: "KRW-STOCK",
  currentPrice: 50_000,
  baseEps: 3_500,
  averageGrowthRate: 12,
  growthUncertainty: 5,
  discountRate: 9,
  discountRateUncertainty: 1.5,
  terminalGrowthRate: 3,
  forecastPeriodYears: 10,
  targetPerUncertainty: 3,
  simulationCount: 2000,
  seed: 42,
};

const defaultCorrelationInput: CorrelationInput = {
  assets: [
    { name: "Asset A", expectedReturn: 10, volatility: 20 },
    { name: "Asset B", expectedReturn: 7, volatility: 15 },
    { name: "Asset C", expectedReturn: 15, volatility: 35 },
    { name: "Asset D", expectedReturn: 4, volatility: 8 },
  ],
  correlationMatrix: [
    [1, 0.5, 0.3, 0.1],
    [0.5, 1, 0.5, 0.3],
    [0.3, 0.5, 1, 0.5],
    [0.1, 0.3, 0.5, 1],
  ],
  simulationCount: 2000,
  seed: 42,
};

const STOCK_PRICE_LOOKUP_MAX_ATTEMPTS = 6;

async function fetchStockPriceLookup(
  ticker: string,
  signal?: AbortSignal,
): Promise<{ statusCode: number; data: StockPriceLookup }> {
  const requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
  const response = await fetch(`${getApiBaseUrl()}/api/v1/stock/${encodeURIComponent(ticker)}/price`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    signal,
  });

  const payload = (await response.json()) as { data: StockPriceLookup };
  return {
    statusCode: response.status,
    data: payload.data,
  };
}

// CSV export helpers keep data serialization out of the tab components.
function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function MonteCarloPage() {
  // Page-level state owns worker lifecycle, tab selection, and all simulation inputs/results.
  const [activeTab, setActiveTab] = useState<SimulationTab>("path");
  const [input, setInput] = useState<PathSimulationInput>(defaultInput);
  const [valuationInput, setValuationInput] = useState<ValuationInput>(defaultValuationInput);
  const [correlationInput, setCorrelationInput] = useState<CorrelationInput>(defaultCorrelationInput);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [valuationResult, setValuationResult] = useState<ValuationResult | null>(null);
  const [correlationResult, setCorrelationResult] = useState<CorrelationResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "cancelled">("idle");
  const [valuationStatus, setValuationStatus] = useState<"idle" | "loading" | "error" | "cancelled">("idle");
  const [correlationStatus, setCorrelationStatus] = useState<"idle" | "loading" | "error" | "cancelled">("idle");
  const [valuationPriceLookupStatus, setValuationPriceLookupStatus] = useState<"idle" | "loading" | "fetching" | "success" | "not_found" | "error">("idle");
  const [valuationPriceLookupMessage, setValuationPriceLookupMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [valuationProgress, setValuationProgress] = useState(0);
  const [correlationProgress, setCorrelationProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeRequestKindRef = useRef<"path" | "valuation" | "correlation" | null>(null);
  const priceLookupRequestSeqRef = useRef(0);
  const priceLookupTickerRef = useRef(defaultValuationInput.ticker);
  const priceLookupAbortRef = useRef<AbortController | null>(null);
  const priceLookupManualEditSeqRef = useRef(0);

  // One shared worker handles path, valuation, and correlation jobs.
  useEffect(() => {
    const worker = new Worker(new URL("./workers/simulation.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== activeRequestIdRef.current) return;
      if (message.type === "progress") {
        if (activeRequestKindRef.current === "valuation") setValuationProgress(message.progress);
        else if (activeRequestKindRef.current === "correlation") setCorrelationProgress(message.progress);
        else setProgress(message.progress);
        return;
      }
      if (message.type === "result") {
        setResult(message.result);
        setProgress(100);
        setErrorMessage(null);
        setStatus("idle");
        activeRequestIdRef.current = null;
        activeRequestKindRef.current = null;
        return;
      }
      if (message.type === "valuation-result") {
        setValuationResult(message.result);
        setValuationProgress(100);
        setValuationStatus("idle");
        activeRequestIdRef.current = null;
        activeRequestKindRef.current = null;
        return;
      }
      if (message.type === "correlation-result") {
        setCorrelationResult(message.result);
        setCorrelationProgress(100);
        setCorrelationStatus("idle");
        activeRequestIdRef.current = null;
        activeRequestKindRef.current = null;
        return;
      }
      if (activeRequestKindRef.current === "valuation") setValuationStatus("error");
      else if (activeRequestKindRef.current === "correlation") setCorrelationStatus("error");
      else {
        setErrorMessage(message.error);
        setStatus("error");
      }
      activeRequestIdRef.current = null;
      activeRequestKindRef.current = null;
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const update = <K extends keyof PathSimulationInput>(key: K, value: PathSimulationInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const updateValuation = <K extends keyof ValuationInput>(key: K, value: ValuationInput[K]) => {
    if (key === "ticker") {
      priceLookupTickerRef.current = String(value).trim().toUpperCase();
      setValuationPriceLookupStatus("idle");
      setValuationPriceLookupMessage(null);
    }
    if (key === "currentPrice") {
      priceLookupManualEditSeqRef.current += 1;
      if (valuationPriceLookupStatus === "success") {
        setValuationPriceLookupMessage("Price can still be manually overridden after auto-fill.");
      }
    }
    setValuationInput((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => () => {
    priceLookupAbortRef.current?.abort();
  }, []);

  const runStockPriceLookup = async () => {
    const ticker = valuationInput.ticker.trim().toUpperCase();
    if (!ticker) {
      setValuationPriceLookupStatus("idle");
      setValuationPriceLookupMessage(null);
      return;
    }

    priceLookupAbortRef.current?.abort();
    const abortController = new AbortController();
    priceLookupAbortRef.current = abortController;

    const requestSeq = ++priceLookupRequestSeqRef.current;
    const lookupTicker = ticker;
    const lookupManualEditSeq = priceLookupManualEditSeqRef.current;
    setValuationPriceLookupStatus("loading");
    setValuationPriceLookupMessage(`Looking up ${lookupTicker} price from the cache-first API...`);

    for (let attempt = 1; attempt <= STOCK_PRICE_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
      try {
        const { statusCode, data } = await fetchStockPriceLookup(lookupTicker, abortController.signal);
        const isLatestRequest = requestSeq === priceLookupRequestSeqRef.current;
        const tickerUnchanged = lookupTicker === priceLookupTickerRef.current;
        if (!isLatestRequest || !tickerUnchanged) {
          return;
        }

        if (statusCode === 202 || data.status === "fetching") {
          setValuationPriceLookupStatus("fetching");
          setValuationPriceLookupMessage(data.detail_note || `${lookupTicker} is being fetched. Waiting for cache hydration...`);
          const retryAfterMs = Math.max(1, data.retry_after_seconds ?? 2) * 1000;
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, retryAfterMs);
            const onAbort = () => {
              window.clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            };
            abortController.signal.addEventListener("abort", onAbort, { once: true });
          });
          continue;
        }

        if (data.status === "ok" && data.price !== null) {
          setValuationPriceLookupStatus("success");
          setValuationPriceLookupMessage(
            data.source === "cache_fallback"
              ? `${lookupTicker} price loaded from stale cache while background refresh continues.`
              : `${lookupTicker} price loaded from cache.`,
          );
          if (lookupManualEditSeq === priceLookupManualEditSeqRef.current) {
            setValuationInput((current) => (current.ticker.trim().toUpperCase() === lookupTicker
              ? { ...current, currentPrice: Math.round(data.price ?? current.currentPrice) }
              : current));
          }
          return;
        }

        if (statusCode === 404 || data.status === "not_found") {
          setValuationPriceLookupStatus("not_found");
          setValuationPriceLookupMessage("Ticker not found.");
          return;
        }

        setValuationPriceLookupStatus("error");
        setValuationPriceLookupMessage(data.detail_note || "Stock price lookup failed.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (requestSeq !== priceLookupRequestSeqRef.current || lookupTicker !== priceLookupTickerRef.current) {
          return;
        }
        setValuationPriceLookupStatus("error");
        setValuationPriceLookupMessage(error instanceof Error ? error.message : "Stock price lookup failed.");
        return;
      }
    }

    if (requestSeq === priceLookupRequestSeqRef.current && lookupTicker === priceLookupTickerRef.current) {
      setValuationPriceLookupStatus("error");
      setValuationPriceLookupMessage(`Price lookup for ${lookupTicker} timed out while waiting for cache hydration.`);
    }
  };

  const updateCorrelation = <K extends keyof CorrelationInput>(key: K, value: CorrelationInput[K]) => {
    setCorrelationInput((current) => ({
      ...current,
      [key]: key === "simulationCount" ? (Math.max(500, Math.min(5_000, Number(value))) as CorrelationInput[K]) : value,
    }));
  };

  const updateCorrelationAsset = (assetIndex: number, field: "name" | "expectedReturn" | "volatility", value: string | number) => {
    setCorrelationInput((current) => ({
      ...current,
      assets: current.assets.map((asset, index) =>
        index === assetIndex ? { ...asset, [field]: field === "name" ? String(value) : Number(value) } : asset,
      ),
    }));
  };

  const updateCorrelationCell = (rowIndex: number, columnIndex: number, value: number) => {
    setCorrelationInput((current) => ({
      ...current,
      correlationMatrix: current.correlationMatrix.map((row, currentRowIndex) =>
        row.map((cell, currentColumnIndex) => {
          if (
            (currentRowIndex === rowIndex && currentColumnIndex === columnIndex) ||
            (currentRowIndex === columnIndex && currentColumnIndex === rowIndex)
          ) {
            return currentRowIndex === currentColumnIndex ? 1 : Math.max(-1, Math.min(1, Number(value)));
          }
          return cell;
        }),
      ),
    }));
  };

  const runPathSimulation = async () => {
    if (!workerRef.current) return;
    if (activeRequestIdRef.current) {
      workerRef.current.postMessage({ type: "cancel", requestId: activeRequestIdRef.current });
    }
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    activeRequestKindRef.current = "path";
    setErrorMessage(null);
    setStatus("loading");
    setProgress(0);
    workerRef.current.postMessage({ type: "run-path", requestId, payload: input });
  };

  const runValuationSimulation = () => {
    if (!workerRef.current) return;
    if (activeRequestIdRef.current) {
      workerRef.current.postMessage({ type: "cancel", requestId: activeRequestIdRef.current });
    }
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    activeRequestKindRef.current = "valuation";
    setValuationStatus("loading");
    setValuationProgress(0);
    workerRef.current.postMessage({ type: "run-valuation", requestId, payload: valuationInput });
  };

  const runCorrelationSimulation = () => {
    if (!workerRef.current) return;
    if (activeRequestIdRef.current) {
      workerRef.current.postMessage({ type: "cancel", requestId: activeRequestIdRef.current });
    }
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    activeRequestKindRef.current = "correlation";
    setCorrelationStatus("loading");
    setCorrelationProgress(0);
    workerRef.current.postMessage({ type: "run-correlation", requestId, payload: correlationInput });
  };

  const cancelPathSimulation = () => {
    if (!workerRef.current || !activeRequestIdRef.current) return;
    workerRef.current.postMessage({ type: "cancel", requestId: activeRequestIdRef.current });
    activeRequestIdRef.current = null;
    activeRequestKindRef.current = null;
    setStatus("cancelled");
    setProgress(0);
  };

  const cancelValuationSimulation = () => {
    if (!workerRef.current || !activeRequestIdRef.current) return;
    workerRef.current.postMessage({ type: "cancel", requestId: activeRequestIdRef.current });
    activeRequestIdRef.current = null;
    activeRequestKindRef.current = null;
    setValuationStatus("cancelled");
    setValuationProgress(0);
  };

  const yearlyTicks = useMemo(
    () => Array.from({ length: Math.max(1, input.investmentHorizonYears) + 1 }, (_, index) => index),
    [input.investmentHorizonYears],
  );

  // Shared path outputs feed the Path, Risk, and Return Distribution tabs from one run.
  const sharedSimulation = useMemo<SharedSimulationResult | null>(() => {
    if (!result) return null;
    const pathSummary = result.path_summary;
    const pathKeys = result.sample_paths.length
      ? Object.keys(result.sample_paths[0]).filter((key) => key.startsWith("path_")).slice(0, 12)
      : [];
    const pathChartData = result.sample_paths.map((row, index) => ({
      ...row,
      average_path: Number(pathSummary[index]?.mean ?? input.initialInvestment),
      principal_line: input.initialInvestment,
    }));
    const terminalMedian = Number(pathSummary.at(-1)?.p50 ?? input.initialInvestment);
    const terminalP05 = Number(pathSummary.at(-1)?.p05 ?? input.initialInvestment);
    const terminalP10 = Number(pathSummary.at(-1)?.p10 ?? input.initialInvestment);
    const terminalP25 = Number(pathSummary.at(-1)?.p25 ?? input.initialInvestment);
    const terminalP75 = Number(pathSummary.at(-1)?.p75 ?? input.initialInvestment);
    const terminalP90 = Number(pathSummary.at(-1)?.p90 ?? input.initialInvestment);
    const terminalP95 = Number(pathSummary.at(-1)?.p95 ?? input.initialInvestment);
    const medianExpectedReturn = ((terminalMedian / input.initialInvestment) - 1) * 100;
    let peak = Number(pathSummary[0]?.p50 ?? input.initialInvestment);
    let maxDrawdown = 0;
    for (const point of pathSummary) {
      const value = Number(point.p50 ?? peak);
      peak = Math.max(peak, value);
      if (peak > 0) {
        maxDrawdown = Math.max(maxDrawdown, ((peak - value) / peak) * 100);
      }
    }
    const percentileGaugeMin = terminalP05;
    const percentileGaugeMax = terminalP95;
    const percentileGaugeRange = Math.max(percentileGaugeMax - percentileGaugeMin, 1);
    const maxFrequency = Math.max(...result.histogram.map((row) => Number(row.frequency ?? 0)), 0.001);
    const maxDensity = Math.max(...result.normal_fit.map((row) => Number(row.density ?? 0)), 0.001);
    const normalOverlay = result.normal_fit.map((row) => ({
      return: Number(row.return ?? 0),
      normal_scaled: (Number(row.density ?? 0) / maxDensity) * maxFrequency,
    }));
    const returnDistributionChartData = result.histogram.map((row, index) => ({
      ...row,
      normal_scaled: Number(normalOverlay[Math.min(index, normalOverlay.length - 1)]?.normal_scaled ?? 0),
    }));
    return {
      raw: result,
      pathKeys,
      pathChartData,
      pathSummary,
      terminalMedian,
      terminalP05,
      terminalP10,
      terminalP25,
      terminalP75,
      terminalP90,
      terminalP95,
      medianExpectedReturn,
      medianMaxDrawdown: maxDrawdown,
      percentileGaugeMin,
      percentileGaugeMax,
      percentileGaugeRange,
      normalOverlay,
      returnDistributionChartData,
    };
  }, [input.initialInvestment, result]);

  const exportSummaryCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("summary.csv", [
      { section: "input", metric: "execution_mode", value: sharedSimulation.raw.execution_mode },
      { section: "input", metric: "initial_investment_krw", value: input.initialInvestment },
      { section: "input", metric: "expected_annual_return_pct", value: input.expectedAnnualReturn },
      { section: "input", metric: "annual_volatility_pct", value: input.annualVolatility },
      { section: "input", metric: "investment_horizon_years", value: input.investmentHorizonYears },
      { section: "input", metric: "simulation_count", value: input.simulationCount },
      { section: "input", metric: "jump_probability_monthly_pct", value: input.jumpProbabilityMonthly },
      { section: "input", metric: "jump_intensity_multiplier", value: input.jumpIntensityMultiplier },
      { section: "input", metric: "risk_free_rate_pct", value: input.riskFreeRate },
      { section: "input", metric: "seed", value: input.seed },
      { section: "terminal", metric: "p05_krw", value: sharedSimulation.terminalP05 },
      { section: "terminal", metric: "p10_krw", value: sharedSimulation.terminalP10 },
      { section: "terminal", metric: "p25_krw", value: sharedSimulation.terminalP25 },
      { section: "terminal", metric: "median_krw", value: sharedSimulation.terminalMedian },
      { section: "terminal", metric: "p75_krw", value: sharedSimulation.terminalP75 },
      { section: "terminal", metric: "p90_krw", value: sharedSimulation.terminalP90 },
      { section: "terminal", metric: "p95_krw", value: sharedSimulation.terminalP95 },
      ...Object.entries(sharedSimulation.raw.risk_metrics).map(([metric, value]) => ({
        section: "risk_metrics",
        metric,
        value,
      })),
    ]);
  };

  const exportPercentileConeCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("percentile_cone.csv", sharedSimulation.pathSummary);
  };

  const exportSamplePathsCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("sample_paths.csv", sharedSimulation.pathChartData);
  };

  const exportTerminalDistributionCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("terminal_distribution.csv", sharedSimulation.raw.histogram);
  };

  const exportRiskSummaryCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("risk_summary.csv", Object.entries(sharedSimulation.raw.risk_metrics).map(([metric, value]) => ({
      metric,
      value,
    })));
  };

  const exportRiskHistogramCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("risk_histogram.csv", sharedSimulation.raw.histogram);
  };

  const exportReturnHistogramCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("return_histogram.csv", sharedSimulation.returnDistributionChartData);
  };

  const exportReturnCdfCsv = () => {
    if (!sharedSimulation) return;
    downloadCsv("return_cdf.csv", sharedSimulation.raw.cdf_comparison);
  };

  const exportValuationSummaryCsv = () => {
    if (!valuationResult) return;
    downloadCsv("valuation_summary.csv", Object.entries(valuationResult.fair_value_summary).map(([metric, value]) => ({
      metric,
      value,
    })));
  };

  const exportValuationDistributionCsv = () => {
    if (!valuationResult) return;
    downloadCsv("valuation_distribution.csv", valuationResult.valuation_distribution);
  };

  const exportCorrelationFrontierCsv = () => {
    if (!correlationResult) return;
    downloadCsv("correlation_frontier.csv", correlationResult.efficient_frontier);
  };

  const exportCorrelationSensitivityCsv = () => {
    if (!correlationResult) return;
    downloadCsv("correlation_sensitivity.csv", correlationResult.spearman_sensitivity);
  };

  const exportCorrelationHeatmapCsv = () => {
    if (!correlationResult) return;
    downloadCsv("correlation_heatmap.csv", correlationResult.heatmap);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      <PageHeader
        eyebrow="Monte Carlo investment analysis"
        title="Simulation Lab"
        subtitle="Five-tab workflow for path simulation, risk analysis, return distribution, valuation uncertainty, and correlation structure."
      />

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {tabs.map((tab) => (
          <TabButton
            key={tab.key}
            active={activeTab === tab.key}
            label={tab.label}
            description={tab.description}
            onClick={() => setActiveTab(tab.key)}
          />
        ))}
      </section>

      {/* Each tab renders through a dedicated section component. */}
      {activeTab === "path" ? (
        <PathSimulationSection
          input={input}
          sharedSimulation={sharedSimulation}
          status={status}
          progress={progress}
          errorMessage={errorMessage}
          yearlyTicks={yearlyTicks}
          update={update}
          runPathSimulation={runPathSimulation}
          cancelPathSimulation={cancelPathSimulation}
          exportSummaryCsv={exportSummaryCsv}
          exportPercentileConeCsv={exportPercentileConeCsv}
          exportSamplePathsCsv={exportSamplePathsCsv}
          exportTerminalDistributionCsv={exportTerminalDistributionCsv}
        />
      ) : activeTab === "risk" ? (
        <RiskAnalysisSection
          sharedSimulation={sharedSimulation}
          initialInvestment={input.initialInvestment}
          exportRiskSummaryCsv={exportRiskSummaryCsv}
          exportRiskHistogramCsv={exportRiskHistogramCsv}
        />
      ) : activeTab === "distribution" ? (
        <ReturnDistributionSection
          sharedSimulation={sharedSimulation}
          exportReturnHistogramCsv={exportReturnHistogramCsv}
          exportReturnCdfCsv={exportReturnCdfCsv}
        />
      ) : activeTab === "valuation" ? (
        <CorporateValuationSection
          valuationInput={valuationInput}
          valuationResult={valuationResult}
          valuationStatus={valuationStatus}
          valuationProgress={valuationProgress}
          valuationPriceLookupStatus={valuationPriceLookupStatus}
          valuationPriceLookupMessage={valuationPriceLookupMessage}
          updateValuation={updateValuation}
          onValuationTickerBlur={() => void runStockPriceLookup()}
          runValuationSimulation={runValuationSimulation}
          cancelValuationSimulation={cancelValuationSimulation}
          exportValuationSummaryCsv={exportValuationSummaryCsv}
          exportValuationDistributionCsv={exportValuationDistributionCsv}
        />
      ) : (
        <CorrelationModelSection
          correlationInput={correlationInput}
          correlationResult={correlationResult}
          correlationStatus={correlationStatus}
          correlationProgress={correlationProgress}
          updateCorrelation={updateCorrelation}
          updateCorrelationAsset={updateCorrelationAsset}
          updateCorrelationCell={updateCorrelationCell}
          runCorrelationSimulation={runCorrelationSimulation}
          exportCorrelationFrontierCsv={exportCorrelationFrontierCsv}
          exportCorrelationHeatmapCsv={exportCorrelationHeatmapCsv}
          exportCorrelationSensitivityCsv={exportCorrelationSensitivityCsv}
        />
      )}
    </div>
  );
}
