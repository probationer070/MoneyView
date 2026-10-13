"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { useT } from "@/lib/i18n/locale";
import { MISSING } from "@/lib/format";
import type { LabelKey } from "@/lib/i18n/labels";

export interface ColumnDef<T> {
  key: string;
  /** Plain header text: replaced by `label` screen by screen, removed in Task 14. */
  header?: string;
  /** Bilingual header ("종목 NAME"); wins over `header`. */
  label?: LabelKey;
  /** "right" marks a figure column: Geist Mono, tabular, right-aligned (redesign .is-num). */
  align?: "left" | "right" | "center";
  width?: string;
  render?: (value: unknown, row: T) => ReactNode;
}

interface DenseTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  stickyHeader?: boolean;
  className?: string;
}

const alignMap = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DenseTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  emptyMessage,
  stickyHeader = false,
  className,
}: DenseTableProps<T>) {
  const t = useT();
  return (
    <div className={clsx("w-full overflow-x-auto", className)}>
      <table className="type-body w-full min-w-max border-collapse text-[var(--ink-secondary)]">
        <thead className={clsx("bg-[var(--bg)]", stickyHeader && "sticky top-0 z-10")}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={clsx("type-caption whitespace-nowrap border-b border-[var(--line)] px-4 py-2 uppercase text-[var(--ink-muted)]", alignMap[col.align ?? "left"])}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label ? <BilingualLabel k={col.label} /> : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--ink-muted)]">{emptyMessage ?? t("common.noData")}</td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={clsx(
                  "border-b border-[var(--grid)] transition-colors duration-[var(--duration-normal)] hover:bg-[var(--surface)]",
                  onRowClick && "cursor-pointer"
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => {
                  const raw = row[col.key];
                  return (
                    <td
                      key={col.key}
                      className={clsx("whitespace-nowrap px-4 py-3", col.align === "right" && "type-mono text-[var(--ink)]", alignMap[col.align ?? "left"])}
                    >
                      {col.render ? col.render(raw, row) : raw == null ? MISSING : String(raw)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
