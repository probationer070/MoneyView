"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { useTabState } from "@/lib/tabState";
import { CORPORATE_GUIDE_ID, CorporateGuide } from "./CorporateGuide";
import { isPageTab, migrateLowerTab, PAGE_TAB_KEY, PAGE_TABS, type PageTabKey } from "../pageTabs";

// Moves a pre-D10 lower-tab choice before the page-tab value is read. Blocked storage keeps Summary.
function migrateFromSession(): void {
  try {
    migrateLowerTab(window.sessionStorage);
  } catch {
    // Blocked storage: the default tab is the honest answer.
  }
}

// Spec §2A (D10): four tabs directly under the header. The panel fills what the page column leaves
// and scrolls inside itself, so the page never scrolls. Only the active panel is mounted, so a hidden
// tab's charts and requests do not run.
export function CorporatePageTabs({ panels }: { panels: Record<PageTabKey, ReactNode> }) {
  const t = useT();
  // The migration runs inside useTabState's restore, before its read, so no effect order is relied on.
  const [stored, setStored] = useTabState<string>(PAGE_TAB_KEY, "summary", migrateFromSession);
  const active: PageTabKey = isPageTab(stored) ? stored : "summary";
  // Closed on every visit, like PageGuide; it follows the active tab while open.
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <section data-testid="corporate-page-tabs" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-3">
        <Tabs
          ariaLabel={t("corporate.tabs.aria")}
          activeKey={active}
          onChange={setStored}
          idPrefix="corporate-"
          className="min-w-0 flex-1 [contain:inline-size]"
          items={PAGE_TABS.map((key) => ({ key, label: t(`corporate.tabs.${key}`) }))}
        />
        <button
          type="button"
          data-testid="corporate-guide-toggle"
          aria-expanded={guideOpen}
          aria-controls={guideOpen ? CORPORATE_GUIDE_ID : undefined}
          onClick={() => setGuideOpen((open) => !open)}
          className="type-small shrink-0 text-[var(--ink-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--brand-text)]"
        >
          {t("guide.summary")}
        </button>
      </div>
      <div
        role="tabpanel"
        id={`corporate-panel-${active}`}
        aria-labelledby={`corporate-tab-${active}`}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {guideOpen ? <CorporateGuide tab={active} /> : null}
        {panels[active]}
      </div>
    </section>
  );
}
