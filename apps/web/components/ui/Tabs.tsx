"use client";

import type { KeyboardEvent, ReactNode } from "react";
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
  /** Prefixes tab and panel ids, so two tab sets on one page (page tabs and a modal's) never share an id. */
  idPrefix?: string;
}

export function Tabs({
  items,
  activeKey,
  onChange,
  ariaLabel = "Tabs",
  className,
  idPrefix = "",
}: TabsProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = items.findIndex((item) => item.key === activeKey);
    const last = items.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = current >= last ? 0 : current + 1;
        break;
      case "ArrowLeft":
        next = current <= 0 ? last : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]'
    );
    buttons[next]?.focus();
    onChange(items[next].key);
  }

  return (
    <div
      className={clsx(
        "flex gap-4 overflow-x-auto border-b border-[var(--line)]",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const selected = item.key === activeKey;

        return (
          <button
            key={item.key}
            id={`${idPrefix}tab-${item.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}panel-${item.key}`}
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
