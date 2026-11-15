import type { LucideIcon } from "lucide-react";
import { Building2, CalendarDays, GitFork, History, LayoutDashboard, Newspaper, NotebookPen, Orbit, PieChart, Radar, Scale } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/translate";

export interface NavItem {
  href: string;
  /** Full name: aria-label and title on the bar icon, text in the panel. */
  key: MessageKey;
  /** Short label shown next to the current page's icon. */
  shortKey: MessageKey;
  icon: LucideIcon;
}

// Same list, order, paths and icons as the old Sidebar (spec 2026-10-14 §1), plus /signals (PR #67) and /alerts (risk UI spec §5).
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "nav.market", shortKey: "navShort.market", icon: LayoutDashboard },
  { href: "/portfolio", key: "nav.portfolio", shortKey: "navShort.portfolio", icon: PieChart },
  { href: "/news", key: "nav.news", shortKey: "navShort.news", icon: Newspaper },
  { href: "/corporate", key: "nav.corporate", shortKey: "navShort.corporate", icon: Building2 },
  { href: "/monte-carlo", key: "nav.monteCarlo", shortKey: "navShort.monteCarlo", icon: Orbit },
  { href: "/decisions", key: "nav.decisions", shortKey: "navShort.decisions", icon: NotebookPen },
  { href: "/valuation", key: "nav.valuation", shortKey: "navShort.valuation", icon: Scale },
  { href: "/cases", key: "nav.cases", shortKey: "navShort.cases", icon: GitFork },
  { href: "/events", key: "nav.events", shortKey: "navShort.events", icon: CalendarDays },
  { href: "/signals", key: "nav.signals", shortKey: "navShort.signals", icon: Radar },
  { href: "/alerts", key: "nav.alerts", shortKey: "navShort.alerts", icon: History },
];

export interface NavGroup {
  key: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Pages in flyout order. */
  hrefs: readonly string[];
}

/** The ☰ panel's groups (2026-11-15 D2). Every NAV_ITEMS entry belongs to exactly one group. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { key: "market", label: "navGroup.market", icon: LayoutDashboard, hrefs: ["/", "/news", "/events"] },
  { key: "signals", label: "navGroup.signals", icon: Radar, hrefs: ["/signals", "/alerts"] },
  { key: "corporate", label: "navGroup.corporate", icon: Building2, hrefs: ["/corporate", "/valuation", "/cases"] },
  { key: "portfolio", label: "navGroup.portfolio", icon: PieChart, hrefs: ["/portfolio", "/monte-carlo", "/decisions"] },
];

/** The group that holds the page at `href`, if any. */
export function navGroupOf(href: string | undefined): NavGroup | null {
  return NAV_GROUPS.find((group) => href !== undefined && group.hrefs.includes(href)) ?? null;
}

/** Prefix match, so /cases/2 is still "Cases" (plan N7). "/" matches only itself. */
export function activeNavItem(pathname: string): NavItem | null {
  return NAV_ITEMS.find((item) => (
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  )) ?? null;
}
