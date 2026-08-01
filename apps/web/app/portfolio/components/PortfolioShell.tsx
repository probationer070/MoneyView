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
  children: ReactNode;
}

export function PortfolioShell({ rail, panels, onRailAction, children }: PortfolioShellProps) {
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const active = openPanel ? panels[openPanel] : undefined;

  // Stable identity: SidePanel's Escape effect depends on onClose, and an inline
  // arrow would re-run it on every render, pulling focus back out of the panel.
  const closePanel = useCallback(() => setOpenPanel(null), []);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* Main column: the only vertically scrolling region on the page. */}
      <div className="relative flex-1 overflow-y-auto" data-testid="portfolio-scroll-region">
        {children}
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
            variant={openPanel === item.id ? "outlined" : "ghost"}
            onClick={() => {
              if (onRailAction?.(item.id)) return;
              setOpenPanel((current) => (current === item.id ? null : item.id));
            }}
          />
        ))}
      </nav>
    </div>
  );
}
