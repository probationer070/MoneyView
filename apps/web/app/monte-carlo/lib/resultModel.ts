import type { MessageKey } from "@/lib/i18n/translate";

export type RunStatus = "idle" | "loading" | "error" | "cancelled";

export type RunStatusView = {
  state: "empty" | "running" | "failed" | "cancelled" | "ready";
  labelKey: MessageKey;
  progress: number | null;
};

// Maps a run's status (and whether an earlier result exists) to the status line. Progress is set only while running.
export function runStatusView(status: RunStatus, progress: number, hasResult: boolean): RunStatusView {
  if (status === "loading") {
    return { state: "running", labelKey: "monteCarlo.status.running", progress: clampPercent(progress) };
  }
  if (status === "error") return { state: "failed", labelKey: "monteCarlo.status.failed", progress: null };
  if (status === "cancelled") return { state: "cancelled", labelKey: "monteCarlo.status.cancelled", progress: null };
  if (hasResult) return { state: "ready", labelKey: "monteCarlo.status.ready", progress: null };
  return { state: "empty", labelKey: "monteCarlo.status.empty", progress: null };
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// The previous figure's text, shown beside the current one. Null when there is nothing to compare or the text is unchanged.
export function beforeText(
  previous: number | null | undefined,
  current: number | null,
  format: (n: number) => string,
): string | null {
  if (previous == null || !Number.isFinite(previous)) return null;
  if (current == null || !Number.isFinite(current)) return null;
  const before = format(previous);
  return before === format(current) ? null : before;
}
