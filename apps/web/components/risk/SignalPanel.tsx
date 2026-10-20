"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ModalShell } from "@/components/ui/ModalShell";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { useRiskAlert, useRiskLatest, useThemeLabels } from "@/lib/useRisk";
import type { LabelOut, RiskLatest } from "../../../../packages/shared-types";
import { CardDeck } from "./CardDeck";
import { CandidateCard, CrashCard, MoverCard, SurgeThemeCard } from "./cards";
import { NewsColumn } from "./NewsColumn";
import { WarningsTable } from "./WarningsTable";

type PanelTab = "crash" | "candidates" | "surge" | "movers";

/** An open alert shows its crash deck first; with no alert, a surge banner shows the surge deck. */
function initialTab(latest: RiskLatest | null): PanelTab {
  if (!latest?.alert && latest?.surge?.banner) return "surge";
  return "crash";
}

/**
 * Risk UI spec §3.1: open the panel once, by itself, the first time a risk alert id or a surge banner
 * start day (`banner_since`) is seen. Seen keys live in localStorage; when it cannot be read or written
 * (private mode), the panel opens on every load. Yesterday's gainers never open it.
 */
export function useSignalAutoOpen(open: () => void) {
  const { data } = useRiskLatest();
  const alertId = data?.alert?.id ?? null;
  const surgeSince = data?.surge?.banner_since ?? null;
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    const keys: string[] = [];
    if (alertId !== null) keys.push(`mv.risk.seen.alert:${alertId}`);
    if (surgeSince !== null) keys.push(`mv.risk.seen.surge:${surgeSince}`);
    let fresh = false;
    for (const key of keys) {
      try {
        if (window.localStorage.getItem(key) === null) {
          fresh = true;
          window.localStorage.setItem(key, "1");
        }
      } catch {
        fresh = true;
      }
    }
    if (fresh) openRef.current();
  }, [alertId, surgeSince]);
}

/**
 * The signal panel over "/" (risk UI spec §3): four decks under shared Tabs on the left, the open alert's
 * news (or, with no alert, the warning indicators) on the right, stacked at narrow widths. ModalShell gives
 * the dialog role, focus trap, Esc and outside-click close; the address never changes.
 */
export function SignalPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const query = useRiskLatest();
  const latest = query.data ?? null;
  const [tab, setTab] = useState<PanelTab>(() => initialTab(latest));

  let body: ReactNode;
  if (query.isError) {
    body = <ErrorState message={t("risk.strip.error")} retryAction={() => void query.refetch()} />;
  } else if (latest === null) {
    body = <div data-testid="signal-panel-loading"><LoadingState label={t("risk.strip.loading")} /></div>;
  } else {
    body = <PanelBody latest={latest} tab={tab} onTab={setTab} />;
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title={t("risk.panel.title")}
      subtitle={latest?.as_of ? t("risk.panel.asOf", { date: latest.as_of }) : undefined}
      size="xl"
    >
      {body}
    </ModalShell>
  );
}

function PanelBody({ latest, tab, onTab }: { latest: RiskLatest; tab: PanelTab; onTab: (tab: PanelTab) => void }) {
  const t = useT();
  const router = useRouter();
  const themeLabel = useThemeLabels();
  const alert = latest.alert;
  // With no open alert, the crash and candidate tabs show the last alert's record (spec §3.2, R-D8).
  const lastQuery = useRiskAlert(alert ? null : latest.last_alert?.id ?? null);
  const record = alert ?? lastQuery.data ?? null;
  const surge = latest.surge;
  const movers = latest.movers?.items ?? [];

  const apiLabels = new Map<string, LabelOut>();
  for (const stint of record?.themes ?? []) apiLabels.set(stint.theme, stint.label);
  for (const theme of surge?.themes ?? []) apiLabels.set(theme.theme, theme.label);
  const themeName = (id: string) => themeLabel(id, apiLabels.get(id));
  const toDetail = (ticker: string) => router.push(`/detail/${encodeURIComponent(ticker)}`);
  const recordHref = record ? `/alerts/risk/${record.id}` : "/alerts";
  // "View records ›" (spec §5): the open alert's report, else the records page.
  const recordsLinkHref = alert ? `/alerts/risk/${alert.id}` : "/alerts";

  const count = (key: Parameters<typeof t>[0], n: number) => t(key, { count: n });
  const tabs = [
    { key: "crash", label: count("risk.panel.tabCrash", record?.crash.total ?? 0) },
    { key: "candidates", label: count("risk.panel.tabCandidates", record?.candidates.total ?? 0) },
    { key: "surge", label: count("risk.panel.tabSurge", surge?.themes.length ?? 0) },
    { key: "movers", label: count("risk.panel.tabMovers", movers.length) },
  ];

  const empty = (key: "risk.panel.empty" | "risk.panel.emptySurge") => <EmptyState title={t(key)} />;
  let deck: ReactNode;
  if (tab === "crash" || tab === "candidates") {
    if (!alert && latest.last_alert && lastQuery.isError) {
      deck = <ErrorState message={t("common.unavailable")} retryAction={() => void lastQuery.refetch()} />;
    } else if (!alert && latest.last_alert && !lastQuery.data) {
      deck = <LoadingState />;
    } else if (!record) {
      deck = empty("risk.panel.empty");
    } else if (tab === "crash") {
      deck = record.crash.cards.length === 0 ? empty("risk.panel.empty") : (
        <CardDeck
          key={`crash-${record.id}`}
          items={record.crash.cards}
          total={record.crash.total}
          render={(card) => <CrashCard card={card} theme={themeName(card.theme)} />}
          onActivate={(card) => toDetail(card.ticker)}
          moreHref={recordHref}
          label={t("risk.panel.crashLabel")}
        />
      );
    } else {
      deck = record.candidates.cards.length === 0 ? empty("risk.panel.empty") : (
        <CardDeck
          key={`candidates-${record.id}`}
          items={record.candidates.cards}
          total={record.candidates.total}
          render={(card) => <CandidateCard card={card} theme={themeName(card.theme)} />}
          onActivate={(card) => toDetail(card.ticker)}
          moreHref={recordHref}
          label={t("risk.panel.candidatesLabel")}
        />
      );
    }
  } else if (tab === "surge") {
    deck = !surge || surge.themes.length === 0 ? empty("risk.panel.emptySurge") : (
      <CardDeck
        key="surge"
        items={surge.themes}
        total={surge.themes.length}
        render={(theme) => <SurgeThemeCard theme={theme} name={themeName(theme.theme)} info={surge.components_info} />}
        onActivate={(theme) => router.push(`/alerts/surge/${theme.event_id}`)}
        moreHref="/alerts"
        label={t("risk.panel.surgeLabel")}
      />
    );
  } else {
    deck = movers.length === 0 ? empty("risk.panel.empty") : (
      <>
        <CardDeck
          key="movers"
          items={movers}
          total={movers.length}
          render={(mover) => <MoverCard mover={mover} theme={themeName(mover.theme)} />}
          onActivate={(mover) => toDetail(mover.ticker)}
          moreHref="/alerts"
          label={t("risk.panel.moversLabel")}
        />
        <p className="type-small text-[var(--ink-muted)]">{t("risk.card.moversNote")}</p>
      </>
    );
  }

  const showsLastAlert = !alert && latest.last_alert !== null && (tab === "crash" || tab === "candidates");
  const column = "absolute inset-0";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div role="tabpanel" id={`signal-panel-${tab}`} aria-labelledby={`signal-tab-${tab}`} className="flex flex-col gap-2">
            {showsLastAlert && latest.last_alert && (
              <p data-testid="last-alert-note" className="type-small text-[var(--ink-muted)]">
                <FigureText parts={withFigures(t("risk.panel.lastAlert"), { date: latest.last_alert.start_date })} />
              </p>
            )}
            {deck}
          </div>
          <Tabs
            items={tabs}
            activeKey={tab}
            onChange={(key) => onTab(key as PanelTab)}
            ariaLabel={t("risk.panel.tabsLabel")}
            idPrefix="signal-"
          />
        </div>
        <div className="relative h-56 min-w-0 md:h-auto md:min-h-72">
          {alert ? <NewsColumn alert={alert} className={column} /> : <WarningsTable warnings={latest.warnings} className={column} />}
        </div>
      </div>
      <div className="flex justify-end">
        <Link href={recordsLinkHref} className="type-label text-[var(--brand-text)] hover:underline">{t("risk.panel.records")}</Link>
      </div>
    </div>
  );
}
