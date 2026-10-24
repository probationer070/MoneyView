import { LABELS, type LabelKey } from "./i18n/labels";
import { en } from "./i18n/messages/en";
import { ko } from "./i18n/messages/ko";
import { translate, type MessageKey } from "./i18n/translate";
import type { MoversDayOut, RiskAlertSummary, SurgeEventOut } from "../../../packages/shared-types";

// The /alerts records table as data (risk UI spec §4), and its CSV. Every value is the API's, unrounded.

export type RecordKind = "risk" | "surge" | "movers";
export type RecordFilterKind = "all" | RecordKind;
export type CsvLocale = "en" | "ko";

/** One table row. `id` is the record's address part (/alerts/<kind>/<id>); `date` is its start day, YYYY-MM-DD. */
export type RecordRow =
  | { kind: "risk"; id: string; date: string; record: RiskAlertSummary }
  | { kind: "surge"; id: string; date: string; record: SurgeEventOut }
  | { kind: "movers"; id: string; date: string; record: MoversDayOut };

export const RANKS = [1, 2, 3, 4, 5] as const;

/** The three API lists as rows, newest first (a tie goes to the larger id). */
export function recordRows(history: RiskAlertSummary[], surge: SurgeEventOut[], movers: MoversDayOut[]): RecordRow[] {
  const rows: RecordRow[] = [
    ...history.map((record) => ({ kind: "risk" as const, id: String(record.id), date: record.start_date, record })),
    ...surge.map((record) => ({ kind: "surge" as const, id: String(record.id), date: record.start_date, record })),
    ...movers.map((record) => ({ kind: "movers" as const, id: record.date, date: record.date, record })),
  ];
  const byId = (a: RecordRow, b: RecordRow) => (a.kind === b.kind && a.kind !== "movers" ? Number(b.id) - Number(a.id) : 0);
  return rows.sort((a, b) => (a.date === b.date ? byId(a, b) : a.date < b.date ? 1 : -1));
}

type Cell = string | number | null;
type Column = { header: (locale: CsvLocale) => string; value: (row: RecordRow, locale: CsvLocale) => Cell };

const CATALOGS = { en, ko };
const msg = (locale: CsvLocale, key: MessageKey) => translate(CATALOGS[locale], key);
const label = (key: LabelKey) => (locale: CsvLocale) => LABELS[key][locale === "ko" ? 0 : 1];
const col = (key: LabelKey, value: Column["value"]): Column => ({ header: label(key), value });

/** Names of the trigger themes in the locale, comma separated; a theme the API sent no label for keeps its id. */
export function riskThemeNames(record: RiskAlertSummary, locale: CsvLocale): string[] {
  return record.trigger_themes.map((id) => record.trigger_labels.find((l) => l.id === id)?.label[locale] ?? id);
}

export function primaryThemeName(record: RiskAlertSummary, locale: CsvLocale): string {
  return record.trigger_labels.find((l) => l.id === record.primary_theme)?.label[locale] ?? record.primary_theme;
}

export function usefulKey(useful: boolean | null): MessageKey {
  return useful === null ? "risk.records.useful.pending" : useful ? "risk.records.useful.yes" : "risk.records.useful.no";
}

export function endReasonKey(record: SurgeEventOut): MessageKey {
  return record.end_reason === null ? "risk.records.endReason.ongoing" : `risk.records.endReason.${record.end_reason}`;
}

/** A movers day has no origin; its cell is empty. */
const originCell = col("origin", (row, locale) => (row.kind === "movers" ? null : msg(locale, `risk.records.origin.${row.record.origin}`)));

function subject(row: RecordRow, locale: CsvLocale): string {
  if (row.kind === "risk") return riskThemeNames(row.record, locale).join(", ");
  if (row.kind === "surge") return row.record.label[locale];
  return row.record.items.map((item) => item.ticker).join(", ");
}

function riskOf(row: RecordRow): RiskAlertSummary {
  return (row as Extract<RecordRow, { kind: "risk" }>).record;
}
function surgeOf(row: RecordRow): SurgeEventOut {
  return (row as Extract<RecordRow, { kind: "surge" }>).record;
}
function moverAt(row: RecordRow, rank: number) {
  return (row as Extract<RecordRow, { kind: "movers" }>).record.items.find((item) => item.rank === rank) ?? null;
}

const COLUMNS: Record<RecordFilterKind, Column[]> = {
  all: [
    col("recordKind", (row, locale) => msg(locale, `risk.records.kind.${row.kind}`)),
    col("recordId", (row) => row.id),
    originCell,
    col("startDate", (row) => row.date),
    col("endDate", (row) => (row.kind === "risk" ? riskOf(row).release_date : row.kind === "surge" ? surgeOf(row).end_date : null)),
    col("subject", subject),
  ],
  risk: [
    col("recordId", (row) => row.id),
    originCell,
    col("startDate", (row) => riskOf(row).start_date),
    col("releaseDate", (row) => riskOf(row).release_date),
    col("tradingDays", (row) => riskOf(row).days),
    col("themeCount", (row) => riskOf(row).theme_count),
    col("themes", (row, locale) => riskThemeNames(riskOf(row), locale).join(", ")),
    col("warningsOn", (row) => riskOf(row).warnings_at_start.join(" ")),
    col("primaryTheme", (row, locale) => primaryThemeName(riskOf(row), locale)),
    col("fwd5", (row) => riskOf(row).fwd5),
    col("fwd10", (row) => riskOf(row).fwd10),
    col("fwd20", (row) => riskOf(row).fwd20),
    col("maxDd10", (row) => riskOf(row).max_dd10),
    col("pastMinus5", (row, locale) => msg(locale, usefulKey(riskOf(row).useful))),
  ],
  surge: [
    col("recordId", (row) => row.id),
    originCell,
    col("theme", (row, locale) => surgeOf(row).label[locale]),
    col("startDate", (row) => surgeOf(row).start_date),
    col("endDate", (row) => surgeOf(row).end_date),
    col("endReason", (row, locale) => msg(locale, endReasonKey(surgeOf(row)))),
    col("bannerShown", (row, locale) => msg(locale, surgeOf(row).shown ? "risk.records.shown.yes" : "risk.records.shown.no")),
    col("fwd5", (row) => surgeOf(row).fwd5),
    col("fwd10", (row) => surgeOf(row).fwd10),
    col("fwd20", (row) => surgeOf(row).fwd20),
    col("maxRunup10", (row) => surgeOf(row).max_runup10),
  ],
  movers: [
    col("date", (row) => row.date),
    ...RANKS.flatMap((rank): Column[] => {
      const rankLabel = label(`rank${rank}`);
      return [
        { header: (l) => `${rankLabel(l)} ${label("ticker")(l)}`, value: (row) => moverAt(row, rank)?.ticker ?? null },
        { header: (l) => `${rankLabel(l)} ${label("name")(l)}`, value: (row) => moverAt(row, rank)?.name ?? null },
        { header: (l) => `${rankLabel(l)} ${label("change")(l)}`, value: (row) => moverAt(row, rank)?.return_pct ?? null },
      ];
    }),
  ],
};

/** RFC 4180: a field holding a comma, quote, CR or LF is quoted, and its quotes are doubled. */
export function csvField(value: Cell): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

/** The rows as CSV: a header line in the locale, then one line per row, CRLF line ends. Numbers are not rounded. */
export function recordsCsv(rows: RecordRow[], kind: RecordFilterKind, locale: CsvLocale): string {
  const columns = COLUMNS[kind];
  const lines = [
    columns.map((c) => csvField(c.header(locale))).join(","),
    ...rows.map((row) => columns.map((c) => csvField(c.value(row, locale))).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** moneyview-signals-<kind>-<from>_<to>.csv */
export function recordsCsvName(kind: RecordFilterKind, from: string, to: string): string {
  return `moneyview-signals-${kind}-${from}_${to}.csv`;
}
