import clsx from "clsx";

export type StatusVariant =
  | "live"
  | "stale"
  | "idle"
  | "loading"
  | "error"
  | "unavailable"
  | "saved"
  | "canceled"
  | "in-progress";

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  className?: string;
}

const SUCCESS = { dot: "bg-[var(--status-success-ink)]", box: "bg-[var(--status-success-surface)] text-[var(--status-success-ink)] border-[var(--status-success-border)]" };
const WARNING = { dot: "bg-[var(--status-warning-ink)]", box: "bg-[var(--status-warning-surface)] text-[var(--status-warning-ink)] border-[var(--status-warning-border)]" };
const ERROR = { dot: "bg-[var(--status-error-ink)]", box: "bg-[var(--status-error-surface)] text-[var(--status-error-ink)] border-[var(--status-error-border)]" };
const NEUTRAL = { dot: "bg-[var(--ink-muted)]", box: "bg-[var(--surface)] text-[var(--ink-secondary)] border-[var(--line)]" };
// Work in progress is the brand, not a status tone: brand dot, brand text on a soft ground.
const INFO = { dot: "bg-[var(--brand)]", box: "bg-[var(--brand-soft)] text-[var(--brand-text)] border-[var(--brand)]" };

const variantStyles: Record<StatusVariant, { dot: string; box: string }> = {
  live: SUCCESS,
  stale: WARNING,
  idle: NEUTRAL,
  loading: INFO,
  error: ERROR,
  unavailable: NEUTRAL,
  saved: INFO,
  canceled: NEUTRAL,
  "in-progress": { ...INFO, dot: "bg-[var(--brand)] animate-pulse" },
};

const defaultLabels: Record<StatusVariant, string> = {
  live:         "Live",
  stale:        "Stale",
  idle:         "Idle",
  loading:      "Loading",
  error:        "Error",
  unavailable:  "Unavailable",
  saved:        "Saved",
  canceled:     "Canceled",
  "in-progress": "Running",
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const styles = variantStyles[status];
  const displayLabel = label ?? defaultLabels[status];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-2)] border px-2 py-0.5 type-small",
        styles.box,
        className
      )}
    >
      {/* rounded-full: dot */}
      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", styles.dot)} />
      {displayLabel}
    </span>
  );
}
