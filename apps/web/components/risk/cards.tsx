"use client";

import type { ReactNode } from "react";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type {
  CandidateCardOut, CrashCardOut, MoverOut, SurgeComponentInfoOut, SurgeComponentsOut, SurgeThemeOut,
} from "../../../../packages/shared-types";

// The four card bodies of risk UI spec §3.2. They render inside CardDeck's card button, so they hold no links
// or buttons of their own. Every value is the API's; `theme` is the theme's display name, resolved by the caller.

function CardHead({ ticker, name, theme }: { ticker: string; name: string; theme: string }) {
  return (
    <div className="min-w-0">
      <p className="flex min-w-0 items-baseline gap-2">
        <span className="type-mono shrink-0 text-[var(--ink)]">{ticker}</span>
        <span className="type-label truncate text-[var(--ink)]">{name}</span>
      </p>
      <p className="type-small truncate text-[var(--ink-muted)]">{theme}</p>
    </div>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-2">
      <span className="type-small text-[var(--ink-muted)]">{label}</span>
      {children}
    </p>
  );
}

function Sentence({ template, figures }: { template: string; figures: Record<string, string> }) {
  return <FigureText parts={withFigures(template, figures)} />;
}

export function CrashCard({ card, theme }: { card: CrashCardOut; theme: string }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col gap-2">
      <CardHead ticker={card.ticker} name={card.name} theme={theme} />
      <Figure label={t("risk.card.fromHigh20")}><DeltaBadge value={card.drawdown_pct} /></Figure>
      <p className="type-small text-[var(--ink-muted)]">
        <Sentence template={t("risk.card.highDate")} figures={{ date: card.high_date ?? MISSING }} />
      </p>
      <Sparkline data={card.closes_30d} height={48} />
      <ul className="min-h-0 space-y-1">
        {card.headlines.slice(0, 2).map((headline, index) => (
          <li key={`${index}-${headline.url}`} lang={headline.lang} className="type-small truncate text-[var(--ink-secondary)]">{headline.title}</li>
        ))}
      </ul>
    </div>
  );
}

export function CandidateCard({ card, theme }: { card: CandidateCardOut; theme: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex h-full flex-col gap-2">
      <CardHead ticker={card.ticker} name={card.name} theme={theme} />
      <Figure label={t("risk.card.fromHigh63")}><DeltaBadge value={card.pct_from_high63} /></Figure>
      <p className="type-small text-[var(--ink-secondary)]">
        <Sentence
          template={t("risk.card.corrWith", { name: card.corr_with_name ?? card.corr_with ?? MISSING })}
          figures={{ value: formatNumber(card.corr, "ratio", { locale }) }}
        />
      </p>
    </div>
  );
}

/** The four surge components in spec order: size z, slope quantile, breadth %, RSI. */
export const COMPONENT_VALUE: Record<SurgeComponentInfoOut["id"], (c: SurgeComponentsOut, locale: "en" | "ko") => string> = {
  magnitude: (c, locale) => formatNumber(c.magnitude_z, "ratio", { locale }),
  accel: (c, locale) => formatNumber(c.accel_rank, "ratio", { locale }),
  breadth: (c, locale) => formatNumber(c.breadth_pct === null ? null : c.breadth_pct / 100, "percent", { locale }),
  rsi: (c, locale) => formatNumber(c.rsi, "ratio", { digits: 1, locale }),
};

export function SurgeThemeCard({ theme, name, info }: { theme: SurgeThemeOut; name: string; info: SurgeComponentInfoOut[] }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex h-full flex-col gap-1">
      <p className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="type-label truncate text-[var(--ink)]">{name}</span>
        {theme.overheated && (
          <span data-part="overheated" className="type-small shrink-0 rounded-[var(--radius-2)] bg-[var(--up-soft)] px-2 text-[var(--up)]">
            {t("risk.card.overheated")}
          </span>
        )}
      </p>
      <p className="type-small text-[var(--ink-muted)]">
        <Sentence template={t("risk.card.started")} figures={{ date: theme.start_date }} />
      </p>
      <dl data-part="components" className="grid grid-cols-2 gap-x-3">
        {info.map((component) => (
          <div key={component.id} className="flex items-baseline justify-between gap-2">
            <dt className="type-small truncate text-[var(--ink-muted)]">{component.label[locale]}</dt>
            <dd className="type-mono text-[var(--ink)]">{COMPONENT_VALUE[component.id](theme.components, locale)}</dd>
          </div>
        ))}
      </dl>
      <p className="type-small mt-1 text-[var(--ink-muted)]">{t("risk.card.leaders")}</p>
      <ul className="min-h-0">
        {theme.leaders.slice(0, 5).map((leader) => (
          <li key={leader.ticker} data-part="leader" className="flex min-w-0 items-center gap-2">
            <span className="type-mono shrink-0 text-[var(--ink)]">{leader.ticker}</span>
            <span className="type-small min-w-0 flex-1 truncate text-[var(--ink-secondary)]">{leader.name}</span>
            <DeltaBadge value={leader.return5_pct} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MoverCard({ mover, theme }: { mover: MoverOut; theme: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-w-0 items-start gap-3">
        <span className="type-figure-md shrink-0 text-[var(--ink)]">{formatNumber(mover.rank, "integer", { locale })}</span>
        <CardHead ticker={mover.ticker} name={mover.name} theme={theme} />
      </div>
      <Figure label={t("risk.card.day1")}><DeltaBadge value={mover.return_pct} /></Figure>
      <Figure label={t("risk.card.day5")}><DeltaBadge value={mover.return5_pct} /></Figure>
      <p className="type-small text-[var(--ink-secondary)]">
        <Sentence template={t("risk.card.rsi")} figures={{ value: formatNumber(mover.rsi, "ratio", { digits: 1, locale }) }} />
      </p>
    </div>
  );
}
