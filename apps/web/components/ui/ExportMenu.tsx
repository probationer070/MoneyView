"use client";

import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, Download } from "lucide-react";
import { useT } from "@/lib/i18n/locale";

export type ExportItem = { key: string; label: string; onSelect: () => void; separatorBefore?: boolean };

const DEFAULT_TRIGGER_CLASS =
  "inline-flex h-[var(--component-button-height-sm)] items-center gap-1.5 rounded-[var(--radius-1)] border border-[var(--line-strong)] px-3 type-caption uppercase text-[var(--ink)] hover:border-[var(--brand)] hover:text-[var(--brand-text)] disabled:cursor-not-allowed disabled:border-[var(--grid)] disabled:text-[var(--ink-disabled)]";

// One button that opens a menu. No items (no result yet) disables it. `busy` disables the items.
export function ExportMenu({
  items,
  label,
  triggerClassName = DEFAULT_TRIGGER_CLASS,
  busy = false,
  testIdPrefix = "mc-export",
}: {
  items: ExportItem[];
  label?: string;
  triggerClassName?: string;
  busy?: boolean;
  testIdPrefix?: string;
}) {
  const t = useT();
  const menuId = useId();
  const triggerId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const focusItem = (index: number) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    itemRefs.current[next]?.focus();
  };

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => focusItem(active + 1),
      ArrowUp: () => focusItem(active - 1),
      Home: () => focusItem(0),
      End: () => focusItem(items.length - 1),
    };
    const move = keys[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
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
        ref={trigger}
        id={triggerId}
        type="button"
        data-testid={testIdPrefix}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={items.length === 0}
        onClick={() => {
          setActive(0);
          setOpen((value) => !value);
        }}
        className={triggerClassName}
      >
        <Download aria-hidden="true" className="h-4 w-4" />
        {label ?? t("monteCarlo.export.button")}
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-1 flex min-w-max flex-col border border-[var(--line)] bg-[var(--surface-raised)] py-1"
        >
          {items.map((item, index) => (
            <Fragment key={item.key}>
              {item.separatorBefore ? <div role="separator" className="my-1 border-t border-[var(--line)]" /> : null}
              <button
                ref={(node) => { itemRefs.current[index] = node; }}
                tabIndex={index === active ? 0 : -1}
                type="button"
                role="menuitem"
                disabled={busy}
                data-testid={`${testIdPrefix}-${item.key}`}
                onClick={() => {
                  item.onSelect();
                  close();
                }}
                className="px-4 py-2 text-left type-small text-[var(--ink)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:text-[var(--ink-disabled)]"
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
