"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { CorporateComparisonRowApi } from "../../corporateTypes";
import { PEER_FIELDS } from "../../detailTabs";
import { peerRank } from "../../peerRank";
import type { CalculationDetailKey } from "../calculationDetailTypes";

// Spec §4 "동종업 비교", part A: rank and spread band inside the comparison already computed.
// Nothing is requested here. Rank 1 is the highest value, not the best one (WACC, for example),
// so the copy states the order instead of judging it. Values are percent units (8 = 8.0%).
export function PeersTab({
  detailKey,
  ticker,
  rows,
}: {
  detailKey: CalculationDetailKey;
  ticker: string;
  rows: readonly CorporateComparisonRowApi[] | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const field = PEER_FIELDS[detailKey];
  if (!field) return null;
  if (!rows) return <EmptyState title={t("corporate.detail.peers.idle")} />;
  const result = peerRank(rows, field, ticker);
  if (result.state === "absent") return <EmptyState title={t("corporate.detail.peers.absent", { ticker })} />;
  if (result.state === "noValue") return <EmptyState title={t("corporate.detail.peers.noValue", { ticker })} />;

  const figure = (percent: number) => formatNumber(percent / 100, "percent", { locale });
  return (
    <div data-testid="peer-position" className="flex flex-col gap-3">
      <p className="type-body text-[var(--ink)]">{t("corporate.detail.peers.rank", { rank: result.rank, count: result.count })}</p>
      <span className="type-mono text-[var(--ink)]">{figure(result.value)}</span>
      {result.count < 2 ? (
        <p className="type-small text-[var(--ink-muted)]">{t("corporate.detail.peers.single", { ticker })}</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={t("corporate.detail.peers.band", { ticker, value: figure(result.value), low: figure(result.min), high: figure(result.max) })}
            className="relative h-2 bg-[var(--grid)]"
          >
            {/* A thin bar at this ticker's place between the low and the high; the band's aria-label carries the figures. */}
            <span
              data-testid="peer-marker"
              aria-hidden="true"
              className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-[var(--brand)]"
              style={{ left: `${(result.position * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="type-caption flex justify-between text-[var(--ink-muted)]">
            <span>
              {t("corporate.detail.peers.low")} <span className="type-mono">{figure(result.min)}</span>
            </span>
            <span>
              {t("corporate.detail.peers.high")} <span className="type-mono">{figure(result.max)}</span>
            </span>
          </div>
        </>
      )}
      <p className="type-small text-[var(--ink-muted)]">{t("corporate.detail.peers.note")}</p>
    </div>
  );
}
