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
  /** Only the active tab's content is mounted. */
  panels: Record<string, ReactNode>;
  /** Header and page-level messages, above the tabs. */
  children: ReactNode;
}

export function PortfolioShell({ tabs, tabsLabel, activeTab, onTabChange, panels, children }: PortfolioShellProps) {
  // Height is the viewport minus the app shell's own vertical padding, read from the
  // variables AppShell publishes. This shell owns the only scroll container, so the
  // document itself never overflows (ERROR-LOG.md 2026-08-02).
  return (
    <div className="flex h-[calc(100vh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] flex-col">
      {/* Main column: the only vertically scrolling region on the page. It stays a normal
          in-flow flex item: the app shell centres a shrink-to-fit root, so a column that
          contributes nothing to intrinsic width collapses the whole page. */}
      <div className="flex-1 overflow-y-auto" data-testid="portfolio-scroll-region">
        {children}
        <div className="px-4 pt-3">
          <Tabs items={tabs} activeKey={activeTab} onChange={onTabChange} ariaLabel={tabsLabel} />
        </div>
        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {panels[activeTab]}
        </div>
      </div>
    </div>
  );
}
