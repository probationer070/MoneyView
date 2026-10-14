"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { tabStateKey, useTabState } from "@/lib/tabState";

export const LOWER_TABS = ["diagnostics", "dcf", "comparison"] as const;
export type LowerTabKey = (typeof LOWER_TABS)[number];

const isLowerTab = (value: unknown): value is LowerTabKey =>
  typeof value === "string" && (LOWER_TABS as readonly string[]).includes(value);

// Spec §3: three tabs under the first screen; the choice is kept per browser tab (lib/tabState).
// Only the active panel is mounted, so a hidden tab's charts and requests do not run.
export function CorporateLowerTabs({ panels }: { panels: Record<LowerTabKey, ReactNode> }) {
  const t = useT();
  const [stored, setStored] = useTabState<string>(tabStateKey("corporate", "lowerTab"), "diagnostics");
  const active: LowerTabKey = isLowerTab(stored) ? stored : "diagnostics";
  return (
    <section data-testid="corporate-lower-tabs" className="flex flex-col gap-4">
      <Tabs
        ariaLabel={t("corporate.tabs.aria")}
        activeKey={active}
        onChange={setStored}
        className="[contain:inline-size]"
        items={[
          { key: "diagnostics", label: t("corporate.tabs.diagnostics") },
          { key: "dcf", label: t("corporate.tabs.dcf") },
          { key: "comparison", label: t("corporate.tabs.comparison") },
        ]}
      />
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="min-w-0">
        {panels[active]}
      </div>
    </section>
  );
}
