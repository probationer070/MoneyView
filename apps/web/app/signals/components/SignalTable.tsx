"use client";

import clsx from "clsx";
import type { SignalResult } from "../../../../../packages/shared-types";
import { SIGNALS_COPY as T } from "../copy";

const fmt = (v: number | null) => (v === null ? "—" : Number(v.toFixed(4)).toString());
const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

export function SignalTable({ results }: { results: SignalResult[] }) {
  return (
    <table className="w-full text-sm" aria-label="signals">
      <thead className="text-left text-xs text-[var(--text-secondary)]">
        <tr>{Object.values(T.table).map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.rule_id} data-testid={`row-${r.rule_id}`} data-state={r.state}
            className={clsx("border-t border-[var(--border-soft)]", r.state === "stale" && "opacity-50")}>
            <td className="py-2 pr-3" title={r.note}>{r.label_en}</td>
            <td className="pr-3">{r.direction ?? "—"}</td>
            <td className="pr-3 font-semibold">
              {T.states[r.state]}
              {r.state === "stale" && r.note ? <span className="block text-xs font-normal text-[var(--text-secondary)]">{r.note}</span> : null}
            </td>
            <td className="pr-3 tabular-nums">{fmt(r.value)}</td>
            <td className="pr-3 tabular-nums">{fmt(r.threshold)}</td>
            <td className="pr-3 tabular-nums">{r.observed_at ?? "—"}</td>
            <td className="pr-3 tabular-nums">
              {r.contribution ? `A ${pp(r.contribution.a)} · B ${pp(r.contribution.b)} · C ${pp(r.contribution.c)}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
