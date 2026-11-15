"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n/locale";

interface PeriodControlProps {
  start: string;
  end: string;
  /** The date inputs and the benchmark selectors, rendered inside the popover. */
  children: ReactNode;
}

/** One "Period {start} – {end}" trigger for the Attribution tab. It opens a small popover holding the date and benchmark controls. */
export function PeriodControl({ start, end, children }: PeriodControlProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (zoneRef.current && !zoneRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const label = t("portfolio.period.trigger", {
    start: start || t("portfolio.period.defaultStart"),
    end: end || t("portfolio.period.latest"),
  });

  return (
    <div ref={zoneRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="type-mono inline-flex h-8 items-center gap-1 rounded-[var(--radius-1)] border border-[var(--line)] px-3 text-[var(--ink)] hover:border-[var(--brand)]"
      >
        {label}
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("portfolio.period.dialog")}
          className="absolute right-0 top-full z-30 mt-1 flex w-80 flex-col gap-3 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface)] p-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}
