"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

/** The redesign's text input (bundle.css .mv-input); every <input>/<select>/<textarea> uses it. */
export const fieldInputClass =
  "type-body h-[var(--component-input-height)] w-full rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--surface-sunken)] pl-4 pr-2 text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--brand)] aria-[invalid=true]:border-[var(--status-error-border)] disabled:border-[var(--grid)] disabled:text-[var(--ink-disabled)]";

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
        <span className="type-label min-w-0 text-[var(--ink)]">{label}</span>
        {helperText && (
          <span className="type-small max-w-[16rem] text-right text-[var(--ink-muted)]">
            {helperText}
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </label>
  );
}
