import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_COLORS, GRID_STYLE, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { fmtPercent, labelForInput } from "../caseFields";
import type { SimulateResult } from "../caseTypes";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { fmtPerShare } from "../format";

const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;

export function SimulateResults({
  result, pointValue, onRerun, rerunDisabled,
}: { result: SimulateResult; pointValue: number | null; onRerun: (seed: number) => void; rerunDisabled: boolean }) {
  const { locale } = useLocale();
  const t = useT();
  // Presence, not the fraction: the API is the one authority on suppression.
  const suppressed = "suppressed" in result;
  const conditioned = result.runs_refused > 0 ? t("cases.simulate.conditioned") : "";
  // A statistic can be omitted on its own (case_simulate's `not_finite`) even when the
  // simulation as a whole was not suppressed, so each of p10/p50/p90/mean is rendered
  // only if the API actually sent it -- never defaulted, never cast past its absence.
  const statEntries = (["p10", "p50", "p90", "mean"] as const).flatMap((key) => {
    const value = result[key];
    return value === undefined ? [] : [{ key, value }];
  });
  const histogram = result.histogram ?? [];
  const bins = histogram.map((bin, i) => {
    // np.histogram closes the LAST bin on the right; every other bin is half-open, so a
    // point sitting exactly on the final upper edge would otherwise fall in no bin at all.
    const isLastBin = i === histogram.length - 1;
    return {
      ...bin,
      label: fmtPerShare((bin.lower + bin.upper) / 2, locale),
      holdsPoint: pointValue !== null && pointValue >= bin.lower && (isLastBin ? pointValue <= bin.upper : pointValue < bin.upper),
    };
  });
  const markedBin = bins.find((bin) => bin.holdsPoint) ?? null;
  const association = [...(result.association_among_accepted_samples ?? [])].sort(
    (a, b) => Math.abs(b.spearman ?? 0) - Math.abs(a.spearman ?? 0),
  );

  return (
    <div data-testid="simulate-results" className="mt-4 flex flex-col gap-3">
      <p data-testid="simulate-accounting" className="type-body tabular-nums">
        {t("cases.simulate.accounting", {
          valid: formatNumber(result.runs_valid, "integer", { locale }),
          requested: formatNumber(result.runs_requested, "integer", { locale }),
          refused: formatNumber(result.runs_refused, "integer", { locale }),
          pct: fmtPercent(result.refused_fraction, 1),
        })}
      </p>
      {result.refusals.length > 0 && (
        <table className="text-left type-small" aria-label={t("cases.simulate.refusedTable")}>
          <tbody>
            {result.refusals.map((r) => (
              <tr key={r.code} className="border-t border-[var(--line)]">
                <td className="py-1 pr-3 type-mono">{r.code}</td>
                <td className="py-1 pr-3 type-mono">{formatNumber(r.count, "integer", { locale })}</td>
                <td className="py-1 text-[var(--ink-secondary)]">{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p data-testid="simulate-seed" className="type-small text-[var(--ink-muted)]">
        {t("cases.simulate.seedValue", { seed: result.seed })}{" "}
        <button type="button" onClick={() => onRerun(result.seed)} disabled={rerunDisabled} className="underline disabled:opacity-50">
          {t("cases.simulate.rerun")}
        </button>
      </p>

      {suppressed ? (
        <p data-testid="simulate-suppressed" className="type-body text-[var(--ink-secondary)]">
          {result.suppressed}
        </p>
      ) : (
        <>
          <dl data-testid="simulate-stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statEntries.map(({ key, value }) => (
              <div key={key} className="border border-[var(--line)] px-3 py-2">
                <dt className="type-small text-[var(--ink-muted)]">{t("cases.simulate.statLabel", { stat: key === "mean" ? t("cases.simulate.mean") : key.toUpperCase(), conditioned })}</dt>
                <dd data-testid={`simulate-${key}`} className="type-mono">{fmtPerShare(value, locale)}</dd>
              </div>
            ))}
          </dl>
          {result.not_finite && (
            <p data-testid="simulate-not-finite" className="type-small text-[var(--ink-secondary)]">{result.not_finite}</p>
          )}
          <figure data-testid="simulate-histogram">
            <figcaption className="type-small text-[var(--ink-muted)]">
              {t("cases.simulate.histogramCaption", { valid: formatNumber(result.runs_valid, "integer", { locale }), bins: bins.length })}
              {pointValue !== null && (markedBin ? (
                <span data-testid="histogram-mark">
                  {t("cases.simulate.marked", {
                    lower: fmtPerShare(markedBin.lower, locale),
                    upper: fmtPerShare(markedBin.upper, locale),
                    value: fmtPerShare(pointValue, locale),
                  })}
                </span>
              ) : (
                t("cases.simulate.outside", { value: fmtPerShare(pointValue, locale) })
              ))}
            </figcaption>
            <div className="mt-2 h-56 min-h-56 min-w-0">
              <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
                <BarChart data={bins} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid {...GRID_STYLE} vertical={false} />
                  <XAxis dataKey="label" {...withAxisProps({ interval: 7 })} />
                  <YAxis {...withAxisProps({ allowDecimals: false })} />
                  <Tooltip {...withTooltipProps()} />
                  <Bar dataKey="count" name={t("cases.simulate.draws")}>
                    {bins.map((bin) => (
                      <Cell key={bin.lower} fill={bin.holdsPoint ? CHART_COLORS.ink : CHART_COLORS.primary} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveChart>
            </div>
          </figure>
          <div data-testid="simulate-association">
            <h3 className="type-panel-title text-[var(--ink)]">{t("cases.simulate.association")}</h3>
            <p className="type-small text-[var(--ink-muted)]">
              {t("cases.simulate.associationNote")}
            </p>
            <ul className="mt-2 flex flex-col type-body">
              {association.map((a, i) => (
                <li key={a.input} data-testid={`association-${i}`} className="flex justify-between border-b border-[var(--line)] py-1">
                  <span>{labelForInput(a.input)}</span>
                  <span className="tabular-nums">{a.spearman === null ? t("cases.simulate.notMeasurable") : signed(a.spearman)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
