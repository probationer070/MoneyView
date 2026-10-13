"use client";

import { Info } from "lucide-react";
import type { DcfSummary } from "../../../../../packages/shared-types";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { bridgedEstimatedValue, bridgedUpsidePct, UNBRIDGED_REASON } from "@/lib/bridgeQuality";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import { moneyText } from "../corporateUtils";
import { verdictLabelKey } from "../verdict";

/** The DCF status, translated only (spec D5); an unknown status is shown as sent. */
export function VerdictStatusLabel({ status }: { status: string }) {
  const key = verdictLabelKey(status);
  return (
    <span data-part="label" className="type-caption inline-flex rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-0.5 uppercase text-[var(--ink)]">
      {key ? <BilingualLabel k={key} /> : status}
    </span>
  );
}

interface VerdictBlockProps {
  dcf: DcfSummary | null;
  streaming: boolean;
  refusalText: string | null;
  onOpenDetail: () => void;
}

// Spec §2.2: intrinsic value vs price and the upside, under the backend's own status label.
export function VerdictBlock({ dcf, streaming, refusalText, onOpenDetail }: VerdictBlockProps) {
  const t = useT();
  const state = refusalText !== null ? "refused" : dcf ? "valued" : streaming ? "streaming" : "idle";
  const intrinsic = dcf ? bridgedEstimatedValue(dcf) : null;
  const upside = dcf ? bridgedUpsidePct(dcf) : null;
  // A value restored from an older session cache can lack enterprise_value.
  const enterpriseValue = dcf && typeof dcf.enterprise_value === "number" ? dcf.enterprise_value : null;

  return (
    <section data-testid="corporate-verdict" data-state={state} data-busy={streaming ? "true" : undefined}>
      <Card padding="sm" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow label="verdict" />
          {streaming && dcf ? (
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
        ) : state === "streaming" || !dcf ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.streaming")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.intrinsic")}</span>
              <span data-part="intrinsic" className="type-figure-md text-[var(--ink)]" title={intrinsic === null ? UNBRIDGED_REASON : undefined}>
                {intrinsic === null ? MISSING : moneyText(intrinsic)}
              </span>
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.vs")} {t("corporate.verdict.current")}</span>
              <span data-part="price" className="type-mono text-[var(--ink)]">{moneyText(dcf.current_price)}</span>
            </div>
            {intrinsic === null && enterpriseValue !== null ? (
              <span data-part="ev" className="type-small text-[var(--ink-muted)]">
                {t("corporate.verdict.ev", { value: moneyText(enterpriseValue) })}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <DeltaBadge value={upside} />
              <VerdictStatusLabel status={dcf.status} />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
