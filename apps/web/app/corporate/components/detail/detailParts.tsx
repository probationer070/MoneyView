"use client";

import type { ReactNode } from "react";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type StatusVariant } from "@/components/ui/StatusBadge";
import { MISSING } from "@/lib/format";
import type { LabelKey } from "@/lib/i18n/labels";
import type { CalculationRow } from "../calculationDetailTypes";

export const TABLE = "w-full min-w-[42rem] table-fixed text-left";
export const THEAD = "bg-[var(--surface)] type-caption uppercase text-[var(--ink-muted)]";
export const TR = "border-t border-[var(--grid)]";
export const TD = "max-w-80 break-words px-3 py-2 type-small text-[var(--ink)]";
export const TD_FIGURE = "px-3 py-2 type-mono text-[var(--ink)]";

export function SectionCard({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">{title}</h3>
          {description ? <p className="type-small mt-1 text-[var(--ink-muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** label · value · source rows; `asOf` adds one as-of column (plan N3: one date per metric). */
export function DenseRowsTable({
  rows,
  columns,
  asOf,
  emptyTitle,
  emptyDescription,
}: {
  rows: CalculationRow[];
  columns: [LabelKey, LabelKey, LabelKey];
  asOf?: string | null;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  const withAsOf = asOf !== undefined;
  return (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className={TABLE}>
        <thead className={THEAD}>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2"><BilingualLabel k={column} /></th>
            ))}
            {withAsOf ? <th scope="col" className="px-3 py-2"><BilingualLabel k="asOf" /></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${row.source}-${index}`} className={TR}>
              <td className={TD}>{row.label}</td>
              <td className="max-w-72 break-words px-3 py-2 type-mono text-[var(--ink)]">{row.value}</td>
              <td className={TD}>{row.source}</td>
              {withAsOf ? <td className={TD}>{asOf ?? MISSING}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RawDatasetSection({
  title,
  description,
  status,
  statusVariant,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  status: string;
  statusVariant: StatusVariant;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border border-[var(--line)] bg-[var(--surface-raised)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">{title}</h3>
          <p className="type-small mt-1 text-[var(--ink-muted)]">{description}</p>
        </div>
        <StatusBadge status={statusVariant} label={status} className="shrink-0" />
      </summary>
      <div className="border-t border-[var(--line)] p-4">{children}</div>
    </details>
  );
}

export function statusFromText(status: string | null | undefined): StatusVariant {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("loading")) return "loading";
  if (normalized.includes("unavailable")) return "error";
  if (normalized.includes("not loaded")) return "idle";
  if (normalized.includes("refresh")) return "idle";
  return "saved";
}
