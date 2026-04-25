"use client";

import { RefreshCw } from "lucide-react";
import type { CorporateDerivedMetricMeta, CorporateMetricAuditEntry } from "../../../../../packages/shared-types";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { formatAuditMetricValue, metricAuditReason } from "@/lib/metricAudit";
import { RangeControl } from "./RangeControl";
import { dateTimeText, pct } from "../corporateUtils";
import { KOREA_COUNTRY_RISK_PREMIUM } from "../corporateConstants";
import type { CorporateAssumptions, RoicBasis } from "../corporateTypes";
import type { CalculationDetailKey } from "./calculationDetailTypes";

interface CorporateAssumptionsPanelProps {
  setActiveCalculation: (calc: CalculationDetailKey | null) => void;
  handleRefreshSourceData: () => void;
  metricsHistoryQueryIsFetching: boolean;
  quarterlyStatementsQueryIsFetching: boolean;
  historicalPricesQueryIsFetching: boolean;
  sourceDataDisplayLastUpdatedAt: string | null;
  sourceDataIsStale: boolean;
  sourceDataStaleMessage: string;
  hasMetricsHistoryData: boolean;
  hasQuarterlyStatementsData: boolean;
  hasHistoricalPricesData: boolean;
  applyMetricHistorySelection: (options: { nextRoicBasis?: RoicBasis; nextRoicYear?: string }) => void;
  growthBasisLabel: string;
  growthMeta: CorporateDerivedMetricMeta | null;
  roicBasis: RoicBasis;
  setRoicBasis: (basis: RoicBasis) => void;
  roicYear: string;
  setRoicYear: (year: string) => void;
  annualRoicValues: { year: number | string; value: number | null }[];
  roicBasisLabel: string;
  roicMeta: CorporateDerivedMetricMeta | null;
  roicYearUnavailableMessage: string;
  roicAudit: CorporateMetricAuditEntry | null;
  waccAudit: CorporateMetricAuditEntry | null;
  assumptions: CorporateAssumptions;
  update: (field: keyof CorporateAssumptions, value: number) => void;
}

function metricMetaReason(meta: CorporateDerivedMetricMeta | null) {
  if (!meta) return "";
  return meta.reason ?? meta.warnings[0] ?? "";
}

export function CorporateAssumptionsPanel({
  setActiveCalculation,
  handleRefreshSourceData,
  metricsHistoryQueryIsFetching,
  quarterlyStatementsQueryIsFetching,
  historicalPricesQueryIsFetching,
  sourceDataDisplayLastUpdatedAt,
  sourceDataIsStale,
  sourceDataStaleMessage,
  hasMetricsHistoryData,
  hasQuarterlyStatementsData,
  hasHistoricalPricesData,
  applyMetricHistorySelection,
  growthBasisLabel,
  growthMeta,
  roicBasis,
  setRoicBasis,
  roicYear,
  setRoicYear,
  annualRoicValues,
  roicBasisLabel,
  roicMeta,
  roicYearUnavailableMessage,
  roicAudit,
  waccAudit,
  assumptions,
  update,
}: CorporateAssumptionsPanelProps) {
  const isFetchingSourceData = metricsHistoryQueryIsFetching || quarterlyStatementsQueryIsFetching || historicalPricesQueryIsFetching;

  return (
    <div id="realtime-assumptions-container" className="hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 xl:col-span-2 xl:block">
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
        <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-1">
          <button
            type="button"
            onClick={handleRefreshSourceData}
            disabled={isFetchingSourceData}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetchingSourceData ? "animate-spin" : ""}`} />
            Refresh source data
          </button>
          <span className="text-[var(--text-muted)]">
            {sourceDataDisplayLastUpdatedAt ? `Last updated ${dateTimeText(sourceDataDisplayLastUpdatedAt)}` : "Not loaded yet"}
          </span>
          {sourceDataIsStale && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[length:var(--type-caption)] font-bold text-amber-800">
              {sourceDataStaleMessage}
            </span>
          )}
          {!hasMetricsHistoryData && !hasQuarterlyStatementsData && !hasHistoricalPricesData && !isFetchingSourceData && (
            <span className="text-[var(--text-muted)]">Source data stays idle on first load until refreshed.</span>
          )}
        </div>
        <div className="grid gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="text-xs font-bold text-[var(--text-primary)]">Growth Basis</div>
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
            <span>{growthBasisLabel}</span>
            {growthMeta ? <MetricQualityBadge quality={growthMeta.quality} /> : null}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {metricMetaReason(growthMeta) || "Growth Rate now stays on the stable CAGR path. Annual growth rates remain available in View Details for context."}
          </div>
        </div>
        <label className="grid gap-1 font-bold text-[var(--text-primary)]">
          ROIC Basis
          <select
            value={roicBasis}
            onChange={(event) => {
              const next = event.target.value as RoicBasis;
              setRoicBasis(next);
              applyMetricHistorySelection({ nextRoicBasis: next, nextRoicYear: roicYear });
            }}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-2 text-sm font-bold text-[var(--text-primary)]"
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
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-2 text-sm font-bold text-[var(--text-primary)]"
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
        <RangeControl label="Growth Rate" description={`${`Yahoo annual revenue from 2021+. Current basis: ${growthBasisLabel}; annual growth rates remain available in details as supporting context.`} ${metricMetaReason(growthMeta)}`.trim()} value={assumptions.growth} statusBadge={growthMeta ? <MetricQualityBadge quality={growthMeta.quality} /> : undefined} min={-5} max={20} step={0.5} onDetailClick={() => setActiveCalculation("growth")} onChange={(value) => update("growth", value)} />
        <RangeControl label="ROIC" description={`${`Yahoo annual NOPAT / invested capital from 2021+. Current basis: ${roicBasisLabel}.`} ${roicAudit ? metricAuditReason(roicAudit) : metricMetaReason(roicMeta)}`.trim()} value={assumptions.roic} valueDisplay={roicAudit ? formatAuditMetricValue(roicAudit) : undefined} statusBadge={roicAudit ? <MetricQualityBadge quality={roicAudit.quality} /> : roicMeta ? <MetricQualityBadge quality={roicMeta.quality} /> : undefined} min={-5} max={45} step={0.5} onDetailClick={() => setActiveCalculation("roic")} onChange={(value) => update("roic", value)} />
        <RangeControl label="WACC" description={`${"Derived from Yahoo beta and the most recent Yahoo annual statement capital structure, tax rate, and cost of debt; not directly reported by Yahoo statements."} ${waccAudit ? metricAuditReason(waccAudit) : ""}`.trim()} value={assumptions.wacc} valueDisplay={waccAudit ? formatAuditMetricValue(waccAudit) : undefined} statusBadge={waccAudit ? <MetricQualityBadge quality={waccAudit.quality} /> : undefined} min={2} max={24} step={0.25} onDetailClick={() => setActiveCalculation("wacc")} onChange={(value) => update("wacc", value)} />
        <RangeControl label="Debt Ratio" description="Uses the most recent Yahoo annual debt / (debt + equity), not a 5-year average." value={assumptions.debtRatio} min={0} max={90} step={1} onDetailClick={() => setActiveCalculation("debtRatio")} onChange={(value) => update("debtRatio", value)} />
        <RangeControl label="Unlevered Beta" description="Yahoo levered beta de-levered with the most recent annual D/E and tax rate from Yahoo statements; not directly reported in statements." value={assumptions.unleveredBeta} min={0.4} max={2.5} step={0.05} suffix="" onDetailClick={() => setActiveCalculation("unleveredBeta")} onChange={(value) => update("unleveredBeta", value)} />
        <button
          type="button"
          onClick={() => setActiveCalculation("crp")}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--surface)]"
        >
          <div className="text-xs font-bold text-[var(--text-primary)]">Country Risk Premium</div>
          <div className="mt-1 text-xl font-black text-[var(--text-primary)]">{pct(KOREA_COUNTRY_RISK_PREMIUM)}</div>
        </button>
        <RangeControl label="Reinvestment Rate" description="Yahoo annual max(capex - D&A, 0) / NOPAT from 2021+: calculate each year, then average annual rates." value={assumptions.reinvestment} min={0} max={90} step={1} onDetailClick={() => setActiveCalculation("reinvestment")} onChange={(value) => update("reinvestment", value)} />
        <RangeControl label="Innovation Index" description="Yahoo annual R&D / revenue intensity from 2021+, scaled to a 0-100 proxy and averaged; Yahoo does not report a direct innovation score." value={assumptions.innovation} min={0} max={100} step={1} onDetailClick={() => setActiveCalculation("innovation")} onChange={(value) => update("innovation", value)} />
        <RangeControl label="Governance Quality" description="Proxy for ownership alignment, voting structure, disclosure quality, and management accountability." value={assumptions.governance} min={0} max={100} step={1} onDetailClick={() => setActiveCalculation("governance")} onChange={(value) => update("governance", value)} />
        <RangeControl label="ESG / Agency Penalty" description="Penalty score for agency costs, governance friction, and ESG-related execution risk." value={assumptions.esgPenalty} min={0} max={100} step={1} onDetailClick={() => setActiveCalculation("esgPenalty")} onChange={(value) => update("esgPenalty", value)} />
      </div>
    </div>
  );
}
