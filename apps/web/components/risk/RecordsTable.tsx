"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import clsx from "clsx";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { formatNumber, MISSING } from "@/lib/format";
import type { LabelKey } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/lib/i18n/locale";
import {
  endReasonKey, primaryThemeName, RANKS, riskThemeNames, usefulKey, type RecordFilterKind, type RecordRow,
} from "@/lib/recordsCsv";
import type { MoversDayOut, RiskAlertSummary } from "../../../../packages/shared-types";

// The /alerts records table (risk UI spec §4): one row per signal, columns by kind. Values are the API's.

type Locale = "en" | "ko";
type T = ReturnType<typeof useT>;
interface Ctx { t: T; locale: Locale }
interface Column { key: string; label: LabelKey; figure?: boolean; render: (row: RecordRow, ctx: Ctx) => ReactNode }

const SHOWN_THEMES = 3;

const mono = (text: string) => <span className="type-mono">{text}</span>;
const optional = (value: string | null) => mono(value ?? MISSING);
const risk = (row: RecordRow) => (row as Extract<RecordRow, { kind: "risk" }>).record;
const surge = (row: RecordRow) => (row as Extract<RecordRow, { kind: "surge" }>).record;
const movers = (row: RecordRow) => (row as Extract<RecordRow, { kind: "movers" }>).record;

function OriginBadge({ row, t }: { row: RecordRow; t: T }) {
  if (row.kind === "movers" || row.record.origin !== "backfill") return null;
  return (
    <span className="type-small ml-2 rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface)] px-1 text-[var(--ink-secondary)]">
      {t("risk.records.origin.backfill")}
    </span>
  );
}

const startCell = (row: RecordRow, { t }: Ctx) => <>{mono(row.date)}<OriginBadge row={row} t={t} /></>;

function riskThemes(record: RiskAlertSummary, { t, locale }: Ctx) {
  const names = riskThemeNames(record, locale).slice(0, SHOWN_THEMES).join(", ");
  const template = t("risk.records.themesMore", { names });
  return <FigureText parts={withFigures(template, { count: formatNumber(record.theme_count, "integer", { locale }) })} />;
}

function moverCell(record: MoversDayOut, rank: number) {
  const item = record.items.find((m) => m.rank === rank);
  if (!item) return MISSING;
  return (
    <span className="inline-flex items-center gap-2" title={item.name}>
      <span className="type-mono text-[var(--ink)]">{item.ticker}</span>
      <DeltaBadge value={item.return_pct} />
    </span>
  );
}

function subject(row: RecordRow, ctx: Ctx): ReactNode {
  if (row.kind === "risk") return riskThemes(row.record, ctx);
  if (row.kind === "surge") return row.record.label[ctx.locale];
  return mono(row.record.items.map((m) => m.ticker).join(", "));
}

const COLUMNS: Record<RecordFilterKind, Column[]> = {
  all: [
    { key: "kind", label: "recordKind", render: (row, { t }) => t(`risk.records.kind.${row.kind}`) },
    { key: "start", label: "startDate", render: startCell },
    {
      key: "end", label: "endDate",
      render: (row) => (row.kind === "risk" ? optional(risk(row).release_date) : row.kind === "surge" ? optional(surge(row).end_date) : MISSING),
    },
    { key: "subject", label: "subject", render: subject },
  ],
  risk: [
    { key: "start", label: "startDate", render: startCell },
    { key: "release", label: "releaseDate", render: (row) => optional(risk(row).release_date) },
    { key: "days", label: "tradingDays", figure: true, render: (row, { locale }) => formatNumber(risk(row).days, "integer", { locale }) },
    { key: "themes", label: "themes", render: (row, ctx) => riskThemes(risk(row), ctx) },
    { key: "warnings", label: "warningsOn", render: (row) => mono(risk(row).warnings_at_start.join(" ")) },
    { key: "primary", label: "primaryTheme", render: (row, { locale }) => primaryThemeName(risk(row), locale) },
    { key: "fwd5", label: "fwd5", figure: true, render: (row) => <DeltaBadge value={risk(row).fwd5} /> },
    { key: "fwd10", label: "fwd10", figure: true, render: (row) => <DeltaBadge value={risk(row).fwd10} /> },
    { key: "fwd20", label: "fwd20", figure: true, render: (row) => <DeltaBadge value={risk(row).fwd20} /> },
    { key: "maxDd10", label: "maxDd10", figure: true, render: (row) => <DeltaBadge value={risk(row).max_dd10} /> },
    { key: "useful", label: "pastMinus5", render: (row, { t }) => t(usefulKey(risk(row).useful)) },
  ],
  surge: [
    { key: "theme", label: "theme", render: (row, { locale }) => surge(row).label[locale] },
    { key: "start", label: "startDate", render: startCell },
    { key: "end", label: "endDate", render: (row) => optional(surge(row).end_date) },
    { key: "reason", label: "endReason", render: (row, { t }) => t(endReasonKey(surge(row))) },
    { key: "shown", label: "bannerShown", render: (row, { t }) => t(surge(row).shown ? "risk.records.shown.yes" : "risk.records.shown.no") },
    { key: "fwd5", label: "fwd5", figure: true, render: (row) => <DeltaBadge value={surge(row).fwd5} /> },
    { key: "fwd10", label: "fwd10", figure: true, render: (row) => <DeltaBadge value={surge(row).fwd10} /> },
    { key: "fwd20", label: "fwd20", figure: true, render: (row) => <DeltaBadge value={surge(row).fwd20} /> },
    { key: "runup", label: "maxRunup10", figure: true, render: (row) => <DeltaBadge value={surge(row).max_runup10} /> },
  ],
  movers: [
    { key: "date", label: "date", render: (row) => mono(row.date) },
    ...RANKS.map((rank): Column => ({ key: `rank${rank}`, label: `rank${rank}`, render: (row) => moverCell(movers(row), rank) })),
  ],
};

interface RecordsTableProps {
  rows: RecordRow[];
  kind: RecordFilterKind;
  selected: { kind: string; id: string } | null;
  hrefFor: (row: RecordRow) => string;
  onSelect: (row: RecordRow) => void;
}

export function RecordsTable({ rows, kind, selected, hrefFor, onSelect }: RecordsTableProps) {
  const t = useT();
  const { locale } = useLocale();
  const ctx: Ctx = { t, locale };
  const columns = COLUMNS[kind];
  return (
    <table data-testid="records-table" aria-label={t("risk.records.table")} className="type-body w-full min-w-max border-collapse text-[var(--ink-secondary)]">
      <thead className="sticky top-0 z-10 bg-[var(--bg)]">
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              className={clsx("type-caption whitespace-nowrap border-b border-[var(--line)] px-3 py-2 uppercase text-[var(--ink-muted)]", col.figure ? "text-right" : "text-left")}
            >
              <BilingualLabel k={col.label} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-3 py-8 text-center text-[var(--ink-muted)]">{t("risk.records.empty")}</td>
          </tr>
        ) : rows.map((row) => {
          const isSelected = selected?.kind === row.kind && selected.id === row.id;
          return (
            <tr
              key={`${row.kind}:${row.id}`}
              data-testid="records-row"
              data-kind={row.kind}
              data-id={row.id}
              data-selected={isSelected}
              onClick={() => onSelect(row)}
              className={clsx(
                "cursor-pointer border-b border-[var(--grid)] transition-colors duration-[var(--duration-normal)]",
                isSelected ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface)]",
              )}
            >
              {columns.map((col, index) => (
                <td key={col.key} className={clsx("whitespace-nowrap px-3 py-2", col.figure && "type-mono text-right text-[var(--ink)]")}>
                  {index === 0 ? (
                    // The first cell is the row's link, so the keyboard reaches every record; the row click does the same.
                    <Link href={hrefFor(row)} aria-current={isSelected ? "true" : undefined} onClick={(event) => event.stopPropagation()} scroll={false}>
                      {col.render(row, ctx)}
                    </Link>
                  ) : col.render(row, ctx)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
