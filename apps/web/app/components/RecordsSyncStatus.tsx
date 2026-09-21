"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

export interface RecordsSyncStatusData {
  enabled: boolean;
  pc_id: string | null;
  peers: Array<{ pc_id: string; written_at: string }>;
  skipped_files: Array<{ name: string; reason: string }>;
  last_sync_at: string | null;
  last_error: string | null;
  renamed: string[];
}

interface SyncStatusResponse {
  watchlist: unknown;
  records: RecordsSyncStatusData;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Reads GET /api/v1/sync/status and returns its records half, keyed on the page's own record
 * query's `dataUpdatedAt` so the status is read AFTER the sync that read triggered (task 8).
 */
export function useRecordsSyncStatus(recordDataUpdatedAt: number, enabled: boolean) {
  return useQuery<RecordsSyncStatusData>({
    queryKey: ["records-sync-status", recordDataUpdatedAt],
    queryFn: () => fetchApi<SyncStatusResponse>("/sync/status").then((status) => status.records),
    enabled,
    refetchOnWindowFocus: false,
    // The key changes on every record-query refetch; keep showing the last status until the
    // new one arrives, or the line blinks out on every refetch.
    placeholderData: keepPreviousData,
  });
}

/** One line on the Valuation, Decisions and Events pages. Renders nothing while sync is off. */
export function RecordsSyncStatus({ status }: { status: RecordsSyncStatusData | undefined }) {
  if (!status?.enabled) return null;
  let text: string;
  let warn = false;
  const skippedCount = status.skipped_files.length;
  const skipped = skippedCount > 0 ? ` · ${skippedCount} file${skippedCount === 1 ? "" : "s"} skipped, will retry` : "";
  const renamedCount = status.renamed.length;
  const renamed = renamedCount > 0 ? ` · ${renamedCount} name clash repaired` : "";
  if (status.last_error) {
    text = "Sync unavailable · changes are kept on this PC";
    warn = true;
  } else if (status.peers.length === 0) {
    text = `Sync on · no other PC has synced yet${skipped}${renamed}`;
  } else {
    const latest = status.peers.map((peer) => peer.written_at).sort().at(-1)!;
    const count = status.peers.length;
    text = count === 1
      ? `Synced with 1 other PC · ${localTime(latest)}`
      : `Synced with ${count} other PCs · latest ${localTime(latest)}`;
    text += skipped + renamed;
  }
  return (
    <span
      data-testid="records-sync-status"
      title={status.last_error ?? (status.skipped_files.map((file) => `${file.name}: ${file.reason}`).join("\n") || undefined)}
      className={`text-xs ${warn ? "text-[var(--state-warning)]" : "text-[var(--text-muted)]"}`}
    >
      {text}
    </span>
  );
}
