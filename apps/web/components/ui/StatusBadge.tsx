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

const variantStyles: Record<StatusVariant, { dot: string; text: string; bg: string }> = {
  live:        { dot: "bg-[var(--state-success)]", text: "text-[var(--state-success)]",  bg: "bg-[var(--state-success)]/10" },
  stale:       { dot: "bg-[var(--state-warning)]", text: "text-[var(--state-warning)]",  bg: "bg-[var(--state-warning)]/10" },
  idle:        { dot: "bg-[var(--text-muted)]",    text: "text-[var(--text-muted)]",      bg: "bg-[var(--bg-subtle)]" },
  loading:     { dot: "bg-[var(--state-info)]",    text: "text-[var(--state-info)]",      bg: "bg-[var(--state-info)]/10" },
  error:       { dot: "bg-[var(--state-error)]",   text: "text-[var(--state-error)]",     bg: "bg-[var(--state-error)]/10" },
  unavailable: { dot: "bg-[var(--text-disabled)]", text: "text-[var(--text-disabled)]",   bg: "bg-[var(--bg-subtle)]" },
  saved:       { dot: "bg-[var(--state-info)]",    text: "text-[var(--state-info)]",      bg: "bg-[var(--state-info)]/10" },
  canceled:    { dot: "bg-[var(--state-warning)]", text: "text-[var(--text-muted)]",      bg: "bg-[var(--state-warning)]/10" },
  "in-progress": { dot: "bg-[var(--state-info)] animate-pulse", text: "text-[var(--state-info)]", bg: "bg-[var(--state-info)]/10" },
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
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-medium leading-tight",
        styles.bg,
        styles.text,
        className
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", styles.dot)} />
      {displayLabel}
    </span>
  );
}
