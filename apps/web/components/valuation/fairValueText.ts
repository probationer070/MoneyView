import { formatNumber, type FormatLocale } from "@/lib/format";
import type { FairValueSummary } from "@/lib/fairValue";
import type { useT } from "@/lib/i18n/locale";

type Translate = ReturnType<typeof useT>;

/** "Price implies 20.2% growth a year (model 4.3%)", or the out-of-range wording. */
export function impliedGrowthText(summary: FairValueSummary, t: Translate, locale: FormatLocale): string {
  const pct = (fraction: number) => formatNumber(fraction, "percent", { locale });
  const model = pct(summary.growth_1_5);
  if (summary.implied_growth_1_5 !== null) {
    return t("valuation.fairValue.implied", { implied: pct(summary.implied_growth_1_5), model });
  }
  if (summary.implied_growth_note?.startsWith("above_range")) return t("valuation.fairValue.impliedAbove", { model });
  if (summary.implied_growth_note?.startsWith("below_range")) return t("valuation.fairValue.impliedBelow", { model });
  return "";
}
