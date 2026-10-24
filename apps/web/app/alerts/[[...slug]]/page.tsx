"use client";

import { use, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RecordReport } from "@/components/risk/RecordReport";
import { RecordsTable } from "@/components/risk/RecordsTable";
import { ActionButton } from "@/components/ui/ActionButton";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterBar } from "@/components/ui/FilterBar";
import { fieldInputClass } from "@/components/ui/InlineField";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { useLocale, useT } from "@/lib/i18n/locale";
import {
  recordRows, recordsCsv, recordsCsvName, type RecordFilterKind, type RecordKind, type RecordRow,
} from "@/lib/recordsCsv";
import { useMovers, useRiskHistory, useSurgeHistory } from "@/lib/useRisk";

// The signal records page (risk UI spec §4, plan Task 5). Each list is loaded once and filtered here;
// the filters live in the query string, so a reload keeps them. The report on the right is RecordReport.

const KINDS: RecordFilterKind[] = ["all", "risk", "surge", "movers"];
const MOVERS_FROM = "2016-01-04";
const PAGE_SIZE = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD naming a real calendar day: 2026-02-30 and 2026-99-99 are not. */
function isCalendarDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}

const ID_VALID: Record<RecordKind, (id: string) => boolean> = {
  risk: (id) => /^\d+$/.test(id), surge: (id) => /^\d+$/.test(id), movers: isCalendarDate,
};

interface Filters { kind: RecordFilterKind; from: string; to: string; shown: boolean }
type Selection = { state: "list" } | { state: "record"; kind: RecordKind; id: string } | { state: "notFound" };
type Query = Record<string, string | string[] | undefined>;

/** [] is the list; [kind, id] with a known kind and a well-formed id is a record; anything else is not found. */
function parseSlug(slug: string[]): Selection {
  if (slug.length === 0) return { state: "list" };
  const [kind, id] = slug;
  if (slug.length === 2 && (kind === "risk" || kind === "surge" || kind === "movers") && ID_VALID[kind](id)) {
    return { state: "record", kind, id };
  }
  return { state: "notFound" };
}

function parseFilters(query: Query): Filters {
  const one = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };
  const kind = KINDS.find((k) => k === one("kind")) ?? "all";
  const date = (key: string) => (isCalendarDate(one(key)) ? one(key) : "");
  return { kind, from: date("from"), to: date("to"), shown: kind === "surge" && one("shown") === "1" };
}

/** "?kind=surge&from=…" with defaults left out; "" when every filter is at its default. */
function filterQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.kind === "surge" && filters.shown) params.set("shown", "1");
  const text = params.toString();
  return text ? `?${text}` : "";
}

function matches(row: RecordRow, filters: Filters): boolean {
  if (filters.kind !== "all" && row.kind !== filters.kind) return false;
  if (filters.from && row.date < filters.from) return false;
  if (filters.to && row.date > filters.to) return false;
  return !(filters.shown && row.kind === "surge" && !row.record.shown);
}

function downloadCsv(filename: string, csv: string) {
  // The BOM makes a spreadsheet read the file as UTF-8, so Korean headers survive.
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Attached while clicked (some browsers ignore a detached anchor); the URL is freed after the click has started the save.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function AlertsPage({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<Query> }) {
  useDevMonitorPageLoad({ component: "alerts_page" });
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/alerts";
  // Promises in Next.js 16: read with use() (ERROR-LOG 2026-09-13, the /detail UNDEFINED bug).
  const { slug = [] } = use(params);
  const query = use(searchParams);
  const selection = parseSlug(slug);
  // The filters are state, read from the address and written back to it. Building each change from the
  // address instead would lose a change made before the previous replace has landed (two quick edits).
  const [filters, setFilterState] = useState(() => parseFilters(query));
  const queryText = filterQuery(filters);
  const addressQuery = filterQuery(parseFilters(query));
  // Queries this page wrote that the address has not reached yet. An address that is none of them came from
  // outside (back/forward, a nav link), and the filters follow it. Adjusted while rendering, as React advises
  // for state derived from a changed input.
  const [pending, setPending] = useState<string[]>([]);
  const [seenAddress, setSeenAddress] = useState(addressQuery);
  if (seenAddress !== addressQuery) {
    setSeenAddress(addressQuery);
    const at = pending.indexOf(addressQuery);
    if (at >= 0) {
      setPending(pending.slice(at + 1));
    } else {
      setPending([]);
      if (addressQuery !== queryText) setFilterState(parseFilters(query));
    }
  }

  const history = useRiskHistory();
  const surge = useSurgeHistory();
  const movers = useMovers({ from: MOVERS_FROM });
  const sources = [history, surge, movers];
  const failed = sources.some((source) => source.isError);
  const ready = history.data !== undefined && surge.data !== undefined && movers.data !== undefined;

  const rows = useMemo(
    () => (history.data && surge.data && movers.data ? recordRows(history.data, surge.data, movers.data) : []),
    [history.data, surge.data, movers.data],
  );
  const shownRows = useMemo(() => rows.filter((row) => matches(row, filters)), [rows, filters]);
  const badRange = filters.from !== "" && filters.to !== "" && filters.from > filters.to;
  // At most PAGE_SIZE rows are mounted until "more" is pressed; the count starts over when the filters change.
  const [page, setPage] = useState({ key: queryText, limit: PAGE_SIZE });
  const limit = page.key === queryText ? page.limit : PAGE_SIZE;
  const visibleRows = useMemo(() => shownRows.slice(0, limit), [shownRows, limit]);
  const moreCount = Math.min(PAGE_SIZE, shownRows.length - visibleRows.length);

  const selected = selection.state === "record" ? rows.find((row) => row.kind === selection.kind && row.id === selection.id) ?? null : null;
  const notFound = selection.state === "notFound" || (selection.state === "record" && ready && selected === null);

  const setFilters = (next: Partial<Filters>) => {
    const merged = { ...filters, ...next };
    const updated = { ...merged, shown: merged.kind === "surge" && merged.shown };
    const text = filterQuery(updated);
    setFilterState(updated);
    if (text === queryText) return;
    setPending([...pending, text]);
    router.replace(`${pathname}${text}`, { scroll: false });
  };
  const hrefFor = (row: RecordRow) => `/alerts/${row.kind}/${encodeURIComponent(row.id)}${queryText}`;

  const download = () => {
    if (shownRows.length === 0) return;
    const from = filters.from || shownRows[shownRows.length - 1].date;
    const to = filters.to || shownRows[0].date;
    downloadCsv(recordsCsvName(filters.kind, from, to), recordsCsv(shownRows, filters.kind, locale));
  };

  let table;
  if (failed) {
    table = <ErrorState message={t("risk.records.loadError")} retryAction={() => sources.forEach((source) => source.isError && source.refetch())} />;
  } else if (!ready) {
    table = <LoadingState variant="spinner" label={t("risk.records.loading")} />;
  } else {
    table = (
      <>
        <RecordsTable
          rows={visibleRows}
          kind={filters.kind}
          selected={selected}
          hrefFor={hrefFor}
          onSelect={(row) => router.push(hrefFor(row), { scroll: false })}
          emptyText={badRange ? t("risk.records.badRange") : t("risk.records.empty")}
        />
        {moreCount > 0 && (
          <div className="flex justify-center p-3">
            <ActionButton size="sm" label={t("risk.records.more", { count: moreCount })} onClick={() => setPage({ key: queryText, limit: limit + PAGE_SIZE })} />
          </div>
        )}
      </>
    );
  }

  let report;
  if (notFound) {
    report = <p className="type-body text-[var(--ink)]">{t("risk.records.notFound")}</p>;
  } else if (selected) {
    report = <RecordReport key={`${selected.kind}:${selected.id}`} row={selected} />;
  } else {
    report = <p className="type-body text-[var(--ink-muted)]">{t("risk.records.pick")}</p>;
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col">
      <PageHeader tight title={t("risk.records.title")} subtitle={t("risk.records.subtitle")} />
      <FilterBar className="mb-3">
        <ToggleGroup
          ariaLabel={t("risk.records.kindLabel")}
          options={KINDS.map((kind) => ({ value: kind, label: t(`risk.records.kind.${kind}`) }))}
          value={filters.kind}
          onChange={(kind) => setFilters({ kind: kind as RecordFilterKind })}
        />
        {(["from", "to"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2">
            <span className="type-small text-[var(--ink-muted)]">{t(`risk.records.${key}`)}</span>
            <span className="w-40">
              <input type="date" className={fieldInputClass} value={filters[key]} onChange={(event) => setFilters({ [key]: event.target.value })} />
            </span>
          </label>
        ))}
        {filters.kind === "surge" && (
          <label className="type-small flex items-center gap-2 text-[var(--ink)]">
            <input type="checkbox" checked={filters.shown} onChange={(event) => setFilters({ shown: event.target.checked })} />
            {t("risk.records.shownOnly")}
          </label>
        )}
        <ActionButton size="sm" className="ml-auto" label={t("risk.records.download")} onClick={download} disabled={!ready || shownRows.length === 0} />
      </FilterBar>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-1">
        <div className="relative min-h-0 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)]">{table}</div>
        <section
          data-testid="records-report"
          aria-label={t("risk.records.title")}
          className="relative min-h-0 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)] p-4"
        >
          {report}
        </section>
      </div>
    </div>
  );
}
