"use client";

import { GuideSection } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

export const ALERTS_GUIDE_ID = "alerts-guide";

/**
 * "How to read this screen" for /alerts. Not PageGuide's <details>: a closed summary row would take height the
 * one-screen page does not have at 1280x720. The toggle sits in the filter row (page.tsx) and this body is mounted
 * only while open, laid over the table and report and scrolling inside itself, so the page never scrolls.
 * No threshold numbers: the rules live in apps/api/services/risk/rules.yaml, and the table headers show the ones a reader needs.
 */
export function AlertsGuide() {
  const t = useT();
  return (
    <div
      id={ALERTS_GUIDE_ID}
      data-testid={ALERTS_GUIDE_ID}
      className="absolute inset-0 z-10 flex flex-col gap-4 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)] p-4"
    >
      <GuideSection title={t("alerts.guide.about.title")}>
        <p>{t("alerts.guide.about.body")}</p>
        <p>{t("alerts.guide.about.notAdvice")}</p>
      </GuideSection>
      <GuideSection title={t("alerts.guide.filters.title")}>
        <p>{t("alerts.guide.filters.kind")}</p>
        <p>{t("alerts.guide.filters.dates")}</p>
        <p>{t("alerts.guide.filters.shown")}</p>
        <p>{t("alerts.guide.filters.csv")}</p>
        <p>{t("alerts.guide.filters.address")}</p>
      </GuideSection>
      <GuideSection title={t("alerts.guide.risk.title")}>
        <p>{t("alerts.guide.risk.start")}</p>
        <p>{t("alerts.guide.risk.warnings")}</p>
        <p>{t("alerts.guide.risk.columns")}</p>
        <p>{t("alerts.guide.risk.outcome")}</p>
      </GuideSection>
      <GuideSection title={t("alerts.guide.surge.title")}>
        <p>{t("alerts.guide.surge.start")}</p>
        <p>{t("alerts.guide.surge.end")}</p>
        <p>{t("alerts.guide.surge.columns")}</p>
        <p>{t("alerts.guide.surge.overheated")}</p>
      </GuideSection>
      <GuideSection title={t("alerts.guide.movers.title")}>
        <p>{t("alerts.guide.movers.body")}</p>
      </GuideSection>
      <GuideSection title={t("alerts.guide.origin.title")}>
        <p>{t("alerts.guide.origin.backfill")}</p>
        <p>{t("alerts.guide.origin.report")}</p>
      </GuideSection>
    </div>
  );
}
