"use client";

import clsx from "clsx";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { LabelKey } from "@/lib/i18n/labels";
import type { RiskWarning } from "../../../../packages/shared-types";

const COLUMNS: LabelKey[] = ["warning", "status", "value", "observed", "rule"];

const STATE_KEY = { on: "risk.warnings.on", off: "risk.warnings.off", unknown: "risk.warnings.unknown" } as const;

/** The value as the API sent it, in its unit: percent units print with %, days as a whole number. */
function warningValue(warning: RiskWarning, locale: "en" | "ko"): string {
  if (warning.value === null) return MISSING;
  if (warning.unit === "days") return formatNumber(warning.value, "integer", { locale });
  const signed = warning.unit === "pct_change" || warning.unit === "mm_pct";
  return formatNumber(warning.value / 100, "percent", { digits: 2, signed, locale });
}

/** The six warning indicators from /latest.warnings, shown in the news column while no alert is open (spec §3.3). */
export function WarningsTable({ warnings, className }: { warnings: RiskWarning[]; className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div data-testid="warnings-table" className={clsx("overflow-y-auto", className)}>
      <div className="pb-2"><Eyebrow label="warning" /></div>
      {warnings.length === 0 ? (
        <p className="type-small text-[var(--ink-muted)]">{t("risk.warnings.empty")}</p>
      ) : (
        <table className="type-small w-full border-collapse text-[var(--ink-secondary)]">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className="type-caption border-b border-[var(--line)] px-2 py-1 text-left uppercase text-[var(--ink-muted)]">
                  <BilingualLabel k={column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {warnings.map((warning) => (
              <tr key={warning.id} data-state={warning.state} className="border-b border-[var(--line)] align-top">
                <td className="px-2 py-1 text-[var(--ink)]">{warning.label[locale]}</td>
                <td className="whitespace-nowrap px-2 py-1">{t(STATE_KEY[warning.state])}</td>
                <td className="type-mono whitespace-nowrap px-2 py-1 text-right">{warningValue(warning, locale)}</td>
                <td className="type-mono whitespace-nowrap px-2 py-1">{warning.observed_at ?? MISSING}</td>
                <td className="px-2 py-1">{warning.rule[locale]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
