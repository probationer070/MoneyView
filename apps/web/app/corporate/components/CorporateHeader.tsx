"use client";

import { type FormEvent, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { fieldInputClass } from "@/components/ui/InlineField";
import { PageHeader } from "@/components/ui/PageHeader";
import { TickerSearch } from "@/components/ui/TickerSearch";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import type { CorporateCompany } from "../corporateTypes";

export interface CorporateHeaderProps {
  companies: CorporateCompany[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  /** POST /corporate/companies, then select it; rejects when the request fails. */
  onAddCompany: (company: { ticker: string; name: string }) => Promise<void>;
  companyName: string;
  sector: string | null;
  /** Formatted current price, or null before a DCF has run. */
  priceText: string | null;
  /** Formatted time of the shown DCF, or null when none has run. */
  dcfUpdatedText: string | null;
  dcfStreaming: boolean;
  dcfIsStale: boolean;
  dcfStreamError: string | null;
  onRefreshDcf: () => void;
}

// Spec §2.1: title, search, DCF time and Refresh DCF; below them "name · sector · price". The old
// Add Company form became the search's "not in the list → add" entry and this inline form.
export function CorporateHeader({
  companies, selectedTicker, onSelectTicker, onAddCompany, companyName, sector, priceText,
  dcfUpdatedText, dcfStreaming, dcfIsStale, dcfStreamError, onRefreshDcf,
}: CorporateHeaderProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{ name: string; symbol: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const ticker = draft.symbol.trim().toUpperCase();
    const name = draft.name.trim();
    if (!ticker || !name) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAddCompany({ ticker, name });
      setDraft(null);
      setSearch("");
    } catch {
      setAddError(t("corporate.add.failed", { ticker }));
    } finally {
      setAdding(false);
    }
  };

  return (
    <PageHeader
      title={t("corporate.title")}
      eyebrow={{ label: "corporate" }}
      subtitle={[companyName, sector || MISSING, priceText ?? MISSING].join(" · ")}
      subtitleTestId="corporate-company-line"
      actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-wrap items-end gap-2 sm:justify-end">
            <TickerSearch
              id="company-search"
              label={t("corporate.search.label")}
              value={search}
              onChange={setSearch}
              onSelect={(ticker) => {
                onSelectTicker(ticker);
                setSearch("");
                setDraft(null);
              }}
              items={companies}
              selectedTicker={selectedTicker}
              placeholder={t("corporate.search.placeholder")}
              noMatchAction={{
                label: t("corporate.search.notListed"),
                onSelect: (query) => {
                  setDraft({ name: "", symbol: query.toUpperCase() });
                  setAddError(null);
                },
              }}
              className="w-full sm:w-72"
            />
            <ActionButton
              label={t("corporate.header.refreshDcf")}
              size="sm"
              variant="secondary"
              icon={<RefreshCw aria-hidden="true" className={dcfStreaming ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />}
              disabled={dcfStreaming}
              onClick={onRefreshDcf}
            />
          </div>
          <div className="type-small flex flex-wrap items-center gap-2 text-[var(--ink-muted)] sm:justify-end">
            <span data-testid="dcf-updated">
              {dcfUpdatedText ? t("corporate.assumptions.updated", { time: dcfUpdatedText }) : t("corporate.header.notCalculated")}
            </span>
            {dcfIsStale ? (
              <span className="type-caption rounded-[var(--radius-2)] bg-[var(--status-warning-surface)] px-2 py-0.5 uppercase text-[var(--status-warning-ink)]">
                {t("corporate.comparison.stale")}
              </span>
            ) : null}
            {dcfStreamError ? <span role="alert" className="text-[var(--status-error-ink)]">{dcfStreamError}</span> : null}
          </div>
          {draft ? (
            <form data-testid="add-company-form" onSubmit={(event) => void submit(event)} className="flex w-full flex-wrap items-end gap-2 sm:justify-end">
              <div className="w-48">
                <input
                  aria-label={t("corporate.add.name")}
                  placeholder={t("corporate.add.name")}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className={fieldInputClass}
                />
              </div>
              <div className="w-28">
                <input
                  aria-label={t("corporate.add.symbol")}
                  placeholder={t("corporate.add.symbol")}
                  value={draft.symbol}
                  onChange={(event) => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })}
                  className={fieldInputClass}
                />
              </div>
              <ActionButton
                type="submit"
                label={t("corporate.add.submit")}
                size="sm"
                disabled={adding || !draft.name.trim() || !draft.symbol.trim()}
                onClick={() => {}}
              />
              <ActionButton label={t("corporate.add.cancel")} size="sm" variant="secondary" onClick={() => setDraft(null)} />
              {addError ? <span role="alert" className="type-small text-[var(--status-error-ink)]">{addError}</span> : null}
            </form>
          ) : null}
        </div>
      }
    />
  );
}
