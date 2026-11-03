"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/** "How to read this screen" for /news: what the list is, how a card reads, and where the articles come from. */
export function NewsGuide() {
  const t = useT();
  return (
    <PageGuide testId="news-guide">
      <GuideSection title={t("news.guide.about.title")}><p>{t("news.guide.about.body")}</p></GuideSection>
      <GuideSection title={t("news.guide.card.title")}>
        <p>{t("news.guide.card.body")}</p>
        <p>{t("news.guide.card.today")}</p>
      </GuideSection>
      <GuideSection title={t("news.guide.order.title")}><p>{t("news.guide.order.body")}</p></GuideSection>
      <GuideSection title={t("news.guide.source.title")}>
        <p>{t("news.guide.source.body")}</p>
        <p>{t("news.guide.source.fallback")}</p>
        <p>{t("news.guide.source.unused")}</p>
      </GuideSection>
    </PageGuide>
  );
}
