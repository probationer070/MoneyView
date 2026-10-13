"use client";

import clsx from "clsx";
import { useLocale, useT, type Locale } from "@/lib/i18n/locale";

// Language names are shown in their own language on purpose; they are not translated.
const OPTIONS: [Locale, string][] = [["en", "English"], ["ko", "한국어"]];

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <div role="group" aria-label={t("common.language")} className="inline-flex gap-0.5 rounded-[var(--radius-1)] border border-[var(--line-strong)] p-0.5">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)}
          className={clsx("type-caption rounded-[var(--radius-1)] px-3 py-1",
            locale === value ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]")}>
          {label}
        </button>
      ))}
    </div>
  );
}
