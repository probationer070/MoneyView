"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { tabStateKey, useTabState } from "@/lib/tabState";
import { useT } from "@/lib/i18n/locale";
import { RecordsSyncStatus, useRecordsSyncStatus } from "@/app/components/RecordsSyncStatus";
import { casesApi, retryUnlessRefused } from "./casesApi";
import { CaseTable } from "./components/CaseTable";
import { QueryStatus } from "./components/Section";

export default function CasesPage({ searchParams }: { searchParams: Promise<{ ticker?: string }> }) {
  useDevMonitorPageLoad({ component: "cases_page" });
  const t = useT();
  // A Promise in Next.js 16. Read with use(), never as a plain object: that is the
  // "UNDEFINED" defect /detail shipped (ERROR-LOG 2026-09-13).
  const { ticker: urlTicker } = use(searchParams);
  const router = useRouter();
  // The URL wins when it names a ticker (the Valuation link); otherwise the filter this tab
  // last used. useTabState restores after mount, so precedence is decided here, not by order.
  const [storedFilter, setStoredFilter] = useTabState(tabStateKey("cases", "ticker"), "");
  const filter = (urlTicker ?? storedFilter).trim().toUpperCase();

  const casesQuery = useQuery({
    queryKey: ["cases"],
    queryFn: casesApi.list,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });
  const recordsSyncQuery = useRecordsSyncStatus(casesQuery.dataUpdatedAt, casesQuery.isSuccess);

  const onFilter = (value: string) => {
    setStoredFilter(value);
    if (urlTicker !== undefined) router.replace("/cases");
  };

  const all = casesQuery.data ?? [];
  const shown = filter === "" ? all : all.filter((c) => (c.ticker ?? "").toUpperCase() === filter);

  return (
    <div className="p-6">
      <PageHeader
        title={t("cases.title")}
        subtitle={t("cases.subtitle")}
      />
      <RecordsSyncStatus status={recordsSyncQuery.data} />
      <label className="mb-4 flex max-w-xs flex-col gap-1 type-small text-[var(--ink-secondary)]">
        {t("cases.tickerFilter")}
        <input
          value={urlTicker ?? storedFilter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder={t("cases.allTickers")}
          className="rounded-[var(--radius-1)] border border-[var(--line)] bg-transparent px-2 py-1 text-[var(--ink)]"
        />
      </label>
      <QueryStatus query={casesQuery} what="the cases" testId="cases-list" />
      {casesQuery.isSuccess && all.length === 0 && (
        <p className="type-body text-[var(--ink-secondary)]">{t("cases.none")}</p>
      )}
      {casesQuery.isSuccess && all.length > 0 && shown.length === 0 && (
        <p className="type-body text-[var(--ink-secondary)]">{t("cases.noneFor", { filter })}</p>
      )}
      {shown.length > 0 && <CaseTable cases={shown} all={all} />}
    </div>
  );
}
