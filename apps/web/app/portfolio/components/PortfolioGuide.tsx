"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

/**
 * "How to read this screen" for /portfolio. The page body is its own scroll region (PortfolioShell), so the
 * closed <details> row costs no page height. No threshold numbers: the panels show them from data.
 */
export function PortfolioGuide() {
  const t = useT();
  return (
    <PageGuide testId="portfolio-guide">
      <GuideSection title={t("portfolio.guide.about.title")}><p>{t("portfolio.guide.about.body")}</p></GuideSection>
      <GuideSection title={t("portfolio.guide.layout.title")}>
        <p>{t("portfolio.guide.layout.main")}</p>
        <p>{t("portfolio.guide.layout.panel")}</p>
      </GuideSection>
      <GuideSection title={t("portfolio.guide.tiles.title")}>
        <p>{t("portfolio.guide.tiles.head")}</p>
        <p>{t("portfolio.guide.tiles.change")}</p>
        <p>{t("portfolio.guide.tiles.colour")}</p>
        <p>{t("portfolio.guide.tiles.news")}</p>
        <p>{t("portfolio.guide.tiles.follow")}</p>
      </GuideSection>
      <GuideSection title={t("portfolio.guide.window.title")}><p>{t("portfolio.guide.window.body")}</p></GuideSection>
      <GuideSection title={t("portfolio.guide.attribution.title")}>
        <p>{t("portfolio.guide.attribution.kpi")}</p>
        <p>{t("portfolio.guide.attribution.weights")}</p>
        <p>{t("portfolio.guide.attribution.charts")}</p>
        <p>{t("portfolio.guide.attribution.idle")}</p>
      </GuideSection>
      <GuideSection title={t("portfolio.guide.snapshot.title")}>
        <p>{t("portfolio.guide.snapshot.source")}</p>
        <p>{t("portfolio.guide.snapshot.cards")}</p>
        <p>{t("portfolio.guide.snapshot.table")}</p>
        <p>{t("portfolio.guide.snapshot.history")}</p>
      </GuideSection>
      <GuideSection title={t("portfolio.guide.table.title")}>
        <p>{t("portfolio.guide.table.roic")}</p>
        <p>{t("portfolio.guide.table.dcf")}</p>
        <p>{t("portfolio.guide.table.implied")}</p>
        <p>{t("portfolio.guide.table.volatility")}</p>
        <p>{t("portfolio.guide.table.quality")}</p>
      </GuideSection>
      <GuideSection title={t("portfolio.guide.allocation.title")}>
        <p>{t("portfolio.guide.allocation.summary")}</p>
        <p>{t("portfolio.guide.allocation.edit")}</p>
      </GuideSection>
      <GuideSection title={t("portfolio.guide.news.title")}><p>{t("portfolio.guide.news.body")}</p></GuideSection>
    </PageGuide>
  );
}
