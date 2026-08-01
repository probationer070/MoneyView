"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { SidePanel } from "./SidePanel";

export interface RailItem {
  id: string;
  icon: ReactNode;
  label: string;
}

interface PortfolioShellProps {
  rail: RailItem[];
  panels: Record<string, { title: string; body: ReactNode }>;
  onRailAction?: (id: string) => boolean; // return true if handled as an action, not a panel
  /**
   * Optional controlled open panel. Omit both this and `onOpenPanelChange` to keep the
   * uncontrolled behaviour; pass them to let a parent open a panel programmatically
   * (e.g. before scrolling to something that only exists once the panel has mounted).
   */
  openPanel?: string | null;
  onOpenPanelChange?: (id: string | null) => void;
  children: ReactNode;
}

export function PortfolioShell({
  rail,
  panels,
  onRailAction,
  openPanel,
  onOpenPanelChange,
  children,
}: PortfolioShellProps) {
  const [uncontrolledPanel, setUncontrolledPanel] = useState<string | null>(null);
  const isControlled = openPanel !== undefined;
  const activeId = isControlled ? openPanel : uncontrolledPanel;
  const active = activeId ? panels[activeId] : undefined;

  const setActivePanel = useCallback(
    (next: string | null) => {
      if (!isControlled) setUncontrolledPanel(next);
      onOpenPanelChange?.(next);
    },
    [isControlled, onOpenPanelChange],
  );

  // Stable identity: SidePanel's Escape effect depends on onClose, and an inline
  // arrow would re-run it on every render, pulling focus back out of the panel.
  const closePanel = useCallback(() => setActivePanel(null), [setActivePanel]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* Positioning context for the panel. This wrapper does NOT scroll: SidePanel is
          `absolute inset-y-0`, and an absolutely positioned child of a scroll container is
          laid out against the whole scrollable content box, so a panel opened while the
          grid is scrolled down would land off-screen. Keeping the containing block on a
          non-scrolling wrapper pins the panel to the visible region instead.
          The scroll region stays a normal in-flow flex item rather than `absolute inset-0`:
          the app shell centres a shrink-to-fit root (`body` is `flex justify-center`), so a
          column that contributes nothing to intrinsic width collapses the whole page. */}
      <div className="relative flex flex-1">
        {/* Main column: the only vertically scrolling region on the page. */}
        <div className="flex-1 overflow-y-auto" data-testid="portfolio-scroll-region">
          {children}
        </div>
        {active ? (
          <SidePanel open title={active.title} onClose={closePanel}>
            {active.body}
          </SidePanel>
        ) : null}
      </div>

      <nav
        aria-label="Portfolio sections"
        data-testid="portfolio-rail"
        className={clsx(
          "flex shrink-0 items-center gap-2 border-[var(--border)] bg-[var(--bg-surface)]",
          "border-t p-2 lg:w-14 lg:flex-col lg:items-center lg:border-l lg:border-t-0 lg:py-4",
        )}
      >
        {rail.map((item) => (
          <IconButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            variant={activeId === item.id ? "outlined" : "ghost"}
            onClick={() => {
              if (onRailAction?.(item.id)) return;
              setActivePanel(activeId === item.id ? null : item.id);
            }}
          />
        ))}
      </nav>
    </div>
  );
}
