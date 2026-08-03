"use client";

import { useMemo } from "react";
import { DEFAULT_PORTFOLIO_BENCHMARK_TICKER } from "@/lib/benchmarkPresets";
import { TimelineList } from "@/components/data/TimelineList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ModalShell } from "@/components/ui/ModalShell";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type {
  CorporateComparisonHistoryPoint,
  CorporateComparisonHistoryResponse,
} from "../page";

function formatDateLabel(value: string) {
  const [datePart] = value.split("T");
  return datePart ?? value;
}

// Both bridge-dependent averages arrive null when no row in the snapshot had a resolved
// equity bridge. That is an absent average, not a zero one, so it must not be styled as a
// signal or printed as a number.
const NO_BRIDGED_ROWS_TITLE = "No holding in this snapshot had a resolved equity bridge, so this average covers no rows.";

interface SnapshotHistoryModalProps {
  history: CorporateComparisonHistoryResponse | undefined;
  loading: boolean;
  error: boolean;
  activeSnapshotVersion: string;
  deletingSnapshotVersion: string | null;
  onSelectSnapshot: (point: CorporateComparisonHistoryPoint) => void;
  onDeleteSnapshot: (point: CorporateComparisonHistoryPoint) => void;
  onClose: () => void;
}

export function SnapshotHistoryModal({
  history,
  loading,
  error,
  activeSnapshotVersion,
  deletingSnapshotVersion,
  onSelectSnapshot,
  onDeleteSnapshot,
  onClose,
}: SnapshotHistoryModalProps) {
  const effectiveBenchmarkTicker = history?.benchmark_ticker || DEFAULT_PORTFOLIO_BENCHMARK_TICKER;
  const effectiveComparisonUniverse = history?.comparison_universe?.replaceAll("_", " ") || "portfolio plus benchmark";
  const customTickersLabel = history?.custom_tickers.length ? history.custom_tickers.join(", ") : "None";
  const historySubtitle = `Grouped saved snapshots for ${effectiveComparisonUniverse} against ${effectiveBenchmarkTicker}.`;

  const groupedTimeline = useMemo(() => {
    const groups = new Map<string, CorporateComparisonHistoryPoint[]>();

    for (const point of history?.points ?? []) {
      const label = formatDateLabel(point.as_of_date);
      const current = groups.get(label) ?? [];
      current.push(point);
      groups.set(label, current);
    }

    return Array.from(groups.entries()).map(([label, points]) => ({
      id: label,
      label,
      items: points.map((point) => {
        const isActive = point.snapshot_version === activeSnapshotVersion;

        return {
          id: point.snapshot_version,
          title: `${point.snapshot_source} snapshot`,
          subtitle: `${point.stock_count} holdings reviewed against ${point.benchmark_ticker || effectiveBenchmarkTicker}`,
          active: isActive,
          meta: (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="overflow-inline-ellipsis max-w-full rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
                title={point.snapshot_version}
              >
                Version {point.snapshot_version}
              </span>
            </div>
          ),
          content: (
            <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4 xl:grid-cols-5">
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="text-[var(--text-muted)]">Avg Spread</div>
                {point.average_expected_return_spread == null ? (
                  <div className="mt-1 font-bold text-[var(--text-muted)]" title={NO_BRIDGED_ROWS_TITLE}>
                    Not available
                  </div>
                ) : (
                  <div className={`mt-1 font-bold tabular-nums ${point.average_expected_return_spread >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                    {point.average_expected_return_spread.toFixed(2)}%
                  </div>
                )}
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="text-[var(--text-muted)]">Avg ROIC - WACC</div>
                <div className={`mt-1 font-bold tabular-nums ${point.average_roic_minus_wacc >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                  {point.average_roic_minus_wacc.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="text-[var(--text-muted)]">Avg DCF</div>
                {point.average_dcf_value == null ? (
                  <div className="mt-1 font-bold text-[var(--text-muted)]" title={NO_BRIDGED_ROWS_TITLE}>
                    Not available
                  </div>
                ) : (
                  <div className="mt-1 font-bold tabular-nums text-[var(--text-primary)]">
                    ${point.average_dcf_value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </div>
                )}
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="text-[var(--text-muted)]">Market Return</div>
                <div className="mt-1 font-bold tabular-nums text-[var(--text-primary)]">
                  {point.market_expected_return.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="text-[var(--text-muted)]">Holdings</div>
                <div className="mt-1 font-bold tabular-nums text-[var(--text-primary)]">{point.stock_count}</div>
              </div>
            </div>
          ),
          actions: (
            <>
              <button
                type="button"
                onClick={() => onSelectSnapshot(point)}
                className={`inline-flex items-center justify-center rounded-[var(--radius)] border px-3 py-1 text-xs font-semibold ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--text-primary)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {isActive ? "Selected" : "Review Snapshot"}
              </button>
              <button
                type="button"
                onClick={() => onDeleteSnapshot(point)}
                disabled={deletingSnapshotVersion === point.snapshot_version}
                className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--delta-down)] disabled:opacity-50"
              >
                {deletingSnapshotVersion === point.snapshot_version ? "Deleting..." : "Delete"}
              </button>
            </>
          ),
        };
      }),
    }));
  }, [activeSnapshotVersion, deletingSnapshotVersion, effectiveBenchmarkTicker, history?.points, onDeleteSnapshot, onSelectSnapshot]);

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Snapshot History"
      subtitle={historySubtitle}
      size="lg"
    >
      <div className="space-y-4">
        {!loading && !error && history && (
          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Locked Context</h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Review actions preserve the saved benchmark and universe from the selected snapshot. These fields stay read-only until you clear the saved-history review mode.
                </p>
              </div>
              <StatusBadge status="saved" label="Read-only review context" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                <div className="text-[var(--text-muted)]">Universe</div>
                <div className="mt-1 overflow-inline-ellipsis font-bold capitalize text-[var(--text-primary)]" title={effectiveComparisonUniverse}>
                  {effectiveComparisonUniverse}
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                <div className="text-[var(--text-muted)]">Benchmark</div>
                <div className="mt-1 overflow-inline-ellipsis font-bold text-[var(--text-primary)]" title={effectiveBenchmarkTicker}>
                  {effectiveBenchmarkTicker}
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                <div className="text-[var(--text-muted)]">Custom Tickers</div>
                <div className="mt-1 overflow-mono-block text-[var(--text-primary)]" title={customTickersLabel}>{customTickersLabel}</div>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                <div className="text-[var(--text-muted)]">Saved Versions</div>
                <div className="mt-1 font-bold text-[var(--text-primary)]">{history.points.length}</div>
              </div>
            </div>
          </section>
        )}
        {loading && <EmptyState title="Loading snapshot history..." />}
        {error && <ErrorState title="Snapshot History Unavailable" message="Could not load saved portfolio snapshot history." />}
        {!loading && !error && (history?.points.length ?? 0) === 0 && (
          <EmptyState title="No saved snapshots yet" description="Snapshots are created automatically when comparison data is saved." />
        )}
        {!loading && !error && (history?.points.length ?? 0) > 0 && (
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Grouped By Date</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Each date group shows every saved version from that day. Use Review Snapshot to reopen a saved portfolio comparison with its locked benchmark and universe.
              </p>
            </div>
            <TimelineList groups={groupedTimeline} />
          </section>
        )}
      </div>
    </ModalShell>
  );
}
