"use client";

import { type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { StockSearchAdd } from "./StockSearchAdd";
import { useT } from "@/lib/i18n/locale";

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
  const t = useT();
  return (
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">{t("portfolio.weights.search.title")}</h3>
          <p className="mt-1 type-body text-[var(--ink-muted)]">
            {t("portfolio.weights.search.body")}
          </p>
        </div>
        <span className="rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1 type-small text-[var(--ink-muted)]">
          {browserSearchResults.length === 1 ? t("portfolio.weights.search.oneResult", { count: browserSearchResults.length }) : t("portfolio.weights.search.manyResults", { count: browserSearchResults.length })}
        </span>
      </div>

      <StockSearchAdd
        search={browserSearch}
        onSearchChange={setBrowserSearch}
        results={browserSearchResults}
        watchlistTickers={watchlistTickers}
        onAdd={onAddCandidate}
        adding={addingWatchlist}
        onOpenDetail={onOpenCompanyDetail}
        formatSectorLabel={formatSectorLabel}
        labels={{
          search: t("portfolio.weights.search.label"),
          placeholder: t("portfolio.weights.search.placeholder"),
          ariaLabel: t("portfolio.weights.search.ariaLabel"),
          add: t("portfolio.weights.search.add"),
          added: t("portfolio.weights.search.added"),
          openDetail: t("portfolio.weights.search.openDetail"),
          empty: t("portfolio.weights.search.empty"),
        }}
      />

      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <div className="flex flex-col gap-2">
          <h4 className="type-panel-title text-[var(--ink)]">{t("portfolio.weights.manual.title")}</h4>
          <p className="type-body text-[var(--ink-muted)]">
            {t("portfolio.weights.manual.body1")}{/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold text-[var(--ink)]">{t("portfolio.weights.manual.watchlistOnly")}</span>{t("portfolio.weights.manual.bodyEnd")}
          </p>
        </div>
        <form onSubmit={onAddHolding} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
            {t("portfolio.weights.manual.ticker")}
            <input
              type="text"
              value={newTicker}
              onChange={(event) => setNewTicker(event.target.value)}
              placeholder="AAPL"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
            {t("portfolio.weights.manual.name")}
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Apple"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
            {t("portfolio.weights.manual.sector")}
            <input
              type="text"
              value={newSector}
              onChange={(event) => setNewSector(event.target.value)}
              placeholder="Technology"
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            />
          </label>
          <label className={`flex flex-col gap-1 type-small text-[var(--ink-muted)] ${addToWatchlistOnly ? "opacity-60" : ""}`}>
            {t("portfolio.weights.manual.initialAllocation")}
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={newWeightPercent}
              onChange={(event) => setNewWeightPercent(event.target.value)}
              placeholder={addToWatchlistOnly ? "0.0" : "25.0"}
              disabled={addToWatchlistOnly}
              aria-label={t("portfolio.weights.manual.initialAllocationAria")}
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)] disabled:cursor-not-allowed disabled:bg-[var(--surface)]"
            />
          </label>
          <div className="md:col-span-2 flex flex-col gap-3 border border-[var(--line)] bg-[var(--surface-raised)] p-3">
            <label className="flex items-start gap-2 type-small text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={addToWatchlistOnly}
                onChange={(event) => setAddToWatchlistOnly(event.target.checked)}
                aria-label={t("portfolio.weights.manual.watchlistOnly")}
                className="mt-0.5 h-6 w-6 shrink-0"
              />
              <span>
                {t("portfolio.weights.manual.watchlistOnly")}
                <span className="mt-1 block type-caption text-[var(--ink-muted)]">
                  {t("portfolio.weights.manual.watchlistOnlyHelp")}
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={addingWatchlist}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] bg-[var(--brand)] px-4 py-2 type-body text-[var(--on-brand)] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {addingWatchlist ? t("portfolio.weights.manual.saving") : t("portfolio.weights.manual.save")}
            </button>
          </div>
        </form>
        {existingTicker && (
          <div className="mt-3 inline-flex items-center rounded-[var(--radius-2)] border border-[var(--status-success-border)] bg-[var(--status-success-surface)] px-3 py-1 type-small text-[var(--status-success-ink)]">
            {t("portfolio.weights.manual.existing")}
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
            {exportingWatchlist ? t("portfolio.weights.json.exporting") : t("portfolio.weights.json.exportAction")}
          </button>
          {importUnavailableReason === null && (
            <button
              type="button"
              onClick={onImportJson}
              disabled={importingJson || !importJsonArmed}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)] hover:bg-[var(--status-warning-surface)] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${importingJson ? "animate-spin" : ""}`} />
              {importingJson ? t("portfolio.weights.json.importing") : t("portfolio.weights.json.importAction")}
            </button>
          )}
        </div>
        {importUnavailableReason === null ? (
          <label className="mt-3 flex items-start gap-2 rounded-[var(--radius-1)] border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)]">
            <input
              type="checkbox"
              checked={importJsonArmed}
              onChange={(event) => setImportJsonArmed(event.target.checked)}
              aria-label={t("portfolio.weights.json.armAria")}
              className="mt-0.5 h-6 w-6 shrink-0"
            />
            <span>{t("portfolio.weights.json.armLabel")}</span>
          </label>
        ) : (
          <p className="mt-3 type-small text-[var(--ink-muted)]">{importUnavailableReason}</p>
        )}
        <p className="mt-3 type-body text-[var(--ink-muted)]">
          {t("portfolio.weights.json.help")}
        </p>
        <div className="mt-3 bg-[var(--surface-raised)] p-3 type-body text-[var(--ink-muted)]">
          <div>{t("portfolio.weights.json.syncSource")} {syncStatus?.source || t("portfolio.weights.json.noneRecorded")}</div>
          <div>{t("portfolio.weights.json.syncTime")} {formatSyncTimestamp(syncStatus?.last_updated_at ?? "")}</div>
          <div>{t("portfolio.weights.json.jsonPath")} {syncStatus?.json_path || t("portfolio.weights.json.loading")}</div>
        </div>
      </div>
    </section>
  );
}
