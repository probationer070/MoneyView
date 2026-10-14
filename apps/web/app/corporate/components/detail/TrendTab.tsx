"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_COLORS, GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { MISSING, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import type { AnnualMetricPoint } from "../../corporateTypes";
import { TREND_FIELDS } from "../../detailTabs";
import type { CalculationDetailKey } from "../calculationDetailTypes";
import { TD_FIGURE, THEAD, TR } from "./detailParts";

export interface TrendHistory {
  annual_growth_rates: AnnualMetricPoint[];
  annual_roic: AnnualMetricPoint[];
}

// Spec §4 "추이": a line chart and a year table from /corporate/metrics/{t}/history. It is never
// requested on its own: the button runs the page's source-data refresh (§7 test 9).
export function TrendTab({
  detailKey,
  history,
  isFetching,
  isError,
  onLoad,
}: {
  detailKey: CalculationDetailKey;
  history: TrendHistory | null;
  isFetching: boolean;
  isError: boolean;
  onLoad: () => void;
}) {
  const t = useT();
  const field = TREND_FIELDS[detailKey];
  if (!field) return null;
  const label = t(detailKey === "growth" ? "corporate.assumption.growth" : "corporate.assumption.roic");
  const loadButton = (
    <ActionButton label={t("corporate.detail.trend.load")} size="sm" variant="secondary" disabled={isFetching} onClick={onLoad} />
  );

  if (!history) {
    return (
      <div className="flex flex-col items-start gap-3">
        {isError ? (
          <ErrorState title={t("corporate.detail.trend.error")} message={t("corporate.detail.trend.errorBody")} />
        ) : (
          <EmptyState title={t(isFetching ? "corporate.detail.trend.loading" : "corporate.detail.trend.idle")} />
        )}
        {loadButton}
      </div>
    );
  }

  const rows = [...history[field]].sort((a, b) => a.year - b.year);
  if (rows.every((row) => row.value == null)) return <EmptyState title={t("corporate.detail.trend.empty")} />;

  // The history carries percent units (6.0 = 6.0%); formatNumber takes fractions.
  const asPercent = (value: number | null | undefined) => formatNumber(value == null ? null : value / 100, "percent");

  return (
    <div className="flex flex-col gap-4">
      <h3 className="type-panel-title text-[var(--ink)]">{t("corporate.detail.trend.title", { label })}</h3>
      <div role="img" aria-label={t("corporate.detail.trend.chart", { label })}>
        <ResponsiveChart className="h-56" minWidth={1} minHeight={1}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="year" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0), width: 48 })} />
            <Tooltip {...withTooltipProps()} formatter={(value) => [asPercent(value == null ? null : Number(value)), label]} />
            <Line type="monotone" dataKey="value" stroke={CHART_COLORS.primary} strokeWidth={1.5} connectNulls={false} />
          </LineChart>
        </ResponsiveChart>
      </div>
      <div className="overflow-x-auto border border-[var(--line)]">
        <table data-testid="trend-table" className="w-auto text-left">
          <thead className={THEAD}>
            <tr>
              <th scope="col" className="px-3 py-2"><BilingualLabel k="year" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="value" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year} className={TR}>
                <td className={`${TD_FIGURE} text-left`}>{row.year}</td>
                <td className={`${TD_FIGURE} text-right`}>{row.value == null ? MISSING : asPercent(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
