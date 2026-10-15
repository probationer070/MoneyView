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
        {/* rounded-full: spinner */}
        <div className="h-8 w-8 rounded-full border-2 border-[var(--grid)] border-t-[var(--brand)] animate-spin" />
        {label && <p className="type-small text-[var(--ink-muted)]">{label}</p>}
      </div>
    );
  }

  if (variant === "progress") {
    const pct = Math.min(100, Math.max(0, progress ?? 0));
    return (
      <div className={clsx("flex flex-col gap-2 py-4", className)}>
        {label && (
          <div className="flex items-center justify-between">
            <p className="type-small text-[var(--ink-muted)]">{label}</p>
            <p className="type-small text-[var(--ink)] tabular-nums">{pct}%</p>
          </div>
        )}
        {/* rounded-full: track */}
        <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
          {/* rounded-full: fill */}
          <div
            className="h-full bg-[var(--brand)] rounded-full transition-all duration-[var(--duration-normal)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // skeleton (default)
  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="h-5 w-1/3 rounded-[var(--radius-2)] bg-[var(--surface)] animate-pulse" />
      <div className="h-4 w-full rounded-[var(--radius-2)] bg-[var(--surface)] animate-pulse" />
      <div className="h-4 w-5/6 rounded-[var(--radius-2)] bg-[var(--surface)] animate-pulse" />
      <div className="h-4 w-4/6 rounded-[var(--radius-2)] bg-[var(--surface)] animate-pulse" />
    </div>
  );
}

// Convenience: skeleton matching a card shape
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "border border-[var(--line)] bg-[var(--surface)] animate-pulse",
        className
      )}
    />
  );
}
