"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { COMPONENT_VALUE } from "@/components/risk/cards";
import { NewsColumn } from "@/components/risk/NewsColumn";
import { ThemeLevelChart } from "@/components/risk/ThemeLevelChart";
import { warningValue } from "@/components/risk/WarningsTable";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatNumber, MISSING } from "@/lib/format";
import type { LabelKey } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/lib/i18n/locale";
import { endReasonKey, type RecordRow } from "@/lib/recordsCsv";
import { useRiskAlert, useRiskLatest, useSurgeEvent, useThemeLabels } from "@/lib/useRisk";
import type {
  MoversDayOut, RiskAlertDetail, RiskAlertSummary, SurgeEventDetailOut, SurgeEventOut, ThemeStintOut,
} from "../../../../packages/shared-types";

// The record reports on /alerts/[kind]/[id] (risk UI spec §4 "오른쪽 상세"). Every figure is the API's; the one
// thing derived here is the summary sentence's count against −5%, which follows the API's own `useful` rule.

/** core_finance risk_signals/decks.py `_USEFUL_DD_PCT`: a max further drop of −5% or deeper counts. */
const BEYOND_PCT = -5;

const mono = (text: string) => <span className="type-mono">{text}</span>;
const delta = (value: number | null) => <DeltaBadge value={value} />;

function Section({ name, title, children }: { name: string; title?: string; children: ReactNode }) {
  return (
    <section data-section={name} aria-label={title}>
      {title && <h3 className="type-label mb-2 text-[var(--ink)]">{title}</h3>}
      {children}
    </section>
  );
}

/** A small report table; `figures` marks the right-aligned number columns by index. */
function ReportTable({ columns, rows, figures = [] }: { columns: LabelKey[]; rows: ReactNode[][]; figures?: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="type-small w-full border-collapse text-[var(--ink-secondary)]">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={clsx(
                  "type-caption whitespace-nowrap border-b border-[var(--line)] px-2 py-1 uppercase text-[var(--ink-muted)]",
                  figures.includes(index) ? "text-right" : "text-left",
                )}
              >
                <BilingualLabel k={column} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--grid)]">
              {cells.map((cell, index) => (
                <td key={index} className={clsx("whitespace-nowrap px-2 py-1", figures.includes(index) && "text-right")}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Header({ row, period, rules, backfill, extra }: { row: RecordRow; period?: ReactNode; rules?: string; backfill?: boolean; extra?: string }) {
  const t = useT();
  return (
    <header data-section="header">
      <h2 className="type-panel-title text-[var(--ink)]">
        <FigureText parts={withFigures(t("risk.records.selected", { kind: t(`risk.records.kind.${row.kind}`) }), { id: row.id })} />
      </h2>
      <p className="type-small mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--ink-muted)]">
        {extra && <span className="text-[var(--ink)]">{extra}</span>}
        {period}
        {rules && <span><FigureText parts={withFigures(t("risk.report.rules"), { version: rules })} /></span>}
        {backfill && (
          <span className="rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface)] px-1 text-[var(--ink-secondary)]">
            {t("risk.records.origin.backfill")}
          </span>
        )}
      </p>
    </header>
  );
}

function Period({ start, end }: { start: string; end: string | null }) {
  const t = useT();
  const template = end === null ? t("risk.report.period", { end: t("risk.report.ongoing") }) : t("risk.report.period");
  return <span><FigureText parts={withFigures(template, end === null ? { start } : { start, end })} /></span>;
}

/** Loading and error for a report's detail call; children render once it has data. */
function Detail<T>({ query, children }: { query: { data?: T; isError: boolean; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  const t = useT();
  if (query.isError) return <ErrorState message={t("risk.report.loadError")} retryAction={() => void query.refetch()} />;
  if (query.data === undefined) return <LoadingState variant="spinner" label={t("risk.report.loading")} />;
  return <>{children(query.data)}</>;
}

interface Summary { n: number; k: number; deepest: ThemeStintOut | null }

/** Each theme counted once (its first stint, as the API's `useful` does); null while no theme has a 10-day result. */
export function summaryOf(themes: ThemeStintOut[]): Summary | null {
  const first = themes.filter((stint, index) => themes.findIndex((other) => other.theme === stint.theme) === index);
  const known = first.filter((stint) => stint.max_dd10 !== null);
  if (known.length === 0) return null;
  const beyond = known.filter((stint) => (stint.max_dd10 as number) <= BEYOND_PCT);
  const deepest = beyond.reduce<ThemeStintOut | null>((low, stint) => (low === null || (stint.max_dd10 as number) < (low.max_dd10 as number) ? stint : low), null);
  return { n: known.length, k: beyond.length, deepest };
}

function SummarySentence({ themes }: { themes: ThemeStintOut[] }) {
  const t = useT();
  const { locale } = useLocale();
  const name = useThemeLabels();
  const summary = summaryOf(themes);
  if (summary === null) return <p className="type-body text-[var(--ink)]">{t("risk.report.summaryPending")}</p>;
  const counts = { n: formatNumber(summary.n, "integer", { locale }), k: formatNumber(summary.k, "integer", { locale }) };
  if (summary.deepest === null) {
    return <p className="type-body text-[var(--ink)]"><FigureText parts={withFigures(t("risk.report.summaryNone"), counts)} /></p>;
  }
  const value = formatNumber((summary.deepest.max_dd10 as number) / 100, "percent", { signed: true, locale });
  const template = t("risk.report.summary", { theme: name(summary.deepest.theme, summary.deepest.label) });
  return (
    <p className="type-body text-[var(--ink)]">
      <FigureText parts={withFigures(template, { ...counts, value })} nodes={{ [value]: delta(summary.deepest.max_dd10) }} />
    </p>
  );
}

function RiskBody({ detail }: { detail: RiskAlertDetail }) {
  const t = useT();
  const { locale } = useLocale();
  const name = useThemeLabels();
  const latest = useRiskLatest();
  const warning = (id: string) => latest.data?.warnings.find((w) => w.id === id);
  // Card themes are named as the panel names them: the watchlist first, then the alert's own stint labels (^SOX).
  const themeName = (id: string) => name(id, detail.themes.find((stint) => stint.theme === id)?.label);
  const cardName = (ticker: string) =>
    [...detail.crash.cards, ...detail.candidates.cards].find((card) => card.ticker === ticker)?.name ?? MISSING;
  const snapshot = [
    ...detail.start_snapshot.crash.map((card) => ({ deck: t("risk.report.crash"), card })),
    ...detail.start_snapshot.candidates.map((card) => ({ deck: t("risk.report.candidates"), card })),
  ];
  return (
    <>
      <Section name="warnings" title={t("risk.report.warnings")}>
        <ReportTable
          columns={["warning", "status", "value"]}
          figures={[2]}
          rows={detail.warnings_at_start.map((w) => {
            const known = warning(w.id);
            return [
              known ? known.label[locale] : w.id,
              t(`risk.warnings.${w.state}`),
              // Without /latest's unit the value cannot be read correctly, so it is not shown bare.
              mono(known ? warningValue({ value: w.value, unit: known.unit }, locale) : MISSING),
            ];
          })}
        />
      </Section>
      <Section name="themes" title={t("risk.report.themes")}>
        <ReportTable
          columns={["theme", "via", "joinedDate", "dd20AtJoin", "fwd5", "fwd10", "fwd20", "maxDd10", "leftDate"]}
          figures={[3, 4, 5, 6, 7]}
          rows={detail.themes.map((stint) => [
            <span key="name" className="text-[var(--ink)]">{name(stint.theme, stint.label)}</span>,
            t(`risk.report.via.${stint.via}`),
            mono(stint.joined_date),
            delta(stint.dd20_at_join),
            delta(stint.fwd5),
            delta(stint.fwd10),
            delta(stint.fwd20),
            delta(stint.max_dd10),
            mono(stint.left_date ?? MISSING),
          ])}
        />
      </Section>
      <Section name="summary">
        <SummarySentence themes={detail.themes} />
      </Section>
      <Section name="current" title={t("risk.report.currentCards")}>
        <p className="type-small mb-2 text-[var(--ink-muted)]">
          <FigureText parts={withFigures(t("risk.report.asOf"), { date: detail.crash.as_of ?? MISSING })} />
        </p>
        {detail.crash.cards.length + detail.candidates.cards.length === 0 ? (
          <p className="type-small text-[var(--ink-muted)]">{t("risk.report.currentEmpty")}</p>
        ) : (
          <div className="space-y-3">
            <div data-deck="crash">
              <ReportTable
                columns={["deck", "ticker", "name", "theme", "fromHigh20", "highDate"]}
                figures={[4]}
                rows={detail.crash.cards.map((card) => [
                  t("risk.report.crash"), mono(card.ticker), card.name, themeName(card.theme), delta(card.drawdown_pct), mono(card.high_date ?? MISSING),
                ])}
              />
            </div>
            <div data-deck="candidates">
              <ReportTable
                columns={["deck", "ticker", "name", "theme", "fromHigh63", "corr"]}
                figures={[4, 5]}
                rows={detail.candidates.cards.map((card) => [
                  t("risk.report.candidates"),
                  mono(card.ticker),
                  card.name,
                  themeName(card.theme),
                  delta(card.pct_from_high63),
                  <span key="corr">
                    {card.corr_with_name ?? card.corr_with ?? MISSING} {mono(formatNumber(card.corr, "ratio", { locale }))}
                  </span>,
                ])}
              />
            </div>
          </div>
        )}
      </Section>
      <Section name="snapshot" title={t("risk.report.snapshot")}>
        {snapshot.length === 0 ? (
          <p className="type-small text-[var(--ink-muted)]">{t("risk.report.snapshotEmpty")}</p>
        ) : (
          <ReportTable
            columns={["deck", "ticker", "name", "fwd5", "fwd10", "fwd20"]}
            figures={[3, 4, 5]}
            rows={snapshot.map(({ deck, card }) => [
              deck, mono(card.ticker), cardName(card.ticker), delta(card.fwd5), delta(card.fwd10), delta(card.fwd20),
            ])}
          />
        )}
      </Section>
      <Section name="news">
        <NewsColumn alert={detail} />
      </Section>
    </>
  );
}

function RiskReport({ row, summary }: { row: RecordRow; summary: RiskAlertSummary }) {
  const detail = useRiskAlert(summary.id, { all: true });
  const primary = summary.trigger_labels.find((label) => label.id === summary.primary_theme)?.label;
  return (
    <>
      <Header row={row} period={<Period start={summary.start_date} end={summary.release_date} />} rules={summary.rules_version} backfill={summary.origin === "backfill"} />
      <ThemeLevelChart theme={summary.primary_theme} label={primary} start={summary.start_date} end={summary.release_date} tone="risk" />
      <Detail query={detail}>{(data) => <RiskBody detail={data} />}</Detail>
    </>
  );
}

function SurgeBody({ detail }: { detail: SurgeEventDetailOut }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <>
      <Section name="components" title={t("risk.report.components")}>
        <ReportTable
          columns={["factor", "value", "rule"]}
          figures={[1]}
          rows={detail.components_info.map((info) => [
            info.label[locale], mono(COMPONENT_VALUE[info.id](detail.components, locale)), info.rule[locale],
          ])}
        />
      </Section>
      <Section name="overheated">
        <p className="type-body text-[var(--ink)]">
          {detail.overheated_on === null
            ? t("risk.report.notOverheated")
            : <FigureText parts={withFigures(t("risk.report.overheatedOn"), { date: detail.overheated_on })} />}
        </p>
      </Section>
      <Section name="after" title={t("risk.report.after")}>
        <ReportTable
          columns={["fwd5", "fwd10", "fwd20", "maxRunup10"]}
          figures={[0, 1, 2, 3]}
          rows={[[delta(detail.fwd5), delta(detail.fwd10), delta(detail.fwd20), delta(detail.max_runup10)]]}
        />
      </Section>
      <Section name="leaders" title={t("risk.report.leaders")}>
        <ReportTable
          columns={["ticker", "name", "change5d"]}
          figures={[2]}
          rows={detail.leaders.slice(0, 5).map((leader) => [mono(leader.ticker), leader.name, delta(leader.return5_pct)])}
        />
      </Section>
      <Section name="end" title={t("risk.report.endReason")}>
        <p className="type-body text-[var(--ink)]">{t(endReasonKey(detail))}</p>
      </Section>
    </>
  );
}

function SurgeReport({ row, event }: { row: RecordRow; event: SurgeEventOut }) {
  const { locale } = useLocale();
  const detail = useSurgeEvent(event.id);
  return (
    <>
      <Header
        row={row}
        extra={event.label[locale]}
        period={<Period start={event.start_date} end={event.end_date} />}
        rules={event.rules_version}
        backfill={event.origin === "backfill"}
      />
      <ThemeLevelChart theme={event.theme} label={event.label} start={event.start_date} end={event.end_date} tone="surge" />
      <Detail query={detail}>{(data) => <SurgeBody detail={data} />}</Detail>
    </>
  );
}

function MoversReport({ row, day }: { row: RecordRow; day: MoversDayOut }) {
  const t = useT();
  const { locale } = useLocale();
  const name = useThemeLabels();
  const items = [...day.items].sort((a, b) => a.rank - b.rank).slice(0, 5);
  return (
    <>
      <Header row={row} />
      <Section name="movers" title={t("risk.report.movers")}>
        <ReportTable
          columns={["rank", "ticker", "name", "theme", "change1d", "change5d", "rsi"]}
          figures={[0, 4, 5, 6]}
          rows={items.map((item) => [
            mono(formatNumber(item.rank, "integer", { locale })),
            mono(item.ticker),
            item.name,
            name(item.theme),
            delta(item.return_pct),
            delta(item.return5_pct),
            mono(formatNumber(item.rsi, "ratio", { digits: 1, locale })),
          ])}
        />
      </Section>
    </>
  );
}

/** The report for one records-table row: a risk alert, a surge event or a movers day. */
export function RecordReport({ row }: { row: RecordRow }) {
  return (
    <div className="space-y-4">
      {row.kind === "risk" && <RiskReport row={row} summary={row.record} />}
      {row.kind === "surge" && <SurgeReport row={row} event={row.record} />}
      {row.kind === "movers" && <MoversReport row={row} day={row.record} />}
    </div>
  );
}
