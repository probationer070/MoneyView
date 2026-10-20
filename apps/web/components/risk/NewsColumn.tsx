"use client";

import clsx from "clsx";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { MacroFigureOut, NewsItemOut, RiskAlertDetail } from "../../../../packages/shared-types";

/** Macro items first, grouped by topic in the order the API sent them; industry items after (spec §3.3). */
function newsGroups(news: NewsItemOut[]): { topic: string | null; items: NewsItemOut[] }[] {
  const groups: { topic: string | null; items: NewsItemOut[] }[] = [];
  for (const item of news.filter((n) => n.kind === "macro")) {
    const group = groups.find((g) => g.topic === item.topic);
    if (group) group.items.push(item);
    else groups.push({ topic: item.topic, items: [item] });
  }
  const industry = news.filter((n) => n.kind !== "macro");
  if (industry.length > 0) groups.push({ topic: null, items: industry });
  return groups;
}

function MacroFigure({ figure }: { figure: MacroFigureOut }) {
  const t = useT();
  const { locale } = useLocale();
  const value = (v: number) => (figure.kind === "mm_pct"
    ? formatNumber(v / 100, "percent", { digits: 2, signed: true, locale })
    : formatNumber(v, "price", { locale }));
  const template = t(figure.kind === "mm_pct" ? "risk.news.figureMm" : "risk.news.figureLevel", {
    label: figure.label[locale], period: figure.latest.period, priorPeriod: figure.prior.period,
  });
  return (
    <p data-testid="macro-figure" className="type-small text-[var(--ink)]">
      <FigureText parts={withFigures(template, { latest: value(figure.latest.value), prior: value(figure.prior.value) })} />
    </p>
  );
}

/** The open alert's news (spec §3.3): macro first with its figures, then the shortfall and the reason note. */
export function NewsColumn({ alert, className }: { alert: RiskAlertDetail; className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const groups = newsGroups(alert.news);
  return (
    <div data-testid="news-column" className={clsx("overflow-y-auto", className)}>
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <Eyebrow label="news" />
        {alert.news_shortfall > 0 && (
          <span data-testid="news-shortfall" className="type-small rounded-[var(--radius-2)] bg-[var(--surface)] px-2 text-[var(--ink-muted)]">
            <FigureText parts={withFigures(t("risk.news.shortfall"), { count: formatNumber(alert.news_shortfall, "integer", { locale }) })} />
          </span>
        )}
        {alert.news_note && (
          <span data-testid="news-note" className="type-small text-[var(--ink-muted)]">
            {t(alert.news_note === "before_collection" ? "risk.news.beforeCollection" : "risk.news.feedFailed")}
          </span>
        )}
      </div>
      {groups.length === 0 ? (
        <p className="type-small text-[var(--ink-muted)]">{t("risk.news.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group, index) => {
            const figure = group.topic === null ? undefined : alert.macro_figures.find((f) => f.topic === group.topic);
            return (
              <li key={`${group.topic ?? "industry"}-${index}`} className="space-y-1">
                {figure && <MacroFigure figure={figure} />}
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <li key={item.url} lang={item.lang}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="type-body text-[var(--ink)] hover:text-[var(--brand-text)]"
                      >
                        {item.title}
                      </a>
                      <p className="type-small text-[var(--ink-muted)]">
                        {item.source} · <span className="type-mono">{item.published_date}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
