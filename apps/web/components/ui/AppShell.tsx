"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TopNav } from "@/components/ui/TopNav";
import { isOneScreenRoute } from "@/components/ui/oneScreenRoutes";

const PAD_BOTTOM_LG = "lg:[--main-pad-bottom:5rem]";
const PAD_BOTTOM_LG_ONE_SCREEN = "lg:[--main-pad-bottom:1.5rem]";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const oneScreen = isOneScreenRoute(pathname);
  return (
    // w-full min-w-0: body is a centred flex row, so without these the shell is content-sized and
    // any child's min-content width (e.g. a tab strip) widens the whole page past the viewport.
    <div className="min-h-dvh w-full min-w-0">
      <TopNav />
      {/* The vertical padding is published as custom properties because a page that wants
          to fill the viewport has to subtract it, and a descendant cannot measure this box
          in CSS. PortfolioShell reads both. Top = the 48px bar + 16px (spec §1: pt-16). */}
      <main className={`w-full min-w-0 px-4 pt-[var(--main-pad-top)] pb-[var(--main-pad-bottom)] [--main-pad-bottom:1rem] [--main-pad-top:4rem] lg:px-8 ${oneScreen ? PAD_BOTTOM_LG_ONE_SCREEN : PAD_BOTTOM_LG}`}>
        {children}
      </main>
    </div>
  );
}
