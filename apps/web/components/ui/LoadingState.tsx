import clsx from "clsx";

type LoadingVariant = "skeleton" | "spinner" | "progress";

interface LoadingStateProps {
  variant?: LoadingVariant;
  label?: string;
  progress?: number;  // 0–100, used when variant="progress"
  className?: string;
}

export function LoadingState({
  variant = "skeleton",
  label,
  progress,
  className,
}: LoadingStateProps) {
  if (variant === "spinner") {
    return (
      <div className={clsx("flex flex-col items-center justify-center gap-3 py-12", className)}>
        <div className="h-8 w-8 rounded-full border-2 border-[var(--border-soft)] border-t-[var(--state-info)] animate-spin" />
        {label && <p className="text-[12px] text-[var(--text-muted)]">{label}</p>}
      </div>
    );
  }

  if (variant === "progress") {
    const pct = Math.min(100, Math.max(0, progress ?? 0));
    return (
      <div className={clsx("flex flex-col gap-2 py-4", className)}>
        {label && (
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[var(--text-muted)]">{label}</p>
            <p className="text-[12px] font-medium text-[var(--text-primary)] tabular-nums">{pct}%</p>
          </div>
        )}
        <div className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
          <div
            className="h-full bg-[var(--state-info)] rounded-full transition-all duration-[var(--duration-normal)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // skeleton (default)
  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="h-5 w-1/3 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] animate-pulse" />
      <div className="h-4 w-full rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] animate-pulse" />
      <div className="h-4 w-5/6 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] animate-pulse" />
      <div className="h-4 w-4/6 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] animate-pulse" />
    </div>
  );
}

// Convenience: skeleton matching a card shape
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-subtle)] animate-pulse",
        className
      )}
    />
  );
}
