"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PieChart, Newspaper, Building2, Orbit, NotebookPen, Scale, CalendarDays, GitFork } from "lucide-react";
import clsx from "clsx";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useT } from "@/lib/i18n/locale";

const navItems = [
  { href: "/", key: "nav.market" as const, icon: LayoutDashboard },
  { href: "/portfolio", key: "nav.portfolio" as const, icon: PieChart },
  { href: "/news", key: "nav.news" as const, icon: Newspaper },
  { href: "/corporate", key: "nav.corporate" as const, icon: Building2 },
  { href: "/monte-carlo", key: "nav.monteCarlo" as const, icon: Orbit },
  { href: "/decisions", key: "nav.decisions" as const, icon: NotebookPen },
  { href: "/valuation", key: "nav.valuation" as const, icon: Scale },
  { href: "/cases", key: "nav.cases" as const, icon: GitFork },
  { href: "/events", key: "nav.events" as const, icon: CalendarDays },
];

export function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const t = useT();

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 z-30 bg-[var(--overlay-scrim)] transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="app-sidebar"
        className={clsx(
          "fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-[var(--line)] bg-[var(--surface)] p-4 transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-8 flex items-center gap-2 px-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-[var(--brand)]" />
          <h1 className="type-panel-title text-[var(--ink)]">MoneyView</h1>
        </div>

        <nav className="flex flex-col gap-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={clsx(
                  "flex items-center gap-3 rounded-[var(--radius-1)] px-3 py-2 type-body font-bold text-[var(--ink)] hover:bg-[var(--surface-raised)]",
                  isActive && "bg-[var(--surface-raised)]"
                )}
              >
                {isActive && <span aria-hidden="true" className="h-4 w-0.5 bg-[var(--brand)]" />}
                <Icon className="h-5 w-5" />
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-4 px-2 pb-4">
          <LanguageToggle />
          <div className="type-caption text-center text-[var(--ink-muted)]">
            Powered by FastAPI & Next.js
          </div>
        </div>
      </aside>
    </>
  );
}
