"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/** "How to read this screen" for /events: where events come from, the form, categories and the table. */
export function EventsGuide() {
  const t = useT();
  return (
    <PageGuide testId="events-guide">
      <GuideSection title={t("events.guide.about.title")}>
        <p>{t("events.guide.about.body")}</p>
      </GuideSection>
      <GuideSection title={t("events.guide.sources.title")}>
        <p>{t("events.guide.sources.builtin")}</p>
        <p>{t("events.guide.sources.rule")}</p>
        <p>{t("events.guide.sources.computed")}</p>
        <p>{t("events.guide.sources.user")}</p>
      </GuideSection>
      <GuideSection title={t("events.guide.form.title")}>
        <p>{t("events.guide.form.body")}</p>
        <p>{t("events.guide.form.errors")}</p>
        <p>{t("events.guide.form.edit")}</p>
      </GuideSection>
      <GuideSection title={t("events.guide.categories.title")}>
        <p>{t("events.guide.categories.body")}</p>
        <p>{t("events.guide.categories.edit")}</p>
        <p>{t("events.guide.categories.delete")}</p>
      </GuideSection>
      <GuideSection title={t("events.guide.table.title")}>
        <p>{t("events.guide.table.columns")}</p>
        <p>{t("events.guide.table.filter")}</p>
      </GuideSection>
    </PageGuide>
  );
}
