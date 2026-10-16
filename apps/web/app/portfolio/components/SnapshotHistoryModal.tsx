"use client";

import { formatNumber } from "@/lib/format";
import { useMemo } from "react";
import { DEFAULT_PORTFOLIO_BENCHMARK_TICKER } from "@/lib/benchmarkPresets";
import { TimelineList } from "@/components/data/TimelineList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ModalShell } from "@/components/ui/ModalShell";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { IMPLIED_RETURN_NOT_RECORDED } from "@/lib/impliedReturn";
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
// What each metric_schema_version changed, keyed by the version it introduced.
const VERSION_NOTICES: Record<number, string> = {
  2: "Metric definition changed. Values before and after this point are not directly comparable.",
  3: "Implied return vs WACC starts here; earlier snapshots did not record it.",
  4: "DCF values before this point used a $1B minimum FCFF, which overstated companies with FCFF under $1B and valued cash-burning companies at +$1B. Values across this point are not comparable for those companies.",
};

const NO_BRIDGED_ROWS_TITLE = "No holding in this snapshot had a resolved equity bridge, so this average covers no rows.";
// From metric v3 an implied return is refused for more than a missing bridge (six codes).
const NO_IMPLIED_RETURN_TITLE = "Every holding in this snapshot was refused an implied return (a missing equity bridge, a non-positive forecast FCFF, or a price outside the model's range), so this average covers no rows.";

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

  // The version boundary is computed against the flat points array, not against a point's
  // neighbour inside its date group: two snapshots from the same day can straddle the
  // boundary, and a within-group comparison would miss it at every group edge. The array
  // arrives newest-first (the history query in corporate_comparison.py ends
  // `ORDER BY lv.snapshot_date DESC`), so the chronologically preceding point is the NEXT
  // entry, and the notice lands on the first point of the new definition.
  //
  // A boundary out of version 0 says less than the others. 0 is written only by the
  // backfill in db.py that added the column to rows computed before it existed, so it
  // means the earlier definition went unrecorded -- not that it differed. Claiming a
  // change there would assert something no stored value supports.
  const versionBoundaryNotices = useMemo(() => {
    const notices = new Map<string, string>();
    const points = history?.points ?? [];
    points.forEach((point, index) => {
      const previous = points[index + 1];
      if (!previous || previous.metric_schema_version === point.metric_schema_version) return;
      if (previous.metric_schema_version === 0) {
        notices.set(point.snapshot_version, "Metric definition before this point was not recorded, so whether values are comparable across it is unknown.");
        return;
      }
      // Every version the boundary crosses gets its own line, so the reader learns WHICH
      // definition changed, not only that one did.
      const lines: string[] = [];
      for (let version = previous.metric_schema_version + 1; version <= point.metric_schema_version; version += 1) {
        if (VERSION_NOTICES[version]) lines.push(VERSION_NOTICES[version]);
      }
      notices.set(point.snapshot_version, lines.length ? lines.join(" ") : VERSION_NOTICES[2]);
    });
    return notices;
  }, [history?.points]);

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
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  className="overflow-inline-ellipsis max-w-full rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 type-caption text-[var(--ink)]"
                  title={point.snapshot_version}
                >
                  Version {point.snapshot_version}
                </span>
                <span className="overflow-inline-ellipsis max-w-full rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 type-caption text-[var(--ink)]">
                  Metric schema v{point.metric_schema_version}
                </span>
              </div>
              {versionBoundaryNotices.has(point.snapshot_version) ? (
                <p className="type-caption text-[var(--ink-muted)]">
                  {versionBoundaryNotices.get(point.snapshot_version)}
                </p>
              ) : null}
            </div>
          ),
          content: (
            <div className="grid grid-cols-2 gap-3 type-small md:grid-cols-4 xl:grid-cols-5">
              <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[var(--ink-muted)]">Avg implied return vs WACC</div>
                {point.average_implied_return_spread == null && point.metric_schema_version < 3 ? (
                  // Before metric v3 no implied return was recorded; that is not "no rows".
                  <div className="type-small mt-1 text-[var(--ink-muted)]">{IMPLIED_RETURN_NOT_RECORDED}</div>
                ) : point.average_implied_return_spread == null ? (
                  <div className="type-small mt-1 text-[var(--ink-muted)]" title={NO_IMPLIED_RETURN_TITLE}>
                    Not available
                  </div>
                ) : (
                  <div className={`type-figure-md mt-1 ${point.average_implied_return_spread >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                    {formatNumber(point.average_implied_return_spread / 100, "percent", { digits: 2 })}
                  </div>
                )}
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[var(--ink-muted)]">Avg ROIC - WACC</div>
                <div className={`type-figure-md mt-1 ${point.average_roic_minus_wacc >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                  {formatNumber(point.average_roic_minus_wacc / 100, "percent", { digits: 2 })}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[var(--ink-muted)]">Avg DCF</div>
                {point.average_dcf_value == null ? (
                  <div className="type-small mt-1 text-[var(--ink-muted)]" title={NO_BRIDGED_ROWS_TITLE}>
                    Not available
                  </div>
                ) : (
                  <div className="type-figure-md mt-1 text-[var(--ink)]">
                    ${formatNumber(point.average_dcf_value, "price", { digits: 1 })}
                  </div>
                )}
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[var(--ink-muted)]">Market Return</div>
                <div className="type-figure-md mt-1 text-[var(--ink)]">
                  {formatNumber(point.market_expected_return / 100, "percent", { digits: 2 })}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[var(--ink-muted)]">Holdings</div>
                <div className="type-figure-md mt-1 text-[var(--ink)]">{point.stock_count}</div>
              </div>
            </div>
          ),
          actions: (
            <>
              <button
                type="button"
                onClick={() => onSelectSnapshot(point)}
                className={`inline-flex items-center justify-center rounded-[var(--radius-1)] border px-3 py-1 type-small ${
                  isActive
                    ? "border-[var(--brand)] bg-[var(--surface)] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                {isActive ? "Selected" : "Review Snapshot"}
              </button>
              <button
                type="button"
                onClick={() => onDeleteSnapshot(point)}
                disabled={deletingSnapshotVersion === point.snapshot_version}
                className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-1 type-small text-[var(--ink-muted)] hover:text-[var(--down)] disabled:opacity-50"
              >
                {deletingSnapshotVersion === point.snapshot_version ? "Deleting..." : "Delete"}
              </button>
            </>
          ),
        };
      }),
    }));
  }, [activeSnapshotVersion, deletingSnapshotVersion, effectiveBenchmarkTicker, history?.points, onDeleteSnapshot, onSelectSnapshot, versionBoundaryNotices]);

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
          <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="type-panel-title text-[var(--ink)]">Locked Context</h3>
                <p className="mt-1 type-small text-[var(--ink-muted)]">
                  Review actions preserve the saved benchmark and universe from the selected snapshot. These fields stay read-only until you clear the saved-history review mode.
                </p>
              </div>
              <StatusBadge status="saved" label="Read-only review context" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">Universe</div>
                <div className="type-mono mt-1 overflow-inline-ellipsis capitalize text-[var(--ink)]" title={effectiveComparisonUniverse}>
                  {effectiveComparisonUniverse}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">Benchmark</div>
                <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={effectiveBenchmarkTicker}>
                  {effectiveBenchmarkTicker}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">Custom Tickers</div>
                <div className="mt-1 overflow-mono-block text-[var(--ink)]" title={customTickersLabel}>{customTickersLabel}</div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">Saved Versions</div>
                <div className="type-figure-md mt-1 text-[var(--ink)]">{history.points.length}</div>
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
              <h3 className="type-panel-title text-[var(--ink)]">Grouped By Date</h3>
              <p className="mt-1 type-small text-[var(--ink-muted)]">
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
