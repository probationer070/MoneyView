"use client";

import dynamic from "next/dynamic";

function GraphLoadingCard({
  className,
  title,
  chartHeightClassName = "h-56",
}: {
  className: string;
  title: string;
  chartHeightClassName?: string;
}) {
  return (
    <div className={`${className} rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5`}>
      <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
      <div className="mt-1 h-3 w-44 animate-pulse rounded bg-[var(--surface-muted)]" />
      <div className={`mt-4 animate-pulse rounded bg-[var(--surface-muted)] ${chartHeightClassName}`} />
    </div>
  );
}

export const BetaWaccCurveGraph = dynamic(
  () => import("./graphs/BetaWaccCurveGraph").then((mod) => mod.BetaWaccCurveGraph),
  {
    loading: () => <GraphLoadingCard className="" title="Bottom-up Beta + WACC U-Curve" />,
  },
);

export const DcfCoreModulesGraph = dynamic(
  () => import("./graphs/DcfCoreModulesGraph").then((mod) => mod.DcfCoreModulesGraph),
  {
    loading: () => <GraphLoadingCard className="" title="DCF Core Modules" chartHeightClassName="h-44" />,
  },
);

export const HurdleRateDecompositionGraph = dynamic(
  () => import("./graphs/HurdleRateDecompositionGraph").then((mod) => mod.HurdleRateDecompositionGraph),
  {
    loading: () => <GraphLoadingCard className="" title="Hurdle Rate Decomposition" />,
  },
);

export const ValueDriverMatrixGraph = dynamic(
  () => import("./graphs/ValueDriverMatrixGraph").then((mod) => mod.ValueDriverMatrixGraph),
  {
    loading: () => <GraphLoadingCard className="" title="4-Quadrant Value Driver Matrix" />,
  },
);
