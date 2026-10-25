"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { clockTime } from "@/lib/detail/clockTime";
import { useFindNews, useMoveExplanation } from "@/lib/detail/useDetail";
import type { MoveAlert, MovePeer } from "@/lib/detail/types";

const MAX_PEERS = 6;

/** At most six peers: the three weakest and the three strongest of the ascending list, and how many are left out. */
function visiblePeers(peers: MovePeer[]): { shown: MovePeer[]; hidden: number } {
  if (peers.length <= MAX_PEERS) return { shown: peers, hidden: 0 };
  const half = MAX_PEERS / 2;
  return { shown: [...peers.slice(0, half), ...peers.slice(-half)], hidden: peers.length - MAX_PEERS };
}

function Figure({ id, label, value }: { id: string; label: string; value: number | null }) {
  return (
    <div data-testid={id} className="flex min-w-0 flex-col gap-1">
      <span className="type-caption truncate text-[var(--ink-muted)]">{label}</span>
      <DeltaBadge value={value} className="self-start" />
    </div>
  );
}

function alertKey(alert: MoveAlert) {
  const role = alert.role === "start" ? "Start" : alert.role === "end" ? "End" : "Ongoing";
  return `detail.card.alert.${alert.kind}${role}` as "detail.card.alert.riskStart";
}

/** The "why it moved" card for one marked day: returns side by side, peers, events, alerts and the news count with its find-news flow. */
export function MoveCard({ ticker, date, onClose }: { ticker: string; date: string; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const move = useMoveExplanation(ticker, date);
  const find = useFindNews(ticker);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = move.data;
  const peers = data ? visiblePeers(data.peers) : { shown: [], hidden: 0 };
  const noStored = data?.news?.stored === 0;
  const searchFailed = find.isError || find.data?.status === "failed";
  const blocked = find.data?.status === "blocked" || find.data?.status === "daily_limit";
  const retryTime = clockTime(find.data?.retry_after ?? null, locale);

  return (
    <section data-testid="move-card" aria-label={t("detail.card.title")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="type-panel-title text-[var(--ink)]">
          {t("detail.card.title")} <span data-testid="move-card-date" className="type-mono">{date}</span>
        </h2>
        <button type="button" onClick={onClose} aria-label={t("detail.card.close")} className="type-mono px-2 text-[var(--ink-muted)] hover:text-[var(--ink)]">×</button>
      </div>
      {move.isError ? (
        <p className="type-small text-[var(--ink-muted)]">{t("detail.card.loadError")}</p>
      ) : !data ? (
        <p className="type-small text-[var(--ink-muted)]">{t("detail.card.loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Figure id="card-stock" label={ticker} value={data.return_pct} />
            <Figure id="card-market" label={t("detail.card.market")} value={data.market?.return_pct ?? null} />
            <Figure id="card-theme" label={data.theme?.label[locale] ?? t("detail.card.themeFallback")} value={data.theme?.return_pct ?? null} />
          </div>
          {data.peers.length > 0 && (
            <ul data-testid="card-peers" aria-label={t("detail.card.peers")} className="flex flex-wrap items-center gap-1">
              {peers.shown.map((peer) => (
                <li key={peer.ticker}>
                  <Link href={`/detail/${encodeURIComponent(peer.ticker)}`} className="type-mono inline-flex gap-1 rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-0.5 text-[var(--ink)]">
                    {peer.ticker}
                    <span className={peer.return_pct > 0 ? "text-[var(--up)]" : peer.return_pct < 0 ? "text-[var(--down)]" : "text-[var(--flat)]"}>
                      {formatNumber(peer.return_pct / 100, "percent", { signed: true, locale })}
                    </span>
                  </Link>
                </li>
              ))}
              {peers.hidden > 0 && <li data-testid="card-peers-more" className="type-mono text-[var(--ink-muted)]">{t("detail.card.morePeers", { count: peers.hidden })}</li>}
            </ul>
          )}
          <p data-testid="card-events" className="type-small text-[var(--ink)]">
            <span className="text-[var(--ink-muted)]">{t("detail.card.events")}: </span>
            {data.events.length === 0 ? t("detail.card.noEvents") : data.events.map((event) => event.title).join(" · ")}
          </p>
          <p data-testid="card-alerts" className="type-small text-[var(--ink)]">
            <span className="text-[var(--ink-muted)]">{t("detail.card.alerts")}: </span>
            {data.alerts.length === 0 ? t("detail.card.noAlerts") : data.alerts.map((alert) => t(alertKey(alert))).join(" · ")}
          </p>
          {data.news && (
            <div data-testid="card-news" className="flex flex-wrap items-center gap-3 type-small text-[var(--ink)]">
              <span>{t("detail.card.news", { count: formatNumber(data.news.stored, "integer", { locale }) })}</span>
              {noStored && data.news.searched && <span data-testid="no-news-found">{t("detail.noNewsFound")}</span>}
              {noStored && !data.news.searched && find.isPending && <span data-testid="find-news-pending">{t("detail.findNewsPending")}</span>}
              {noStored && !data.news.searched && !find.isPending && (
                <ActionButton size="sm" label={t("detail.findNews")} onClick={() => find.mutate(date)} />
              )}
              {searchFailed && <span data-testid="find-news-failed">{t("detail.findNewsFailed")}</span>}
              {blocked && <span data-testid="find-news-blocked">{retryTime === "" ? t("detail.findNewsBlockedNoTime") : t("detail.findNewsBlocked", { time: retryTime })}</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
