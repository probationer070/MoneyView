"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

interface TabsItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  items: TabsItem[];
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function Tabs({
  items,
  activeKey,
  onChange,
  ariaLabel = "Tabs",
  className,
}: TabsProps) {
  return (
    <div
      className={clsx(
        "flex gap-[var(--space-2)] overflow-x-auto border-b border-[var(--border-soft)]",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = item.key === activeKey;

        return (
          <button
            key={item.key}
            id={`tab-${item.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={clsx(
              "inline-flex min-h-10 items-center gap-[var(--space-2)] border-b-2 px-[var(--space-1)] pb-[var(--space-3)] pt-[var(--space-2)] text-[length:var(--type-label)] font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1",
              selected
                ? "border-[var(--border-accent)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
