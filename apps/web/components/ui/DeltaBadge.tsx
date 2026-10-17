"use client";

import clsx from "clsx";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { RollingNumber } from "@/components/ui/RollingNumber";

interface DeltaBadgeProps {
  /** A change in percent units: 1.24 means +1.24%. */
  value: number | null | undefined;
  /** Opt-in: the percent text rolls like an odometer on change. "enter" also rolls in from zeros on first mount. */
  animate?: boolean | "enter";
  className?: string;
}

const GLYPH = { up: "▲", down: "▼", flat: "■" } as const;
const TONE = {
  up: "text-[var(--up)] bg-[var(--up-soft)]",
  down: "text-[var(--down)] bg-[var(--down-soft)]",
  flat: "text-[var(--flat)] bg-[var(--surface)]",
} as const;

// The redesign's delta chip: glyph, sign and colour together, never colour alone. A screen
// reader hears the direction word instead of the glyph. A span, not a div, so it can sit
// inside a <button> (StockTile).
export function DeltaBadge({ value, animate, className }: DeltaBadgeProps) {
  const { locale } = useLocale();
  const t = useT();
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  const text = numeric === null ? MISSING : formatNumber(numeric / 100, "percent", { signed: true, locale });
  // Direction follows the printed figure (1 decimal). Intl rounds half away from zero, so -0.05 prints
  // "-0.1%" and must read as down; Math.round(-0.5) is -0, so the test uses the magnitude. -0.04 prints
  // "0.0%" and reads as flat.
  const dir = numeric === null || Math.round(Math.abs(numeric) * 10) === 0 ? "flat" : numeric > 0 ? "up" : "down";
  return (
    <span
      data-testid="delta-badge"
      data-dir={dir}
      className={clsx("type-mono inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-2)] px-2 py-0.5", TONE[dir], className)}
    >
      <span className="sr-only">{t(`delta.${dir}`)}</span>
      <span aria-hidden="true" className="text-[length:var(--component-delta-glyph)]">{GLYPH[dir]}</span>
      {animate ? (
        <span data-part="value">
          <RollingNumber value={numeric} format={(n) => formatNumber(n / 100, "percent", { signed: true, locale })} enter={animate === "enter"} />
        </span>
      ) : (
        <span data-part="value">{text}</span>
      )}
    </span>
  );
}
