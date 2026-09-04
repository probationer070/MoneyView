"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PieChart, Newspaper, Activity, Building2, Orbit, NotebookPen, Scale } from "lucide-react";
import clsx from "clsx";

const navItems = [
  { href: "/", label: "Market Overview", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/news", label: "News Feed", icon: Newspaper },
  { href: "/corporate", label: "Corporate Analysis", icon: Building2 },
  { href: "/monte-carlo", label: "Monte Carlo", icon: Orbit },
  { href: "/decisions", label: "Decision Log", icon: NotebookPen },
  { href: "/valuation", label: "Valuation", icon: Scale },
];

export function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="app-sidebar"
        className={clsx(
          "fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] p-4 transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-8 flex items-center gap-2 px-2">
          <Activity className="h-6 w-6 text-[var(--accent)]" />
          <h1 className="font-bold text-xl text-[var(--text-primary)]">MoneyView</h1>
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
                  "flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 transition-colors",
                  isActive
                    ? "bg-[var(--surface)] text-white font-medium"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-2 pb-4 text-center text-xs text-[var(--text-muted)]">
          Powered by FastAPI & Next.js
        </div>
      </aside>
    </>
  );
}
