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
  syncStatus,
  formatSyncTimestamp,
  formatSectorLabel,
}: PortfolioCommandCenterProps) {
  const watchlistTickerSet = new Set(watchlistTickers.map((ticker) => ticker.toUpperCase()));

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Stock Search Panel</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Search the saved company registry and watchlist-backed company set. You can open stock detail from here even when a ticker is not currently in the Portfolio Table.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
          {browserSearchResults.length} result{browserSearchResults.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Search
          <input
            type="text"
            value={browserSearch}
            onChange={(event) => setBrowserSearch(event.target.value)}
            placeholder="Search ticker, name, or sector"
            aria-label="Stock browser search"
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
      </div>

      <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
        {browserSearchResults.map((company) => {
          const alreadyAdded = watchlistTickerSet.has(company.ticker.toUpperCase());
          return (
            <div
              key={`browser-${company.ticker}`}
              className={`flex items-center justify-between gap-3 rounded-[var(--radius)] border px-3 py-3 ${
                alreadyAdded ? "border-[var(--border)] bg-[var(--surface-muted)] opacity-70" : "border-[var(--border)] bg-[var(--bg-surface)]"
              }`}
            >
              <div className="min-w-0">
                <div className="font-bold text-[var(--text-primary)]">{company.ticker}</div>
                <div className="truncate text-sm text-[var(--text-muted)]">{company.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{formatSectorLabel(company.sector ?? "")}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => onOpenCompanyDetail(company)}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Open Detail
                </button>
                <button
                  type="button"
                  onClick={() => onAddCandidate(company)}
                  disabled={alreadyAdded || addingWatchlist}
                  className={`inline-flex items-center justify-center rounded-[var(--radius)] border px-3 py-2 text-xs font-semibold ${
                    alreadyAdded
                      ? "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]"
                      : "border-[var(--accent)] bg-[var(--accent)] text-white"
                  } disabled:opacity-60`}
                >
                  {alreadyAdded ? "Added" : "+ Add"}
                </button>
              </div>
            </div>
          );
        })}
        {browserSearchResults.length === 0 && (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No matching stocks found in the current company registry. Use the manual add form below for a custom ticker.
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-bold text-[var(--text-primary)]">Manual Add</h4>
          <p className="text-sm text-[var(--text-muted)]">
            Use manual add when the stock browser does not include the ticker you want. Saving preserves any existing weight when <span className="font-semibold text-[var(--text-primary)]">Add to Watchlist only</span> stays on.
          </p>
        </div>
        <form onSubmit={onAddHolding} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Ticker
            <input
              type="text"
              value={newTicker}
              onChange={(event) => setNewTicker(event.target.value)}
              placeholder="AAPL"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Name
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Apple"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Sector
            <input
              type="text"
              value={newSector}
              onChange={(event) => setNewSector(event.target.value)}
              placeholder="Technology"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className={`flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)] ${addToWatchlistOnly ? "opacity-60" : ""}`}>
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
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)]"
            />
          </label>
          <div className="md:col-span-2 flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <label className="flex items-start gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={addToWatchlistOnly}
                onChange={(event) => setAddToWatchlistOnly(event.target.checked)}
                aria-label="Add to Watchlist only"
                className="mt-0.5"
              />
              <span>
                Add to Watchlist only
                <span className="mt-1 block text-[length:var(--type-caption)] font-normal text-[var(--text-muted)]">
                  Default keeps this name tracked at 0.0% until you opt into the portfolio model.
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={addingWatchlist}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {addingWatchlist ? "Saving..." : "Save Manual Ticker"}
            </button>
          </div>
        </form>
        {existingTicker && (
          <div className="mt-3 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            Already in Watchlist
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onExportWatchlist}
            disabled={exportingWatchlist}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${exportingWatchlist ? "animate-spin" : ""}`} />
            {exportingWatchlist ? "Exporting..." : "Export Watchlist To JSON"}
          </button>
          <button
            type="button"
            onClick={onImportJson}
            disabled={importingJson || !importJsonArmed}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${importingJson ? "animate-spin" : ""}`} />
            {importingJson ? "Importing..." : "Import JSON Into DB"}
          </button>
        </div>
        <label className="mt-3 flex items-start gap-2 rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={importJsonArmed}
            onChange={(event) => setImportJsonArmed(event.target.checked)}
            aria-label="Arm destructive JSON import"
            className="mt-0.5"
          />
          <span>I understand Import JSON replaces the DB watchlist from file and can overwrite saved weights.</span>
        </label>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Export writes the current DB-backed watchlist, including weights, into `stock_targets.json`. Import is the explicit replace-from-file path and stays intentionally destructive.
        </p>
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-muted)]">
          <div>Last sync/import source: {syncStatus?.source || "None recorded"}</div>
          <div>Last sync/import time: {formatSyncTimestamp(syncStatus?.last_updated_at ?? "")}</div>
          <div>JSON path: {syncStatus?.json_path || "Loading..."}</div>
        </div>
      </div>
    </section>
  );
}
