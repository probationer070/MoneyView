"use client";

import type { ReactNode } from "react";
import { ScanReveal } from "@/components/ui/ScanReveal";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { useTabState } from "@/lib/tabState";
import { isMarketPageTab, MARKET_PAGE_TAB_KEY, MARKET_PAGE_TABS, type MarketPageTab } from "./marketModel";

/** The remembered page tab (sessionStorage, this browser tab only). A stored value that is not a tab reads as Instruments. */
export function useMarketPageTab(): [MarketPageTab, (tab: MarketPageTab) => void] {
  const [stored, setStored] = useTabState<string>(MARKET_PAGE_TAB_KEY, "instruments");
  return [isMarketPageTab(stored) ? stored : "instruments", setStored];
}

interface MarketPageTabsProps {
  active: MarketPageTab;
  onChange: (tab: MarketPageTab) => void;
  instruments: ReactNode;
  spreads: ReactNode;
}

// Spec §2.1: two tabs under the header. The panel fills what the page column leaves and scrolls
// inside itself, so the page never scrolls. Only the active panel is mounted, so the spread charts
// do not draw while Instruments is open. Ids are prefixed so the modal's own tabs never collide.
export function MarketPageTabs({ active, onChange, instruments, spreads }: MarketPageTabsProps) {
  const t = useT();
  const panels: Record<MarketPageTab, ReactNode> = { instruments, spreads };
  return (
    <section data-testid="market-page-tabs" className="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs
        ariaLabel={t("market.tabs.aria")}
        activeKey={active}
        onChange={(key) => {
          if (isMarketPageTab(key)) onChange(key);
        }}
        idPrefix="market-"
        className="shrink-0 [contain:inline-size]"
        items={MARKET_PAGE_TABS.map((key) => ({ key, label: t(`market.tabs.${key}`) }))}
      />
      <div
        role="tabpanel"
        id={`market-panel-${active}`}
        aria-labelledby={`market-tab-${active}`}
        className="relative min-w-0 flex-1 overflow-auto"
      >
        <ScanReveal trigger={active}>{panels[active]}</ScanReveal>
      </div>
    </section>
  );
}
