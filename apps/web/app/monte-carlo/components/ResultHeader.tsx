"use client";

import { BeforeAfter } from "@/components/ui/BeforeAfter";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { beforeText, type RunStatusView } from "../lib/resultModel";
import { ExportMenu, type ExportItem } from "./ExportMenu";

export type ResultFigure = {
  key: string;
  label: string;
  value: number | null;
  format: (n: number) => string;
  hint?: string;
  /** The value before the run. Formatted with this figure's format; null or absent shows no before value. */
  previousValue?: number | null;
  /** Explicit before text, for a figure that is a range. When set it replaces previousValue. */
  previousText?: string | null;
};

type Props = {
  status: RunStatusView;
  figures: ResultFigure[];
  exports: ExportItem[];
  source?: { label: string; openLabel: string; onOpen: () => void };
  prompt?: { text: string; actionLabel: string; onAction: () => void };
};

// Status and export on one line, the key figures below. A prompt (nothing to show yet) replaces the figures.
export function ResultHeader({ status, figures, exports, source, prompt }: Props) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div data-testid="mc-result-header" className="flex shrink-0 flex-col gap-2">
      <div className="flex min-h-[var(--component-button-height-sm)] items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span data-testid="mc-status" data-state={status.state} className="type-label text-[var(--ink)]">
            {t(status.labelKey)}
          </span>
          {status.progress !== null ? (
            <span data-testid="mc-status-progress" className="type-mono text-[var(--ink-muted)]">
              {formatNumber(status.progress, "integer", { locale })}%
            </span>
          ) : null}
          {source ? (
            <span className="truncate type-small text-[var(--ink-muted)]">
              {source.label}{" "}
              <button type="button" data-testid="mc-source-open" onClick={source.onOpen} className="underline">
                {source.openLabel}
              </button>
            </span>
          ) : null}
        </div>
        <ExportMenu items={exports} />
      </div>
      {prompt ? (
        <div className="flex items-center gap-3">
          <p data-testid="mc-run-prompt" className="type-small text-[var(--ink-muted)]">{prompt.text}</p>
          <button type="button" data-testid="mc-run-prompt-open" onClick={prompt.onAction} className="type-small underline">
            {prompt.actionLabel}
          </button>
        </div>
      ) : figures.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
          {figures.map((figure) => (
            <div key={figure.key} data-testid={`mc-figure-${figure.key}`} title={figure.hint} className="min-w-0">
              <div className="truncate type-small text-[var(--ink-muted)]">{figure.label}</div>
              <div className="truncate type-mono-link text-[var(--ink)]">
                <BeforeAfter
                  previous={figure.previousText !== undefined ? figure.previousText : beforeText(figure.previousValue ?? null, figure.value, figure.format)}
                  current={<RollingNumber testId={`mc-figure-${figure.key}-value`} value={figure.value} format={figure.format} enter />}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
