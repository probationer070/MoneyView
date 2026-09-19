"use client";

export interface WatchlistPeerSyncStatusData {
  enabled: boolean;
  pc_id: string | null;
  peers: Array<{ pc_id: string; written_at: string }>;
  skipped_files: Array<{ name: string; reason: string }>;
  last_sync_at: string | null;
  last_error: string | null;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** One line beside the holdings count (spec §2). Renders nothing while sync is off. */
export function WatchlistPeerSyncStatus({ status }: { status: WatchlistPeerSyncStatusData | undefined }) {
  if (!status?.enabled) return null;
  let text: string;
  let warn = false;
  const n = status.skipped_files.length;
  const skipped = n > 0 ? ` · ${n} file${n === 1 ? "" : "s"} skipped, will retry` : "";
  if (status.last_error) {
    text = "Sync unavailable · changes are kept on this PC";
    warn = true;
  } else if (status.peers.length === 0) {
    text = `Sync on · no other PC has synced yet${skipped}`;
  } else {
    const latest = status.peers.map((peer) => peer.written_at).sort().at(-1)!;
    const count = status.peers.length;
    text = count === 1 ? `Synced with 1 other PC · ${localTime(latest)}` : `Synced with ${count} other PCs · latest ${localTime(latest)}`;
    text += skipped;
  }
  return (
    <span
      data-testid="watchlist-peer-sync"
      title={status.last_error ?? (status.skipped_files.map((file) => `${file.name}: ${file.reason}`).join("\n") || undefined)}
      className={`text-xs ${warn ? "text-[var(--state-warning)]" : "text-[var(--text-muted)]"}`}
    >
      {text}
    </span>
  );
}
