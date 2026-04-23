"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

interface InlineFieldProps {
  label: string;
  helperText?: string;
  children: ReactNode;
  className?: string;
}

export function InlineField({
  label,
  helperText,
  children,
  className,
}: InlineFieldProps) {
  return (
    <label
      className={clsx(
        "grid gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-surface)] px-[var(--space-3)] py-[var(--space-3)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <span className="min-w-0 text-[12px] font-semibold text-[var(--text-primary)]">{label}</span>
        {helperText && (
          <span className="max-w-[16rem] text-right text-[11px] leading-[1.4] text-[var(--text-muted)]">
            {helperText}
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </label>
  );
}
