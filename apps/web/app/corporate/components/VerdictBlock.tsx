"use client";

import { Info, TriangleAlert } from "lucide-react";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { UNBRIDGED_REASON } from "@/lib/bridgeQuality";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import { moneyText } from "../corporateUtils";
import { verdictLabelKey, type VerdictView } from "../verdict";

/** The DCF status, translated only (spec D5); an unknown status is shown as sent. */
export function VerdictStatusLabel({ status }: { status: string }) {
  const key = verdictLabelKey(status);
  return (
    <span data-part="label" className="type-caption inline-flex rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-0.5 uppercase text-[var(--ink)]">
      {key ? <BilingualLabel k={key} /> : status}
    </span>
  );
}

interface VerdictProps {
  view: VerdictView;
  onOpenDetail: () => void;
}

// Spec §2.2: intrinsic value vs price and the upside, under the backend's own status label.
export function VerdictBlock({ view, onOpenDetail }: VerdictProps) {
  const t = useT();
  const { state, streaming, intrinsic, upside, enterpriseValue, currentPrice, status, refusalText } = view;

  return (
    <section data-testid="corporate-verdict" data-state={state} data-busy={streaming ? "true" : undefined}>
      <Card padding="sm" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow label="verdict" />
          {streaming && state === "valued" ? (
            <span data-part="busy" className="type-caption mr-auto text-[var(--ink-muted)]">{t("corporate.verdict.streaming")}</span>
          ) : null}
          <button
            type="button"
            onClick={onOpenDetail}
            aria-label={t("corporate.verdict.detail")}
            title={t("corporate.verdict.detail")}
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <Info aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {state === "refused" ? (
          <p data-testid="dcf-refusal" className="type-body text-[var(--ink-secondary)]">
            {t("corporate.verdict.refused", { reason: refusalText ?? "" })}
          </p>
        ) : state === "idle" ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.idle")}</p>
        ) : state === "streaming" ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.streaming")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.intrinsic")}</span>
              <span data-part="intrinsic" className="type-figure-md text-[var(--ink)]" title={intrinsic === null ? UNBRIDGED_REASON : undefined}>
                {intrinsic === null ? MISSING : moneyText(intrinsic)}
              </span>
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.vs")} {t("corporate.verdict.current")}</span>
              <span data-part="price" className="type-mono text-[var(--ink)]">{currentPrice === null ? MISSING : moneyText(currentPrice)}</span>
            </div>
            {intrinsic === null && enterpriseValue !== null ? (
              <span data-part="ev" className="type-small text-[var(--ink-muted)]">
                {t("corporate.verdict.ev", { value: moneyText(enterpriseValue) })}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <DeltaBadge value={upside} />
              <VerdictStatusLabel status={status} />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

/** Cached source data for other tickers: the strip's warning names them and the ticker on screen. */
export interface StaleSource {
  cached: string;
  ticker: string;
}

const STRIP_TEXT = {
  idle: "corporate.verdictStrip.idle",
  streaming: "corporate.verdict.streaming",
  refused: "corporate.verdictStrip.refused",
} as const;

/**
 * Spec §2A: the verdict in one line beside the company line, so every page tab shows the answer.
 * It renders the same VerdictView as the block. Its accessible name comes from its content and must not
 * contain "Verdict detail" (the block's ⓘ, clicked by name in four specs); it reuses none of the
 * block's testids.
 */
export function VerdictStrip({ view, onOpenDetail, staleSource }: VerdictProps & { staleSource: StaleSource | null }) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="corporate-verdict-strip"
      data-state={view.state}
      data-busy={view.streaming && view.state === "valued" ? "true" : undefined}
      onClick={onOpenDetail}
      title={view.state === "refused" ? t("corporate.verdict.refused", { reason: view.refusalText ?? "" }) : undefined}
      className="type-small inline-flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-1)] text-left text-[var(--ink-secondary)] hover:text-[var(--ink)]"
    >
      {view.state === "valued" ? (
        <>
          <span>{t("corporate.verdict.intrinsic")}</span>
          <span data-part="intrinsic" className="type-mono text-[var(--ink)]">{view.intrinsic === null ? MISSING : moneyText(view.intrinsic)}</span>
          <DeltaBadge value={view.upside} />
          <VerdictStatusLabel status={view.status} />
        </>
      ) : (
        <span>{t(STRIP_TEXT[view.state])}</span>
      )}
      {staleSource ? (
        // The cached source data is for other tickers (the Summary's source-data line says the same); the title gives it in full.
        <span data-part="stale" title={t("corporate.assumptions.staleSource", { cached: staleSource.cached, ticker: staleSource.ticker })} className="inline-flex items-center gap-1 text-[var(--status-warning-ink)]">
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{t("corporate.verdictStrip.staleSource")}</span>
        </span>
      ) : null}
    </button>
  );
}
