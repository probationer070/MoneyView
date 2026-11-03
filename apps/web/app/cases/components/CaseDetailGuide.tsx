"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/** "How to read this screen" for /cases/[id]: one note per section of the case screen. */
export function CaseDetailGuide() {
  const t = useT();
  return (
    <PageGuide testId="case-detail-guide">
      <GuideSection title={t("caseDetail.guide.about.title")}>
        <p>{t("caseDetail.guide.about.body")}</p>
        <p>{t("caseDetail.guide.about.sections")}</p>
      </GuideSection>
      <GuideSection title={t("caseDetail.guide.valuation.title")}>
        <p>{t("caseDetail.guide.valuation.body")}</p>
        <p>{t("caseDetail.guide.valuation.figures")}</p>
        <p>{t("caseDetail.guide.valuation.terminal")}</p>
        <p>{t("caseDetail.guide.valuation.tables")}</p>
        <p>{t("caseDetail.guide.valuation.offer")}</p>
      </GuideSection>
      <GuideSection title={t("caseDetail.guide.pricing.title")}>
        <p>{t("caseDetail.guide.pricing.body")}</p>
        <p>{t("caseDetail.guide.pricing.gap")}</p>
        <p>{t("caseDetail.guide.pricing.refused")}</p>
      </GuideSection>
      <GuideSection title={t("caseDetail.guide.inputs.title")}>
        <p>{t("caseDetail.guide.inputs.body")}</p>
        <p>{t("caseDetail.guide.inputs.narrative")}</p>
        <p>{t("caseDetail.guide.inputs.narrated")}</p>
      </GuideSection>
      <GuideSection title={t("caseDetail.guide.why.title")}>
        <p>{t("caseDetail.guide.why.body")}</p>
        <p>{t("caseDetail.guide.why.shapley")}</p>
        <p>{t("caseDetail.guide.why.bars")}</p>
        <p>{t("caseDetail.guide.why.limit")}</p>
      </GuideSection>
      <GuideSection title={t("caseDetail.guide.fork.title")}>
        <p>{t("caseDetail.guide.fork.body")}</p>
        <p>{t("caseDetail.guide.fork.rows")}</p>
        <p>{t("caseDetail.guide.fork.narrative")}</p>
        <p>{t("caseDetail.guide.fork.refusal")}</p>
        <p>{t("caseDetail.guide.fork.counter")}</p>
      </GuideSection>
      <GuideSection title={t("caseDetail.guide.simulate.title")}>
        <p>{t("caseDetail.guide.simulate.body")}</p>
        <p>{t("caseDetail.guide.simulate.inputs")}</p>
        <p>{t("caseDetail.guide.simulate.runs")}</p>
        <p>{t("caseDetail.guide.simulate.accounting")}</p>
        <p>{t("caseDetail.guide.simulate.suppressed")}</p>
        <p>{t("caseDetail.guide.simulate.stats")}</p>
        <p>{t("caseDetail.guide.simulate.histogram")}</p>
        <p>{t("caseDetail.guide.simulate.association")}</p>
        <p>{t("caseDetail.guide.simulate.rerun")}</p>
      </GuideSection>
    </PageGuide>
  );
}
