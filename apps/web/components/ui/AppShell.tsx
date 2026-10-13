"use client";

import type { ReactNode } from "react";
import { TopNav } from "@/components/ui/TopNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopNav />
      {/* The vertical padding is published as custom properties because a page that wants
          to fill the viewport has to subtract it, and a descendant cannot measure this box
          in CSS. PortfolioShell reads both. Top = the 48px bar + 16px (spec §1: pt-16). */}
      <main className="px-4 pt-[var(--main-pad-top)] pb-[var(--main-pad-bottom)] [--main-pad-bottom:1rem] [--main-pad-top:4rem] lg:px-8 lg:[--main-pad-bottom:5rem]">
        {children}
      </main>
    </div>
  );
}
