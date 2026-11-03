"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/** "How to read this screen" for /decisions: what a record holds, how a card and the scatter read, and edit and delete. */
export function DecisionsGuide() {
  const t = useT();
  return (
    <PageGuide testId="decisions-guide">
      <GuideSection title={t("decisions.guide.about.title")}>
        <p>{t("decisions.guide.about.body")}</p>
        <p>{t("decisions.guide.about.order")}</p>
      </GuideSection>
      <GuideSection title={t("decisions.guide.record.title")}>
        <p>{t("decisions.guide.record.server")}</p>
        <p>{t("decisions.guide.record.unavailable")}</p>
      </GuideSection>
      <GuideSection title={t("decisions.guide.card.title")}>
        <p>{t("decisions.guide.card.head")}</p>
        <p>{t("decisions.guide.card.gap")}</p>
        <p>{t("decisions.guide.card.move")}</p>
        <p>{t("decisions.guide.card.pair")}</p>
      </GuideSection>
      <GuideSection title={t("decisions.guide.scatter.title")}>
        <p>{t("decisions.guide.scatter.body")}</p>
        <p>{t("decisions.guide.scatter.coverage")}</p>
      </GuideSection>
      <GuideSection title={t("decisions.guide.edit.title")}>
        <p>{t("decisions.guide.edit.edit")}</p>
        <p>{t("decisions.guide.edit.delete")}</p>
        <p>{t("decisions.guide.edit.sync")}</p>
      </GuideSection>
    </PageGuide>
  );
}
