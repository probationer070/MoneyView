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
        "flex gap-4 overflow-x-auto border-b border-[var(--line)]",
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
              "type-mono relative inline-flex rounded-[var(--radius-1)] min-h-10 items-center gap-2 px-1 pb-3 pt-2 uppercase transition-colors duration-[var(--duration-normal)]",
              selected
                ? "text-[var(--ink)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--brand)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
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
