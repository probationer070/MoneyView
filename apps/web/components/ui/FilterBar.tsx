"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

interface FilterBarProps {
  children: ReactNode;
  sticky?: boolean;
  className?: string;
}

export function FilterBar({ children, sticky = false, className }: FilterBarProps) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-surface)] px-[var(--space-4)] py-[var(--space-3)]",
        sticky && "sticky top-[var(--space-4)] z-20 shadow-[var(--shadow-popover)]",
        className
      )}
    >
      {children}
    </div>
  );
}
