"use client";

import clsx from "clsx";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { formatBp, type ChangeFigure } from "./marketModel";

const BP_TONE = {
  up: "text-[var(--up)]",
  down: "text-[var(--down)]",
  flat: "text-[var(--flat)]",
} as const;

/** One change: a percent chip, a basis-point move for a rate (toned by its sign), or a muted dash. */
export function ChangeFigureText({ figure }: { figure: ChangeFigure }) {
  if (figure.kind === "pct") return <DeltaBadge value={figure.pct} />;
  if (figure.kind === "bp") {
    const tone = figure.bp > 0 ? "up" : figure.bp < 0 ? "down" : "flat";
    return <span data-testid="change-bp" className={clsx("type-mono whitespace-nowrap", BP_TONE[tone])}>{formatBp(figure.bp)}</span>;
  }
  return <span className="type-mono text-[var(--ink-muted)]">—</span>;
}
