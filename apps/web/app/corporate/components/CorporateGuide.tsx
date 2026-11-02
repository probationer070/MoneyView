"use client";

import { GuideSection } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";
import type { PageTabKey } from "../pageTabs";

export const CORPORATE_GUIDE_ID = "corporate-guide";

/**
 * "How to read this screen" for one corporate tab (spec 2026-11-02-corporate-explainers-plan §4, P1).
 * Not PageGuide's <details>: its closed summary row would take height the Summary tab does not have at
 * 1280x720. The toggle sits in the tab row (CorporatePageTabs) and this body is mounted only while open,
 * at the top of the panel, which scrolls inside itself.
 */
export function CorporateGuide({ tab }: { tab: PageTabKey }) {
  const t = useT();
  return (
    <div
      id={CORPORATE_GUIDE_ID}
      data-testid={`corporate-guide-${tab}`}
      className="mb-3 flex flex-col gap-4 border border-[var(--line)] bg-[var(--surface-raised)] p-4"
    >
      {SECTIONS[tab](t)}
    </div>
  );
}

type T = ReturnType<typeof useT>;

const SECTIONS: Record<PageTabKey, (t: T) => React.ReactNode> = {
  summary: (t) => (
    <>
      <GuideSection title={t("corporate.guide.summary.aboutTitle")}><p>{t("corporate.guide.summary.aboutBody")}</p></GuideSection>
      <GuideSection title={t("corporate.guide.summary.verdictTitle")}><p>{t("corporate.guide.summary.verdictBody")}</p></GuideSection>
      <GuideSection title={t("corporate.guide.summary.kpiTitle")}>
        <p>{t("corporate.guide.summary.kpiSpread")}</p>
        <p>{t("corporate.guide.summary.kpiKe")}</p>
        <p>{t("corporate.guide.summary.kpiWacc")}</p>
        <p>{t("corporate.guide.summary.kpiBeta")}</p>
      </GuideSection>
      <GuideSection title={t("corporate.guide.summary.hurdleTitle")}>
        <p>{t("corporate.guide.summary.hurdleRoic")}</p>
        <p>{t("corporate.guide.summary.hurdleImplied")}</p>
        <p>{t("corporate.guide.summary.hurdleKe")}</p>
        <p>{t("corporate.guide.summary.hurdleNote")}</p>
      </GuideSection>
      <GuideSection title={t("corporate.guide.summary.assumptionsTitle")}><p>{t("corporate.guide.summary.assumptionsBody")}</p></GuideSection>
    </>
  ),
  diagnostics: (t) => (
    <>
      <GuideSection title={t("corporate.guide.diagnostics.aboutTitle")}><p>{t("corporate.guide.diagnostics.aboutBody")}</p></GuideSection>
      <GuideSection title={t("corporate.guide.diagnostics.hurdleTitle")}><p>{t("corporate.guide.diagnostics.hurdleBody")}</p></GuideSection>
      <GuideSection title={t("corporate.guide.diagnostics.betaTitle")}>
        <p>{t("corporate.guide.diagnostics.betaBody")}</p>
        <p>{t("corporate.guide.diagnostics.betaBars")}</p>
      </GuideSection>
      <GuideSection title={t("corporate.guide.diagnostics.matrixTitle")}>
        <p>{t("corporate.guide.diagnostics.matrixAxes")}</p>
        <p>{t("corporate.guide.diagnostics.matrixQ1")}</p>
        <p>{t("corporate.guide.diagnostics.matrixQ2")}</p>
        <p>{t("corporate.guide.diagnostics.matrixQ3")}</p>
        <p>{t("corporate.guide.diagnostics.matrixQ4")}</p>
        <p>{t("corporate.guide.diagnostics.matrixNote")}</p>
      </GuideSection>
    </>
  ),
  dcf: (t) => (
    <>
      <GuideSection title={t("corporate.guide.dcf.coreTitle")}><p>{t("corporate.guide.dcf.coreBody")}</p></GuideSection>
      <GuideSection title={t("corporate.guide.dcf.gridTitle")}><p>{t("corporate.guide.dcf.gridBody")}</p></GuideSection>
    </>
  ),
  comparison: (t) => (
    <>
      <GuideSection title={t("corporate.guide.comparison.aboutTitle")}><p>{t("corporate.guide.comparison.aboutBody")}</p></GuideSection>
      <GuideSection title={t("corporate.guide.comparison.columnsTitle")}>
        {COLUMNS_WITH_HELP.map((key) => (
          <p key={key}><span className="text-[var(--ink)]">{t(`corporate.columns.${key}`)}</span>: {t(`corporate.columns.${key}Help`)}</p>
        ))}
      </GuideSection>
      <GuideSection title={t("corporate.guide.comparison.chartsTitle")}><p>{t("corporate.guide.comparison.chartsBody")}</p></GuideSection>
    </>
  ),
};

/** Comparison columns that carry a definition, in table order. The table's header ⓘ reads the same keys. */
export const COLUMNS_WITH_HELP = ["weight", "spread", "dcfValue", "price", "gap", "capm", "market", "implied", "impliedSpread"] as const;
