"use client";

import { GuideSection } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

export const MONTE_CARLO_GUIDE_ID = "monte-carlo-guide";

/**
 * "How to read this screen" for /monte-carlo. Not PageGuide's <details>: a closed summary row would take
 * height the one-screen page does not have at 1280x720. The toggle sits in the tab row (page.tsx) and this
 * body is mounted only while open, laid over the tab panel and scrolling inside itself, so the page never scrolls.
 * No threshold numbers: the engine's limits live in the simulation code and would drift in prose.
 */
export function MonteCarloGuide() {
  const t = useT();
  return (
    <div
      id={MONTE_CARLO_GUIDE_ID}
      data-testid={MONTE_CARLO_GUIDE_ID}
      className="absolute inset-0 z-10 flex flex-col gap-4 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)] p-4"
    >
      <GuideSection title={t("monteCarlo.guide.about.title")}>
        <p>{t("monteCarlo.guide.about.body")}</p>
        <p>{t("monteCarlo.guide.about.run")}</p>
        <p>{t("monteCarlo.guide.about.before")}</p>
      </GuideSection>
      <GuideSection title={t("monteCarlo.guide.path.title")}>
        <p>{t("monteCarlo.guide.path.model")}</p>
        <p>{t("monteCarlo.guide.path.chart")}</p>
        <p>{t("monteCarlo.guide.path.figures")}</p>
        <p>{t("monteCarlo.guide.path.mode")}</p>
      </GuideSection>
      <GuideSection title={t("monteCarlo.guide.risk.title")}>
        <p>{t("monteCarlo.guide.risk.body")}</p>
        <p>{t("monteCarlo.guide.risk.var")}</p>
        <p>{t("monteCarlo.guide.risk.others")}</p>
        <p>{t("monteCarlo.guide.risk.chart")}</p>
      </GuideSection>
      <GuideSection title={t("monteCarlo.guide.distribution.title")}>
        <p>{t("monteCarlo.guide.distribution.figures")}</p>
        <p>{t("monteCarlo.guide.distribution.histogram")}</p>
        <p>{t("monteCarlo.guide.distribution.cdf")}</p>
        <p>{t("monteCarlo.guide.distribution.kurtosis")}</p>
      </GuideSection>
      <GuideSection title={t("monteCarlo.guide.valuation.title")}>
        <p>{t("monteCarlo.guide.valuation.model")}</p>
        <p>{t("monteCarlo.guide.valuation.random")}</p>
        <p>{t("monteCarlo.guide.valuation.figures")}</p>
        <p>{t("monteCarlo.guide.valuation.price")}</p>
        <p>{t("monteCarlo.guide.valuation.other")}</p>
      </GuideSection>
      <GuideSection title={t("monteCarlo.guide.correlation.title")}>
        <p>{t("monteCarlo.guide.correlation.model")}</p>
        <p>{t("monteCarlo.guide.correlation.figures")}</p>
        <p>{t("monteCarlo.guide.correlation.sensitivity")}</p>
      </GuideSection>
      <GuideSection title={t("monteCarlo.guide.state.title")}>
        <p>{t("monteCarlo.guide.state.body")}</p>
        <p>{t("monteCarlo.guide.state.warnings")}</p>
      </GuideSection>
    </div>
  );
}
