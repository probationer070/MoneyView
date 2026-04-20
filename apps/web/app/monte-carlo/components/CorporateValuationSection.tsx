"use client";

import type { ValuationInput, ValuationResult } from "../lib/types";
import { AlertTriangle, Loader2, Play, Square } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { MetricCard, NumericField, SummaryRow, krw, numberText, pct } from "./shared";

type Props = {
  valuationInput: ValuationInput;
  valuationResult: ValuationResult | null;
  valuationStatus: "idle" | "loading" | "error" | "cancelled";
  valuationProgress: number;
  valuationPriceLookupStatus: "idle" | "loading" | "fetching" | "success" | "not_found" | "error";
  valuationPriceLookupMessage: string | null;
  updateValuation: <K extends keyof ValuationInput>(key: K, value: ValuationInput[K]) => void;
  onValuationTickerBlur: () => void;
  runValuationSimulation: () => void;
  cancelValuationSimulation: () => void;
};

export function CorporateValuationSection({
  valuationInput,
  valuationResult,
  valuationStatus,
  valuationProgress,
  valuationPriceLookupStatus,
  valuationPriceLookupMessage,
  updateValuation,
  onValuationTickerBlur,
  runValuationSimulation,
  cancelValuationSimulation,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Valuation assumptions and worker controls */}
      <section className="grid grid-cols-1 gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:grid-cols-5">
        <label className="grid gap-1 text-xs font-bold text-[var(--text-primary)]">
          Ticker
          <input
            value={valuationInput.ticker}
            onChange={(event) => updateValuation("ticker", event.target.value.toUpperCase())}
            onBlur={onValuationTickerBlur}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold outline-none"
          />
        </label>
        <label className="grid gap-1 text-xs font-bold text-[var(--text-primary)]">
          Current stock price
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2">
            <input
              type="number"
              value={valuationInput.currentPrice}
              min={1000}
              step={100}
              onChange={(event) => updateValuation("currentPrice", Number(event.target.value))}
              className="w-full bg-transparent text-sm font-bold outline-none"
            />
            <span className="text-[var(--text-muted)]">KRW</span>
            {valuationPriceLookupStatus === "loading" || valuationPriceLookupStatus === "fetching" ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
            ) : null}
          </div>
          {valuationPriceLookupMessage ? (
            <span
              className={
                valuationPriceLookupStatus === "not_found" || valuationPriceLookupStatus === "error"
                  ? "text-[11px] text-red-600"
                  : "text-[11px] text-[var(--text-muted)]"
              }
            >
              {valuationPriceLookupMessage}
            </span>
          ) : null}
        </label>
        <NumericField label="Base EPS" value={valuationInput.baseEps} onChange={(value) => updateValuation("baseEps", value)} step={50} min={100} suffix="KRW" />
        <NumericField label="Average growth rate" value={valuationInput.averageGrowthRate} onChange={(value) => updateValuation("averageGrowthRate", value)} step={0.5} suffix="%" />
        <NumericField label="Growth uncertainty" value={valuationInput.growthUncertainty} onChange={(value) => updateValuation("growthUncertainty", value)} step={0.25} suffix="%" />
        <NumericField label="Discount rate (WACC)" value={valuationInput.discountRate} onChange={(value) => updateValuation("discountRate", value)} step={0.25} suffix="%" />
        <NumericField label="WACC uncertainty" value={valuationInput.discountRateUncertainty} onChange={(value) => updateValuation("discountRateUncertainty", value)} step={0.25} suffix="%" />
        <NumericField label="Terminal growth rate" value={valuationInput.terminalGrowthRate} onChange={(value) => updateValuation("terminalGrowthRate", value)} step={0.25} suffix="%" />
        <NumericField label="Forecast period" value={valuationInput.forecastPeriodYears} onChange={(value) => updateValuation("forecastPeriodYears", value)} step={1} min={1} suffix="years" />
        <NumericField label="Target PER uncertainty" value={valuationInput.targetPerUncertainty} onChange={(value) => updateValuation("targetPerUncertainty", value)} step={0.25} min={0.25} suffix="x" />
        <NumericField label="Simulation Count" value={valuationInput.simulationCount} onChange={(value) => updateValuation("simulationCount", value)} step={100} min={500} />
        <div className="flex flex-col justify-end gap-2">
          <button
            type="button"
            onClick={runValuationSimulation}
            disabled={valuationStatus === "loading"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
          >
            {valuationStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Valuation
          </button>
          <button
            type="button"
            onClick={cancelValuationSimulation}
            disabled={valuationStatus !== "loading"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-5 py-3 text-sm font-black text-[var(--text-primary)] shadow-sm disabled:opacity-50"
          >
            <Square className="h-4 w-4" />
            Cancel
          </button>
        </div>
      </section>

      {valuationStatus === "loading" && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm font-bold text-[var(--text-primary)]">
            <span>Valuation worker progress</span>
            <span>{valuationProgress}%</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-[var(--accent)] transition-all" style={{ width: `${valuationProgress}%` }} />
          </div>
        </div>
      )}

      {valuationStatus === "error" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle className="h-4 w-4" />
          Valuation simulation failed.
        </div>
      )}

      {valuationStatus === "cancelled" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          Valuation simulation cancelled.
        </div>
      )}

      {!valuationResult ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white p-10 text-center text-sm text-[var(--text-muted)]">
          Run the valuation engine to generate fair value distribution, undervaluation probability, z-score, and DCF uncertainty summaries.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top-line valuation outputs */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Median Fair Value" value={krw(valuationResult.fair_value_summary.fair_value_median)} detail="50th percentile fair value across valuation simulations" />
            <MetricCard label="Undervaluation Probability" value={pct(valuationResult.fair_value_summary.undervaluation_probability)} detail="Probability fair value exceeds current market price" />
            <MetricCard label="Upside Potential" value={pct(valuationResult.fair_value_summary.upside_potential)} detail="Median fair value relative to the current stock price" />
            <MetricCard label="80% Confidence Interval" value={`${krw(valuationResult.fair_value_summary.fair_value_p10)} - ${krw(valuationResult.fair_value_summary.fair_value_p90)}`} detail="P10 to P90 fair value interval" />
          </section>

          {/* Distribution chart and tabular valuation summary */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm xl:col-span-2">
              <h2 className="text-lg font-black text-[var(--text-primary)]">Fair Value Distribution</h2>
              <p className="text-xs text-[var(--text-muted)]">Single-stock Monte Carlo fair value distribution using EPS growth, discount-rate uncertainty, and target PER uncertainty.</p>
              <div className="mt-4 h-80">
                <ResponsiveChart minWidth={1} minHeight={1}>
                  <BarChart data={valuationResult.valuation_distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="fair_value" tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                    <YAxis />
                    <Tooltip formatter={(value) => `${(Number(value) * 100).toFixed(2)}%`} labelFormatter={(label) => krw(Number(label))} />
                    <ReferenceLine x={valuationResult.fair_value_summary.current_price} stroke="#111827" label="Current Price" />
                    <Bar dataKey="frequency" fill="#60caad" />
                  </BarChart>
                </ResponsiveChart>
              </div>
            </div>

            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-[var(--text-primary)]">Valuation Statistics</h2>
              <div className="mt-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
                <table className="w-full text-sm">
                  <tbody>
                    <SummaryRow label="Current Price" value={krw(valuationResult.fair_value_summary.current_price)} />
                    <SummaryRow label="Mean Fair Value" value={krw(valuationResult.fair_value_summary.fair_value_mean)} />
                    <SummaryRow label="Std. deviation" value={krw(valuationResult.fair_value_summary.fair_value_std)} />
                    <SummaryRow label="P05" value={krw(valuationResult.fair_value_summary.fair_value_p05)} />
                    <SummaryRow label="P10" value={krw(valuationResult.fair_value_summary.fair_value_p10)} />
                    <SummaryRow label="P25" value={krw(valuationResult.fair_value_summary.fair_value_p25)} />
                    <SummaryRow label="Median" value={krw(valuationResult.fair_value_summary.fair_value_median)} />
                    <SummaryRow label="P75" value={krw(valuationResult.fair_value_summary.fair_value_p75)} />
                    <SummaryRow label="P90" value={krw(valuationResult.fair_value_summary.fair_value_p90)} />
                    <SummaryRow label="P95" value={krw(valuationResult.fair_value_summary.fair_value_p95)} />
                    <SummaryRow label="Undervaluation Probability" value={pct(valuationResult.fair_value_summary.undervaluation_probability)} />
                    <SummaryRow label="Z-score" value={numberText(valuationResult.fair_value_summary.z_score)} />
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
