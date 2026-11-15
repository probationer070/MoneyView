"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";

export interface PortfolioTab {
  key: string;
  label: string;
}

interface PortfolioShellProps {
  tabs: PortfolioTab[];
  tabsLabel: string;
  /**
   * Which tab is showing. Owned by the parent, because switching is not always a click:
   * adding a stock from the detail modal has to show the weights tab before it can focus
   * a weight input that only exists once that tab has mounted.
   */
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Sits at the right end of the tab row, e.g. a view toggle that belongs to one tab. */
  tabsAside?: ReactNode;
  /** Only the active tab's content is mounted. */
  panels: Record<string, ReactNode>;
  /** The guide and page-level messages: scroll with the panel, above its content. */
  notices?: ReactNode;
  /** Header, above the tabs; does not scroll. */
  children: ReactNode;
}

export function PortfolioShell({ tabs, tabsLabel, activeTab, onTabChange, panels, tabsAside, notices, children }: PortfolioShellProps) {
  // Height is the viewport minus the app shell's own vertical padding, read from the
  // variables AppShell publishes. The header and the tab row stay put; the tab panel (with the guide
  // and messages above it) is the only scroll container, so the document itself never overflows
  // (ERROR-LOG.md 2026-08-02; /portfolio is in ONE_SCREEN_ROUTES).
  return (
    <div className="flex h-[calc(100vh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] flex-col">
      <div className="shrink-0">{children}</div>
      <div className="flex shrink-0 items-start gap-3 px-4 pt-3">
        <Tabs className="min-w-0 flex-1" items={tabs} activeKey={activeTab} onChange={onTabChange} ariaLabel={tabsLabel} />
        {tabsAside}
      </div>
      {/* Stays a normal in-flow flex item: the app shell centres a shrink-to-fit root, so a column
          that contributes nothing to intrinsic width collapses the whole page. */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="portfolio-scroll-region">
        {notices}
        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {panels[activeTab]}
        </div>
      </div>
    </div>
  );
}
