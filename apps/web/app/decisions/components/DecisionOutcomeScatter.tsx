"use client";

import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_COLORS, GRID_STYLE, fmtPctTick, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { partitionDecisions, type DecisionPoint } from "../decisionChartData";
import type { DecisionRow } from "../decisionTypes";

/**
 * Recharts' default scatter mark is `<path class="recharts-symbols">`, NOT a
 * `<circle>` (node_modules/recharts/lib/shape/Symbols.js) -- so a test that
 * counts circles finds zero and a positive control built on one is broken
 * before it starts. A custom shape gives a real `<circle>` AND a per-point
 * testid, so a test can assert WHICH decision produced a point rather than
 * only how many exist.
 *
 * r=11 -> 22px diameter, at the ~24px hit-target floor the dataviz skill sets
 * for scatter marks. Affordable because a personal decision log holds tens of
 * points, not thousands.
 */
function DecisionDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: DecisionPoint }) {
  if (cx === undefined || cy === undefined || payload === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={11}
      fill={CHART_COLORS.primary}
      data-testid={`decision-point-${payload.ticker}`}
    />
  );
}

/**
 * Gap at decision (x) against price move since (y), one dot per decision.
 *
 * Deliberately NO trend line, R-squared, accuracy score or error metric
 * (spec 6). Each of those asserts the axes are commensurable: x is total
 * upside with no horizon, y is a move over a stated period. The scatter shows
 * whatever relationship exists without claiming one.
 *
 * Reference lines at x=0 and y=0 are quadrant dividers, not a fit -- they mark
 * the sign change on each axis independently and assert nothing about the pair.
 *
 * Single series, so no legend: the title names it (dataviz skill). Mark size
 * and the reason for the custom shape are documented on `DecisionDot` above.
 */
export function DecisionOutcomeScatter({ decisions }: { decisions: DecisionRow[] }) {
  const { points, total, outcomeUnavailable, figuresUnavailable } = partitionDecisions(decisions);

  // The partition reports STATES and counts; the wording lives here. Keeping
  // the sentences out of decisionChartData.ts is what lets that module stay a
  // data-semantics module rather than a presentation one.
  const excluded: string[] = [];
  if (outcomeUnavailable > 0) {
    excluded.push(`${outcomeUnavailable} awaiting a later price bar`);
  }
  if (figuresUnavailable > 0) {
    excluded.push(`${figuresUnavailable} recorded without figures`);
  }
  const coverage =
    `${points.length} of ${total} decisions plotted` +
    (excluded.length > 0 ? `; ${excluded.join("; ")}` : "") + ".";

  return (
    <section
      data-testid="decision-outcome-scatter"
      aria-labelledby="decision-scatter-title"
      aria-describedby="decision-scatter-coverage"
      className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
    >
      <h2 id="decision-scatter-title" className="text-sm font-bold text-[var(--text-primary)]">
        Gap at decision against price move since
      </h2>
      {/* Rendered as text, not only in a hover tooltip: the chart's meaning --
          including what it could NOT plot -- must be readable without pointing
          at anything. */}
      <p id="decision-scatter-coverage" className="mt-1 text-xs text-[var(--text-muted)]">
        {coverage}
      </p>
      <div className="mt-3 h-72 min-h-72 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              type="number"
              dataKey="gapPct"
              name="Gap at decision (no horizon)"
              {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })}
            />
            <YAxis
              type="number"
              dataKey="movePct"
              name="Price move since"
              {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })}
            />
            <ReferenceLine x={0} stroke="var(--chart-grid)" />
            <ReferenceLine y={0} stroke="var(--chart-grid)" />
            <Tooltip {...withTooltipProps({ cursor: { strokeDasharray: "3 3" } })} />
            <Scatter data={points} name="Decisions" shape={DecisionDot} />
          </ScatterChart>
        </ResponsiveChart>
      </div>
    </section>
  );
}
