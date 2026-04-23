"use client";

import { DenseTable, type ColumnDef } from "@/components/ui/DenseTable";

interface ComparisonTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[];
  data: T[];
  className?: string;
}

export function ComparisonTable<T extends Record<string, unknown>>({
  columns,
  data,
  className,
}: ComparisonTableProps<T>) {
  return (
    <DenseTable
      columns={columns}
      data={data}
      className={className}
    />
  );
}
