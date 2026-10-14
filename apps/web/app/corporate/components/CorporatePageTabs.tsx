"use client";

import { type ReactNode, useEffect } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { useTabState } from "@/lib/tabState";
import { isPageTab, migrateLowerTab, PAGE_TAB_KEY, PAGE_TABS, type PageTabKey } from "../pageTabs";

// Spec §2A (D10): four tabs directly under the header. The panel fills what the page column leaves
// and scrolls inside itself, so the page never scrolls. Only the active panel is mounted, so a hidden
// tab's charts and requests do not run.
export function CorporatePageTabs({ panels }: { panels: Record<PageTabKey, ReactNode> }) {
  const t = useT();
  // Declared before useTabState on purpose: effects run in declaration order, so the old lower-tab
  // value has moved before useTabState's restore effect reads the page-tab key.
  useEffect(() => {
    try {
      migrateLowerTab(window.sessionStorage);
    } catch {
      // Blocked storage: the default tab is the honest answer.
    }
  }, []);
  const [stored, setStored] = useTabState<string>(PAGE_TAB_KEY, "summary");
  const active: PageTabKey = isPageTab(stored) ? stored : "summary";
  return (
    <section data-testid="corporate-page-tabs" className="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs
        ariaLabel={t("corporate.tabs.aria")}
        activeKey={active}
        onChange={setStored}
        idPrefix="corporate-"
        className="shrink-0 [contain:inline-size]"
        items={PAGE_TABS.map((key) => ({ key, label: t(`corporate.tabs.${key}`) }))}
      />
      <div
        role="tabpanel"
        id={`corporate-panel-${active}`}
        aria-labelledby={`corporate-tab-${active}`}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {panels[active]}
      </div>
    </section>
  );
}
