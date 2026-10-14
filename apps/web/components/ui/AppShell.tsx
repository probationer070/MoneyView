"use client";

import type { ReactNode } from "react";
import { TopNav } from "@/components/ui/TopNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    // w-full min-w-0: body is a centred flex row, so without these the shell is content-sized and
    // any child's min-content width (e.g. a tab strip) widens the whole page past the viewport.
    <div className="min-h-screen w-full min-w-0">
      <TopNav />
      {/* The vertical padding is published as custom properties because a page that wants
          to fill the viewport has to subtract it, and a descendant cannot measure this box
          in CSS. PortfolioShell reads both. Top = the 48px bar + 16px (spec §1: pt-16). */}
      <main className="w-full min-w-0 px-4 pt-[var(--main-pad-top)] pb-[var(--main-pad-bottom)] [--main-pad-bottom:1rem] [--main-pad-top:4rem] lg:px-8 lg:[--main-pad-bottom:5rem]">
        {children}
      </main>
    </div>
  );
}
