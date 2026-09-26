import Link from "next/link";
import type { CaseSummary } from "../caseTypes";

export function CaseTable({ cases, all }: { cases: CaseSummary[]; all: CaseSummary[] }) {
  const nameById = new Map(all.map((c) => [c.id, c.case_name]));
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="bg-[var(--surface)] text-xs font-bold uppercase tracking-wide text-[var(--text-primary)]">
          <tr>
            <th className="px-3 py-2">Case</th>
            <th className="px-3 py-2">Ticker</th>
            <th className="px-3 py-2">As of</th>
            <th className="px-3 py-2">Years</th>
            <th className="px-3 py-2">Forked from</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} data-testid={`case-row-${c.id}`} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 font-medium">
                <Link href={`/cases/${c.id}`} className="text-[var(--text-primary)] underline-offset-2 hover:underline">
                  {c.case_name}
                </Link>
              </td>
              <td className="px-3 py-2 text-[var(--text-secondary)]">{c.ticker ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{c.as_of_date}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{c.base_year} → {c.target_year}</td>
              <td className="px-3 py-2">
                {c.parent_case_id === null ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : (
                  <Link href={`/cases/${c.parent_case_id}`} className="text-[var(--text-secondary)] underline-offset-2 hover:underline">
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
