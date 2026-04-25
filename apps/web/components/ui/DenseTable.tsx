import type { ReactNode } from "react";
import clsx from "clsx";

export interface ColumnDef<T> {
  key: string;
  header: string;
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
  emptyMessage = "No data available",
  stickyHeader = false,
  className,
}: DenseTableProps<T>) {
  return (
    <div className={clsx("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-max border-collapse text-[length:var(--type-table-body)]">
        <thead
          className={clsx(
            "bg-[var(--bg-subtle)]",
            stickyHeader && "sticky top-0 z-10"
          )}
        >
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  "px-3 py-2.5 text-[length:var(--type-table-header)] font-semibold text-[var(--text-muted)] uppercase tracking-wide border-b border-[var(--border-soft)] whitespace-nowrap",
                  alignMap[col.align ?? "left"]
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-[var(--text-muted)] text-[length:var(--type-table-body)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={clsx(
                  "border-b border-[var(--border-soft)] transition-colors duration-[var(--duration-fast)]",
                  "hover:bg-[var(--bg-subtle)]",
                  onRowClick && "cursor-pointer"
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => {
                  const raw = row[col.key];
                  return (
                    <td
                      key={col.key}
                      className={clsx(
                        "px-3 py-2.5 text-[var(--text-primary)] whitespace-nowrap tabular-nums leading-tight",
                        alignMap[col.align ?? "left"]
                      )}
                    >
                      {col.render
                        ? col.render(raw, row)
                        : raw == null
                        ? "—"
                        : String(raw)}
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
