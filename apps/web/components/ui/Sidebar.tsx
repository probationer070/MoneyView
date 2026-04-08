"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PieChart, Newspaper, Activity, Building2, Orbit } from "lucide-react";
import clsx from "clsx";

const navItems = [
  { href: "/", label: "Market Overview", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/news", label: "News Feed", icon: Newspaper },
  { href: "/corporate", label: "Corporate Analysis", icon: Building2 },
  { href: "/monte-carlo", label: "Monte Carlo", icon: Orbit },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-8 px-2">
        <Activity className="h-6 w-6 text-[var(--surface)]" />
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
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-[var(--radius)] transition-colors",
                isActive
                  ? "bg-[var(--surface)] text-white font-medium shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-2 pb-4 text-xs text-center text-[var(--text-muted)]">
        Powered by FastAPI & Next.js
      </div>
    </aside>
  );
}
