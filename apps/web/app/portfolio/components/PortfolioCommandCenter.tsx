"use client";

import { type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";

interface BrowserCompany {
  ticker: string;
  name: string;
  sector?: string;
  source?: string;
}

interface WatchlistSyncStatusView {
  source?: string | null;
  last_updated_at?: string | null;
  json_path?: string | null;
}

interface PortfolioCommandCenterProps {
  browserSearch: string;
  setBrowserSearch: (value: string) => void;
  browserSearchResults: BrowserCompany[];
  watchlistTickers: string[];
  onOpenCompanyDetail: (company: BrowserCompany) => void;
  onAddCandidate: (company: BrowserCompany) => void;
  addingWatchlist: boolean;
  newTicker: string;
  setNewTicker: (value: string) => void;
  newName: string;
  setNewName: (value: string) => void;
  newSector: string;
  setNewSector: (value: string) => void;
  newWeightPercent: string;
  setNewWeightPercent: (value: string) => void;
  addToWatchlistOnly: boolean;
  setAddToWatchlistOnly: (value: boolean) => void;
  onAddHolding: (event: FormEvent<HTMLFormElement>) => void;
  existingTicker: boolean;
  onExportWatchlist: () => void;
  exportingWatchlist: boolean;
  onImportJson: () => void;
  importingJson: boolean;
  importJsonArmed: boolean;
  setImportJsonArmed: (value: boolean) => void;
  /** Null when Import is available. Otherwise the reason shown in its place. */
  importUnavailableReason: string | null;
  syncStatus?: WatchlistSyncStatusView;
  formatSyncTimestamp: (value: string) => string;
  formatSectorLabel: (value: string) => string;
}

export function PortfolioCommandCenter({
  browserSearch,
  setBrowserSearch,
  browserSearchResults,
  watchlistTickers,
  onOpenCompanyDetail,
  onAddCandidate,
  addingWatchlist,
  newTicker,
  setNewTicker,
  newName,
  setNewName,
  newSector,
  setNewSector,
  newWeightPercent,
  setNewWeightPercent,
  addToWatchlistOnly,
  setAddToWatchlistOnly,
  onAddHolding,
  existingTicker,
  onExportWatchlist,
  exportingWatchlist,
  onImportJson,
  importingJson,
  importJsonArmed,
  setImportJsonArmed,
  importUnavailableReason,
  syncStatus,
  formatSyncTimestamp,
  formatSectorLabel,
}: PortfolioCommandCenterProps) {
  const watchlistTickerSet = new Set(watchlistTickers.map((ticker) => ticker.toUpperCase()));

  return (
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">Stock Search Panel</h3>
          <p className="mt-1 type-body text-[var(--ink-muted)]">
            Search the saved company registry and watchlist-backed company set. You can open stock detail from here even when a ticker is not currently in the Portfolio Table.
          </p>
        </div>
        <span className="rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1 type-small text-[var(--ink-muted)]">
          {browserSearchResults.length} result{browserSearchResults.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4">
        <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
          Search
          <input
            type="text"
            value={browserSearch}
            onChange={(event) => setBrowserSearch(event.target.value)}
            placeholder="Search ticker, name, or sector"
            aria-label="Stock browser search"
            className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
          />
        </label>
      </div>

      <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
        {browserSearchResults.map((company) => {
          const alreadyAdded = watchlistTickerSet.has(company.ticker.toUpperCase());
          return (
            <div
              key={`browser-${company.ticker}`}
              className={`flex items-center justify-between gap-3 border px-3 py-3 ${
                alreadyAdded ? "border-[var(--line)] bg-[var(--surface)] opacity-70" : "border-[var(--line)] bg-[var(--surface-raised)]"
              }`}
            >
              <div className="min-w-0">
                <div className="type-mono  text-[var(--ink)]">{company.ticker}</div>
                <div className="truncate type-body text-[var(--ink-muted)]">{company.name}</div>
                <div className="type-small text-[var(--ink-muted)]">{formatSectorLabel(company.sector ?? "")}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => onOpenCompanyDetail(company)}
                  className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  Open Detail
                </button>
                <button
                  type="button"
                  onClick={() => onAddCandidate(company)}
                  disabled={alreadyAdded || addingWatchlist}
                  className={`inline-flex items-center justify-center rounded-[var(--radius-1)] border px-3 py-2 type-small ${
                    alreadyAdded
                      ? "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)]"
                      : "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                  } disabled:opacity-60`}
                >
                  {alreadyAdded ? "Added" : "+ Add"}
                </button>
              </div>
            </div>
          );
        })}
        {browserSearchResults.length === 0 && (
          <div className="border border-dashed border-[var(--line)] bg-[var(--surface-raised)] px-4 py-6 type-body text-[var(--ink-muted)]">
            No matching stocks found in the current company registry. Use the manual add form below for a custom ticker.
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <div className="flex flex-col gap-2">
          <h4 className="type-panel-title text-[var(--ink)]">Manual Add</h4>
          <p className="type-body text-[var(--ink-muted)]">
            Use manual add when the stock browser does not include the ticker you want. Saving preserves any existing weight when {/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold text-[var(--ink)]">Add to Watchlist only</span> stays on.
          </p>
        </div>
        <form onSubmit={onAddHolding} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
            Ticker
            <input
              type="text"
              value={newTicker}
              onChange={(event) => setNewTicker(event.target.value)}
              placeholder="AAPL"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
            Name
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Apple"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
            Sector
            <input
              type="text"
              value={newSector}
              onChange={(event) => setNewSector(event.target.value)}
              placeholder="Technology"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            />
          </label>
          <label className={`flex flex-col gap-1 type-small text-[var(--ink-muted)] ${addToWatchlistOnly ? "opacity-60" : ""}`}>
            Initial Allocation %
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={newWeightPercent}
              onChange={(event) => setNewWeightPercent(event.target.value)}
              placeholder={addToWatchlistOnly ? "0.0" : "25.0"}
              disabled={addToWatchlistOnly}
              aria-label="Initial allocation percent"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)] disabled:cursor-not-allowed disabled:bg-[var(--surface)]"
            />
          </label>
          <div className="md:col-span-2 flex flex-col gap-3 border border-[var(--line)] bg-[var(--surface-raised)] p-3">
            <label className="flex items-start gap-2 type-small text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={addToWatchlistOnly}
                onChange={(event) => setAddToWatchlistOnly(event.target.checked)}
                aria-label="Add to Watchlist only"
                className="mt-0.5"
              />
              <span>
                Add to Watchlist only
                <span className="mt-1 block type-caption text-[var(--ink-muted)]">
                  Default keeps this name tracked at 0.0% until you opt into the portfolio model.
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={addingWatchlist}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] bg-[var(--brand)] px-4 py-2 type-body text-[var(--on-brand)] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {addingWatchlist ? "Saving..." : "Save Manual Ticker"}
            </button>
          </div>
        </form>
        {existingTicker && (
          <div className="mt-3 inline-flex items-center rounded-[var(--radius-2)] border border-[var(--status-success-border)] bg-[var(--status-success-surface)] px-3 py-1 type-small text-[var(--status-success-ink)]">
            Already in Watchlist
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onExportWatchlist}
            disabled={exportingWatchlist}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${exportingWatchlist ? "animate-spin" : ""}`} />
            {exportingWatchlist ? "Exporting..." : "Export Watchlist To JSON"}
          </button>
          {importUnavailableReason === null && (
            <button
              type="button"
              onClick={onImportJson}
              disabled={importingJson || !importJsonArmed}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)] hover:bg-[var(--status-warning-surface)] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${importingJson ? "animate-spin" : ""}`} />
              {importingJson ? "Importing..." : "Import JSON Into DB"}
            </button>
          )}
        </div>
        {importUnavailableReason === null ? (
          <label className="mt-3 flex items-start gap-2 rounded-[var(--radius-1)] border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)]">
            <input
              type="checkbox"
              checked={importJsonArmed}
              onChange={(event) => setImportJsonArmed(event.target.checked)}
              aria-label="Arm destructive JSON import"
              className="mt-0.5"
            />
            <span>I understand Import JSON replaces the DB watchlist from file and can overwrite saved weights.</span>
          </label>
        ) : (
          <p className="mt-3 type-small text-[var(--ink-muted)]">{importUnavailableReason}</p>
        )}
        <p className="mt-3 type-body text-[var(--ink-muted)]">
          Export writes the current DB-backed watchlist, including weights, into data/exports/watchlist-export.json (git-ignored, personal). Import replaces the watchlist from the committed starter seed and is intentionally destructive.
        </p>
        <div className="mt-3 bg-[var(--surface-raised)] p-3 type-body text-[var(--ink-muted)]">
          <div>Last sync/import source: {syncStatus?.source || "None recorded"}</div>
          <div>Last sync/import time: {formatSyncTimestamp(syncStatus?.last_updated_at ?? "")}</div>
          <div>JSON path: {syncStatus?.json_path || "Loading..."}</div>
        </div>
      </div>
    </section>
  );
}
