"use client";

import { Fragment, useState } from "react";
import { Info, MoreHorizontal, Pencil } from "lucide-react";
import clsx from "clsx";
import type { CorporateDerivedMetricMeta, CorporateMetricAuditEntry, MetricQuality } from "../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { fieldInputClass } from "@/components/ui/InlineField";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { useT } from "@/lib/i18n/locale";
import { formatAuditMetricValue } from "@/lib/metricAudit";
import { ASSUMPTION_ROWS, formatAssumption, type AssumptionField, type AssumptionKey, type AssumptionRowDef } from "../assumptionRows";
import { KOREA_COUNTRY_RISK_PREMIUM } from "../corporateConstants";
import type { CorporateAssumptions, RoicBasis } from "../corporateTypes";
import { dateTimeText, pct } from "../corporateUtils";
import type { CalculationDetailKey } from "./calculationDetailTypes";
import { RangeControl } from "./RangeControl";

export interface AssumptionTableProps {
  assumptions: CorporateAssumptions;
  onChange: (field: AssumptionField, value: number) => void;
  onOpenDetail: (key: CalculationDetailKey) => void;
  growthMeta: CorporateDerivedMetricMeta | null;
  roicMeta: CorporateDerivedMetricMeta | null;
  roicAudit: CorporateMetricAuditEntry | null;
  waccAudit: CorporateMetricAuditEntry | null;
  sourceTicker: string;
  sourceUpdatedAt: string | null;
  staleSourceTickers: string[];
  sourceIsFetching: boolean;
  hasSourceData: boolean;
  roicYearUnavailableMessage: string;
  onRefreshSourceData: () => void;
  roicBasis: RoicBasis;
  roicYear: string;
  annualRoicValues: { year: number | string; value: number | null }[];
  onRoicBasisChange: (basis: RoicBasis) => void;
  onRoicYearChange: (year: string) => void;
  growthBasisLabel: string;
  className?: string;
}

const ICON_BUTTON = "inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink-muted)] hover:text-[var(--ink)]";
const TH = "type-caption px-2 py-1 uppercase text-[var(--ink-muted)]";

function metricMetaReason(meta: CorporateDerivedMetricMeta | null) {
  if (!meta) return "";
  return meta.reason ?? meta.warnings[0] ?? "";
}

// Spec §2.4: one row per assumption (name · value · status · ✎ · ⓘ). ✎ opens that row's slider
// and closes any other; the table scrolls inside a 288px region so the page does not.
export function AssumptionTable(props: AssumptionTableProps) {
  const {
    assumptions, onChange, onOpenDetail, growthMeta, roicMeta, roicAudit, waccAudit,
    sourceTicker, sourceUpdatedAt, staleSourceTickers, sourceIsFetching, hasSourceData, roicYearUnavailableMessage,
    onRefreshSourceData, roicBasis, roicYear, annualRoicValues, onRoicBasisChange, onRoicYearChange, growthBasisLabel, className,
  } = props;
  const t = useT();
  const [expanded, setExpanded] = useState<AssumptionKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const display = (row: AssumptionRowDef) => {
    if (row.field === null) return pct(KOREA_COUNTRY_RISK_PREMIUM);
    if (row.key === "roic" && roicAudit) return formatAuditMetricValue(roicAudit);
    if (row.key === "wacc" && waccAudit) return formatAuditMetricValue(waccAudit);
    return formatAssumption(row, assumptions[row.field]);
  };
  const quality = (row: AssumptionRowDef): MetricQuality | null => {
    if (row.key === "growth") return growthMeta?.quality ?? null;
    if (row.key === "roic") return roicAudit?.quality ?? roicMeta?.quality ?? null;
    if (row.key === "wacc") return waccAudit?.quality ?? null;
    return null;
  };

  return (
    <section data-testid="assumption-table" className={clsx("flex min-w-0 flex-col border border-[var(--line)] bg-[var(--surface-raised)]", className)}>
      <div className="relative flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <Eyebrow label="assumptions" />
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t("corporate.assumptions.detail")} title={t("corporate.assumptions.detail")} onClick={() => onOpenDetail("realtime")} className={ICON_BUTTON}>
            <Info aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("corporate.assumptions.menu")}
            title={t("corporate.assumptions.menu")}
            aria-expanded={menuOpen}
            aria-controls="assumption-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className={ICON_BUTTON}
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {menuOpen ? (
          <div id="assumption-menu" data-testid="assumption-menu" className="absolute right-0 top-full z-30 mt-1 flex w-72 flex-col gap-3 rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--bg)] p-3">
            <ActionButton label={t("corporate.assumptions.refreshSource")} size="sm" variant="secondary" disabled={sourceIsFetching} onClick={onRefreshSourceData} />
            <label className="type-label flex flex-col gap-1 text-[var(--ink)]">
              {t("corporate.assumptions.roicBasis")}
              <select value={roicBasis} onChange={(event) => onRoicBasisChange(event.target.value as RoicBasis)} className={fieldInputClass}>
                <option value="recent_average">{t("corporate.assumptions.basisRecent")}</option>
                <option value="all_year_average">{t("corporate.assumptions.basisAll")}</option>
                <option value="annual">{t("corporate.assumptions.basisAnnual")}</option>
              </select>
            </label>
            {roicBasis === "annual" ? (
              <label className="type-label flex flex-col gap-1 text-[var(--ink)]">
                {t("corporate.assumptions.roicYear")}
                <select value={roicYear} onChange={(event) => onRoicYearChange(event.target.value)} className={fieldInputClass}>
                  {annualRoicValues.map((point) => (
                    <option key={point.year} value={point.year}>
                      {point.year}: {point.value == null ? t("corporate.assumptions.yearUnavailable") : pct(point.value)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="type-label text-[var(--ink)]">{t("corporate.assumptions.growthBasis")}</span>
              <span className="type-body flex items-center gap-2 text-[var(--ink)]">
                {growthBasisLabel}
                {growthMeta ? <MetricQualityBadge quality={growthMeta.quality} /> : null}
              </span>
              <span className="type-small text-[var(--ink-muted)]">{metricMetaReason(growthMeta) || t("corporate.assumptions.growthDefault")}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div data-testid="assumption-scroll" className="max-h-72 overflow-y-auto">
        <table className="w-full table-fixed">
          <thead className="sticky top-0 z-10 bg-[var(--surface-raised)]">
            <tr>
              <th scope="col" className={clsx(TH, "text-left")}><BilingualLabel k="item" /></th>
              <th scope="col" className={clsx(TH, "w-20 text-right")}><BilingualLabel k="value" /></th>
              <th scope="col" className={clsx(TH, "w-24 text-left")}><BilingualLabel k="status" /></th>
              <th scope="col" className="w-16 px-2 py-1"><span className="sr-only">{t("corporate.assumptions.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {ASSUMPTION_ROWS.map((row) => {
              const label = t(`corporate.assumption.${row.key}`);
              const rowQuality = quality(row);
              const field = row.field;
              const isOpen = expanded === row.key && field !== null;
              // font-normal on the row label: it reads as body text, not as the bold browser table header.
              return (
                <Fragment key={row.key}>
                  <tr data-testid={`assumption-row-${row.key}`} className="border-t border-[var(--grid)]">
                    <th scope="row" className="type-small truncate px-3 py-1.5 text-left font-normal text-[var(--ink)]">{label}</th>
                    <td className="type-mono px-2 py-1.5 text-right text-[var(--ink)]">{display(row)}</td>
                    <td className="px-2 py-1.5">
                      {rowQuality ? <MetricQualityBadge quality={rowQuality} /> : field === null ? <span className="type-small text-[var(--ink-muted)]">{t("corporate.assumptions.fixed")}</span> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                        {field !== null ? (
                          <button
                            type="button"
                            aria-label={t("corporate.assumptions.edit", { label })}
                            aria-expanded={isOpen}
                            aria-controls={`assumption-slider-${row.key}`}
                            onClick={() => setExpanded((current) => (current === row.key ? null : row.key))}
                            className={ICON_BUTTON}
                          >
                            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button type="button" aria-label={t("corporate.assumptions.info", { label })} title={t("corporate.assumptions.info", { label })} onClick={() => onOpenDetail(row.key)} className={ICON_BUTTON}>
                          <Info aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && field !== null ? (
                    <tr id={`assumption-slider-${row.key}`} data-testid={`assumption-slider-${row.key}`}>
                      <td colSpan={4} className="px-3 pb-2">
                        <RangeControl
                          label={label}
                          value={assumptions[field]}
                          valueDisplay={display(row)}
                          min={row.min}
                          max={row.max}
                          step={row.step}
                          suffix={row.suffix}
                          onChange={(value) => onChange(field, value)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div data-testid="source-data-status" className="type-small flex flex-wrap gap-x-2 gap-y-1 border-t border-[var(--line)] px-3 py-2 text-[var(--ink-muted)]">
        <span>{sourceUpdatedAt ? t("corporate.assumptions.updated", { time: dateTimeText(sourceUpdatedAt) }) : t("corporate.assumptions.notLoaded")}</span>
        {staleSourceTickers.length > 0 ? (
          <span className="text-[var(--status-warning-ink)]">
            {t("corporate.assumptions.staleSource", { cached: staleSourceTickers.join(", "), ticker: sourceTicker })}
          </span>
        ) : null}
        {!hasSourceData && !sourceIsFetching ? <span>{t("corporate.assumptions.sourceIdle")}</span> : null}
        {roicYearUnavailableMessage ? <span className="text-[var(--status-error-ink)]">{roicYearUnavailableMessage}</span> : null}
      </div>
    </section>
  );
}
