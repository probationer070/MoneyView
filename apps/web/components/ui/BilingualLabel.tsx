"use client";

import { LABELS, type LabelKey } from "@/lib/i18n/labels";
import { useLocale } from "@/lib/i18n/locale";

/**
 * "종목 NAME": both languages always visible. Assistive tech reads only the active locale's
 * half, so a screen reader does not announce every header twice. `lang` on each half lets
 * the caption rules in globals.css size Hangul and Latin separately.
 */
export function BilingualLabel({ k }: { k: LabelKey }) {
  const { locale } = useLocale();
  const [kr, eng] = LABELS[k];
  return (
    <span className="inline-flex items-baseline gap-1">
      <span lang="ko" aria-hidden={locale !== "ko" || undefined}>{kr}</span>
      <span lang="en" className="uppercase" aria-hidden={locale !== "en" || undefined}>{eng}</span>
    </span>
  );
}
