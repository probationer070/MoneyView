"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { casesApi, retryUnlessRefused } from "../casesApi";
import { InputsSection } from "../components/InputsSection";
import { QueryStatus } from "../components/Section";
import { ValuationSection } from "../components/ValuationSection";

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  useDevMonitorPageLoad({ component: "case_detail_page" });
  // A Promise in Next.js 16 -- read with use(). Reading `params.id` directly compiles against
  // a loose type and is undefined at runtime (ERROR-LOG 2026-09-13, the /detail UNDEFINED bug).
  const { id: rawId } = use(params);
  const caseId = Number(rawId);
  const validId = Number.isInteger(caseId) && caseId > 0;

  const caseQuery = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => casesApi.get(caseId),
    enabled: validId,
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });
  const runQuery = useQuery({
    queryKey: ["case-run", caseId],
    queryFn: () => casesApi.run(caseId),
    enabled: caseQuery.isSuccess,
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });

  if (!validId) {
    return <p role="alert" className="p-6 text-[var(--chart-negative)]">Not a case id: {rawId}</p>;
  }
  const record = caseQuery.data;

  return (
    <div className="p-6">
      {record ? (
        <PageHeader
          eyebrow={`Case ${record.id}`}
          title={record.case_name}
          subtitle={`${record.ticker ?? "No ticker"} · as of ${record.as_of_date} · ${record.base_year} → ${record.target_year}`}
        />
      ) : (
        <div className="mb-6"><QueryStatus query={caseQuery} what="the case" testId="case" /></div>
      )}
      {record && record.parent_case_id !== null && (
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Forked from <Link href={`/cases/${record.parent_case_id}`} className="underline underline-offset-2">case {record.parent_case_id}</Link>
        </p>
      )}
      {record && (
        <>
          <ValuationSection query={runQuery} />
          <InputsSection record={record} />
        </>
      )}
    </div>
  );
}
