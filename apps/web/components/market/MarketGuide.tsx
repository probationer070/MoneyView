"use client";

import { GuideSection } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";

export const MARKET_GUIDE_ID = "market-guide";

/**
 * "How to read this screen" for "/". Not PageGuide's <details>: the closed summary row would take
 * height the one-screen overview does not have at 1280x720. The toggle sits in the tab row
 * (MarketPageTabs) and this body is mounted only while open, at the top of the panel, which scrolls
 * inside itself. No threshold numbers: the regime rules live in the backend and would drift in prose.
 */
export function MarketGuide() {
  const t = useT();
  return (
    <div
      id={MARKET_GUIDE_ID}
      data-testid={MARKET_GUIDE_ID}
      className="mb-3 flex flex-col gap-4 border border-[var(--line)] bg-[var(--surface-raised)] p-4"
    >
      <GuideSection title={t("market.guide.about.title")}><p>{t("market.guide.about.body")}</p></GuideSection>
      <GuideSection title={t("market.guide.regime.title")}>
        <p>{t("market.guide.regime.label")}</p>
        <p>{t("market.guide.regime.breadth")}</p>
        <p>{t("market.guide.regime.signals")}</p>
        <p>{t("market.guide.regime.verdict")}</p>
        <p>{t("market.guide.regime.unknown")}</p>
        <p>{t("market.guide.regime.colour")}</p>
      </GuideSection>
      <GuideSection title={t("market.guide.cards.title")}>
        <p>{t("market.guide.cards.head")}</p>
        <p>{t("market.guide.cards.day")}</p>
        <p>{t("market.guide.cards.month")}</p>
        <p>{t("market.guide.cards.colour")}</p>
        <p>{t("market.guide.cards.rate")}</p>
        <p>{t("market.guide.cards.open")}</p>
      </GuideSection>
      <GuideSection title={t("market.guide.table.title")}><p>{t("market.guide.table.body")}</p></GuideSection>
      <GuideSection title={t("market.guide.spreads.title")}>
        <p>{t("market.guide.spreads.row")}</p>
        <p>{t("market.guide.spreads.value")}</p>
        <p>{t("market.guide.spreads.refused")}</p>
        <p>{t("market.guide.spreads.events")}</p>
      </GuideSection>
      <GuideSection title={t("market.guide.source.title")}><p>{t("market.guide.source.body")}</p></GuideSection>
    </div>
  );
}
