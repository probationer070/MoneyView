"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/** "How to read this screen" for /valuation: the fair value line, its industry badge, the 10-year case against the 5-year DCF, refusals and the four evidence rows. */
export function ValuationGuide() {
  const t = useT();
  return (
    <PageGuide testId="valuation-guide">
      <GuideSection title={t("valuation.guide.about.title")}>
        <p>{t("valuation.guide.about.body")}</p>
      </GuideSection>
      <GuideSection title={t("valuation.guide.fairValue.title")}>
        <p>{t("valuation.guide.fairValue.case")}</p>
        <p>{t("valuation.guide.fairValue.price")}</p>
        <p>{t("valuation.guide.fairValue.implied")}</p>
        <p>{t("valuation.guide.fairValue.assumptions")}</p>
      </GuideSection>
      <GuideSection title={t("valuation.guide.plausible.title")}>
        <p>{t("valuation.guide.plausible.compare")}</p>
        <p>{t("valuation.guide.plausible.flag")}</p>
        <p>{t("valuation.guide.plausible.causes")}</p>
        <p>{t("valuation.guide.plausible.uncapped")}</p>
      </GuideSection>
      <GuideSection title={t("valuation.guide.method.title")}>
        <p>{t("valuation.guide.method.body")}</p>
        <p>{t("valuation.guide.method.gap")}</p>
      </GuideSection>
      <GuideSection title={t("valuation.guide.refusal.title")}>
        <p>{t("valuation.guide.refusal.notPositive")}</p>
        <p>{t("valuation.guide.refusal.none")}</p>
        <p>{t("valuation.guide.refusal.rows")}</p>
      </GuideSection>
      <GuideSection title={t("valuation.guide.panel.title")}>
        <p>{t("valuation.guide.panel.order")}</p>
        <p>{t("valuation.guide.panel.drawdown")}</p>
        <p>{t("valuation.guide.panel.volume")}</p>
        <p>{t("valuation.guide.panel.pe")}</p>
        <p>{t("valuation.guide.panel.dcfGap")}</p>
        <p>{t("valuation.guide.panel.source")}</p>
      </GuideSection>
      <GuideSection title={t("valuation.guide.source.title")}>
        <p>{t("valuation.guide.source.body")}</p>
      </GuideSection>
    </PageGuide>
  );
}
