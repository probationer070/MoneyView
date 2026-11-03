"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/** "How to read this screen" for /cases: what a case is, the table, and the cases the app creates. */
export function CasesGuide() {
  const t = useT();
  return (
    <PageGuide testId="cases-guide">
      <GuideSection title={t("cases.guide.about.title")}>
        <p>{t("cases.guide.about.body")}</p>
        <p>{t("cases.guide.about.model")}</p>
        <p>{t("cases.guide.about.open")}</p>
      </GuideSection>
      <GuideSection title={t("cases.guide.table.title")}>
        <p>{t("cases.guide.table.columns")}</p>
        <p>{t("cases.guide.table.fork")}</p>
        <p>{t("cases.guide.table.filter")}</p>
      </GuideSection>
      <GuideSection title={t("cases.guide.auto.title")}>
        <p>{t("cases.guide.auto.fair")}</p>
        <p>{t("cases.guide.auto.source")}</p>
        <p>{t("cases.guide.auto.cyclical")}</p>
        <p>{t("cases.guide.auto.conservative")}</p>
        <p>{t("cases.guide.auto.spacex")}</p>
      </GuideSection>
    </PageGuide>
  );
}
