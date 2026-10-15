import Link from "next/link";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import type { CaseSummary } from "../caseTypes";

export function CaseTable({ cases, all }: { cases: CaseSummary[]; all: CaseSummary[] }) {
  const nameById = new Map(all.map((c) => [c.id, c.case_name]));
  return (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className="w-full min-w-[40rem] text-left type-body">
        <thead className="bg-[var(--surface)] type-caption uppercase text-[var(--ink-muted)]">
          <tr>
            <th className="px-3 py-2"><BilingualLabel k="case" /></th>
            <th className="px-3 py-2"><BilingualLabel k="ticker" /></th>
            <th className="px-3 py-2"><BilingualLabel k="asOf" /></th>
            <th className="px-3 py-2"><BilingualLabel k="years" /></th>
            <th className="px-3 py-2"><BilingualLabel k="forkedFrom" /></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} data-testid={`case-row-${c.id}`} className="border-t border-[var(--line)]">
              <td className="px-3 py-2">
                <Link href={`/cases/${c.id}`} className="text-[var(--ink)] underline-offset-2 hover:underline">
                  {c.case_name}
                </Link>
              </td>
              <td className="px-3 py-2 text-[var(--ink-secondary)]">{c.ticker ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--ink-secondary)]">{c.as_of_date}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--ink-secondary)]">{c.base_year} → {c.target_year}</td>
              <td className="px-3 py-2">
                {c.parent_case_id === null ? (
                  <span className="text-[var(--ink-muted)]">—</span>
                ) : (
                  <Link href={`/cases/${c.parent_case_id}`} className="text-[var(--ink-secondary)] underline-offset-2 hover:underline">
                    {nameById.get(c.parent_case_id) ?? `case ${c.parent_case_id}`}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
