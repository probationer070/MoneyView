"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useT } from "@/lib/i18n/locale";
import { MarketRegimeLine } from "./MarketRegimeLine";

// Spec §1 and §3: title, the corrected subtitle and the regime line. A client component because
// app/page.tsx is a server component and the copy comes from the en/ko catalogs through useT, the
// way every other page sets its header. No eyebrow: the 1280x720 budget has no room for it (plan N2).
export function MarketHeader() {
  const t = useT();
  return <PageHeader title={t("market.title")} subtitle={t("market.subtitle")} actions={<MarketRegimeLine />} tight />;
}
