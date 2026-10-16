"use client";

import clsx from "clsx";
import type { SignalResult } from "../../../../../packages/shared-types";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/translate";

const fmt = (v: number | null) => (v === null ? "—" : Number(v.toFixed(4)).toString());
const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

const COLUMNS: readonly MessageKey[] = [
  "signals.table.signal", "signals.table.direction", "signals.table.state", "signals.table.value",
  "signals.table.threshold", "signals.table.observed", "signals.table.contribution",
];

export function SignalTable({ results }: { results: SignalResult[] }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <table className="type-body w-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)]" aria-label="signals">
      <thead className="type-label text-left text-[var(--ink-secondary)]">
        <tr>{COLUMNS.map((k) => <th key={k} className="px-3 py-2">{t(k)}</th>)}</tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.rule_id} data-testid={`row-${r.rule_id}`} data-state={r.state}
            className={clsx("border-t border-[var(--grid)]", r.state === "stale" && "opacity-50")}>
            <td className="px-3 py-2" title={r.note}>{locale === "ko" ? r.label_ko : r.label_en}</td>
            <td className="pr-3">{r.direction ?? "—"}</td>
            <td className="type-label pr-3">
              {t(`signals.states.${r.state}`)}
              {r.state === "stale" && r.note ? <span className="type-small block text-[var(--ink-secondary)]">{r.note}</span> : null}
            </td>
            <td className="type-mono pr-3">{fmt(r.value)}</td>
            <td className="type-mono pr-3">{fmt(r.threshold)}</td>
            <td className="type-mono pr-3">{r.observed_at ?? "—"}</td>
            <td className="type-mono pr-3">
              {r.contribution ? `A ${pp(r.contribution.a)} · B ${pp(r.contribution.b)} · C ${pp(r.contribution.c)}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
