"use client";

import dynamic from "next/dynamic";

function GraphLoadingCard({
  className = "",
  title,
  chartHeightClassName = "h-56",
}: {
  className?: string;
  title: string;
  chartHeightClassName?: string;
}) {
  // No title text: the real chart draws the same heading and a test may wait for it. The name is
  // the aria-label instead, so getByText matches only the chart, never this placeholder.
  return (
    <div role="status" aria-label={title} className={`${className} border border-[var(--line)] bg-[var(--surface)] p-5`}>
      <div className="h-3 w-44 animate-pulse bg-[var(--surface-raised)]" />
      <div className={`mt-4 animate-pulse bg-[var(--surface-raised)] ${chartHeightClassName}`} />
    </div>
  );
}

export const BetaWaccCurveGraph = dynamic(
  () => import("./graphs/BetaWaccCurveGraph").then((mod) => mod.BetaWaccCurveGraph),
  {
    loading: () => <GraphLoadingCard title="Bottom-up Beta + WACC U-Curve" />,
  },
);

export const DcfCoreModulesGraph = dynamic(
  () => import("./graphs/DcfCoreModulesGraph").then((mod) => mod.DcfCoreModulesGraph),
  {
    loading: () => <GraphLoadingCard title="DCF Core Modules" chartHeightClassName="h-44" />,
  },
);

export const HurdleRateDecompositionGraph = dynamic(
  () => import("./graphs/HurdleRateDecompositionGraph").then((mod) => mod.HurdleRateDecompositionGraph),
  {
    loading: () => <GraphLoadingCard title="Hurdle Rate Decomposition" />,
  },
);

export const ValueDriverMatrixGraph = dynamic(
  () => import("./graphs/ValueDriverMatrixGraph").then((mod) => mod.ValueDriverMatrixGraph),
  {
    loading: () => <GraphLoadingCard title="4-Quadrant Value Driver Matrix" />,
  },
);
