import type { LucideIcon } from "lucide-react";
import { Building2, CalendarDays, GitFork, LayoutDashboard, Newspaper, NotebookPen, Orbit, PieChart, Scale } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/translate";

export interface NavItem {
  href: string;
  /** Full name: aria-label and title on the bar icon, text in the panel. */
  key: MessageKey;
  /** Short label shown next to the current page's icon. */
  shortKey: MessageKey;
  icon: LucideIcon;
}

// Same list, order, paths and icons as the old Sidebar (spec 2026-10-14 §1).
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
];

/** Prefix match, so /cases/2 is still "Cases" (plan N7). "/" matches only itself. */
export function activeNavItem(pathname: string): NavItem | null {
  return NAV_ITEMS.find((item) => (
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  )) ?? null;
}
