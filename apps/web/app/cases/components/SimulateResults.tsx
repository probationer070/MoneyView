import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_COLORS, GRID_STYLE, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { fmtPercent, labelForInput } from "../caseFields";
import type { SimulateResult } from "../caseTypes";
import { fmtPerShare } from "../format";

const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;

export function SimulateResults({
  result, pointValue, onRerun,
}: { result: SimulateResult; pointValue: number | null; onRerun: (seed: number) => void }) {
  // Presence, not the fraction: the API is the one authority on suppression.
  const suppressed = "suppressed" in result;
  const conditioned = result.runs_refused > 0 ? " (among accepted draws)" : "";
  // A statistic can be omitted on its own (case_simulate's `not_finite`) even when the
  // simulation as a whole was not suppressed, so each of p10/p50/p90/mean is rendered
  // only if the API actually sent it -- never defaulted, never cast past its absence.
  const statEntries = (["p10", "p50", "p90", "mean"] as const).flatMap((key) => {
    const value = result[key];
    return value === undefined ? [] : [{ key, value }];
  });
  const bins = (result.histogram ?? []).map((bin) => ({
    ...bin,
    label: fmtPerShare((bin.lower + bin.upper) / 2),
    holdsPoint: pointValue !== null && pointValue >= bin.lower && pointValue < bin.upper,
  }));
  const association = [...(result.association_among_accepted_samples ?? [])].sort(
    (a, b) => Math.abs(b.spearman ?? 0) - Math.abs(a.spearman ?? 0),
  );

  return (
    <div data-testid="simulate-results" className="mt-4 flex flex-col gap-3">
      <p data-testid="simulate-accounting" className="text-sm font-medium tabular-nums">
        {result.runs_valid.toLocaleString("en-US")} of {result.runs_requested.toLocaleString("en-US")} draws valued ·{" "}
        {result.runs_refused.toLocaleString("en-US")} refused ({fmtPercent(result.refused_fraction, 1)})
      </p>
      {result.refusals.length > 0 && (
        <table className="text-left text-xs" aria-label="Refused draws">
          <tbody>
            {result.refusals.map((r) => (
              <tr key={r.code} className="border-t border-[var(--border)]">
                <td className="py-1 pr-3 font-mono">{r.code}</td>
                <td className="py-1 pr-3 tabular-nums">{r.count.toLocaleString("en-US")}</td>
                <td className="py-1 text-[var(--text-secondary)]">{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p data-testid="simulate-seed" className="text-xs text-[var(--text-muted)]">
        Seed {result.seed}.{" "}
        <button type="button" onClick={() => onRerun(result.seed)} className="underline">Rerun with this seed</button>
      </p>

      {suppressed ? (
        <p data-testid="simulate-suppressed" className="text-sm text-[var(--text-secondary)]">
          {result.suppressed}
        </p>
      ) : (
        <>
          <dl data-testid="simulate-stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statEntries.map(({ key, value }) => (
              <div key={key} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2">
                <dt className="text-xs text-[var(--text-muted)]">{key === "mean" ? "Mean" : key.toUpperCase()} per share{conditioned}</dt>
                <dd data-testid={`simulate-${key}`} className="text-lg font-bold tabular-nums">{fmtPerShare(value)}</dd>
              </div>
            ))}
          </dl>
          {result.not_finite && (
            <p data-testid="simulate-not-finite" className="text-xs text-[var(--text-secondary)]">{result.not_finite}</p>
          )}
          <figure data-testid="simulate-histogram">
            <figcaption className="text-xs text-[var(--text-muted)]">
              Value per share across {result.runs_valid.toLocaleString("en-US")} accepted draws, 32 bins.
              {pointValue !== null ? ` Marked: the bin holding this case's own value (${fmtPerShare(pointValue)}).` : ""}
            </figcaption>
            <div className="mt-2 h-56 min-h-56 min-w-0">
              <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
                <BarChart data={bins} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid {...GRID_STYLE} vertical={false} />
                  <XAxis dataKey="label" {...withAxisProps({ interval: 7 })} />
                  <YAxis {...withAxisProps({ allowDecimals: false })} />
                  <Tooltip {...withTooltipProps()} />
                  <Bar dataKey="count" name="Draws">
                    {bins.map((bin) => (
                      <Cell key={bin.lower} fill={bin.holdsPoint ? CHART_COLORS.ink : CHART_COLORS.primary} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveChart>
            </div>
          </figure>
          <div data-testid="simulate-association">
            <h3 className="text-xs font-bold text-[var(--text-primary)]">Rank association among accepted draws</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Spearman coefficient, from −1 to 1. It describes how the value moved with each input; it is not a share of the value.
            </p>
            <ul className="mt-2 flex flex-col text-sm">
              {association.map((a, i) => (
                <li key={a.input} data-testid={`association-${i}`} className="flex justify-between border-b border-[var(--border)] py-1">
                  <span>{labelForInput(a.input)}</span>
                  <span className="tabular-nums">{a.spearman === null ? "not measurable (no variation)" : signed(a.spearman)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
