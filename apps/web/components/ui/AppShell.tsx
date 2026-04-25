"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "@/components/ui/Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="flex min-h-screen">
      <button
        type="button"
        onClick={() => setSidebarOpen((current) => !current)}
        className="fixed left-4 top-4 z-50 inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] lg:hidden"
        aria-label={sidebarOpen ? "Close navigation sidebar" : "Open navigation sidebar"}
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
      >
        {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        Menu
      </button>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 p-4 pt-20 lg:ml-64 lg:p-20">
        {children}
      </main>
    </div>
  );
}
