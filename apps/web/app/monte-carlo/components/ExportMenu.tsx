"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { useT } from "@/lib/i18n/locale";

export type ExportItem = { key: string; label: string; onSelect: () => void };

// One button that opens a menu of CSV exports. No items (no result yet) disables it.
export function ExportMenu({ items }: { items: ExportItem[] }) {
  const t = useT();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        data-testid="mc-export"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={items.length === 0}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-[var(--component-button-height-sm)] items-center gap-1.5 rounded-[var(--radius-1)] border border-[var(--line-strong)] px-3 type-caption uppercase text-[var(--ink)] hover:border-[var(--brand)] hover:text-[var(--brand-text)] disabled:cursor-not-allowed disabled:border-[var(--grid)] disabled:text-[var(--ink-disabled)]"
      >
        <Download aria-hidden="true" className="h-4 w-4" />
        {t("monteCarlo.export.button")}
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 flex min-w-max flex-col border border-[var(--line)] bg-[var(--surface-raised)] py-1"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              data-testid={`mc-export-${item.key}`}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className="px-4 py-2 text-left type-small text-[var(--ink)] hover:bg-[var(--surface)]"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
