"use client";

import { GuideSection, PageGuide } from "@/components/ui/PageGuide";
import { useT } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/translate";

// rules.yaml order. tests/e2e/signals-guide.spec.ts checks that every rule there has a line in both catalogs.
const RULES = [
  "b_tnx_sticky", "b_core_cpi_hot", "b_hy_wide", "b_brent_spike", "b_fed_hike",
  "a_tnx_relief", "a_brent_relief", "a_labor_core",
  "m_capex_reaction", "m_iran_strike", "m_breadth",
] as const;

const TABLE_LINES = ["direction", "state", "values", "observed", "contribution"] as const;

/**
 * "How to read this screen" for /signals. No threshold numbers: the table shows them from the API, and prose
 * numbers would drift when rules.yaml changes. The prior and the bounds are quoted because the probability
 * section cannot be read without them: a change to them in rules.yaml must update `signals.guide.probability`.
 * The reminder is here, not in rules.yaml, because rules_version is that file's sha256 and any edit, even a
 * comment, draws a "rules changed" break on the trend chart.
 */
export function SignalsGuide() {
  const t = useT();
  return (
    <PageGuide>
      <GuideSection title={t("signals.guide.about.title")}><p>{t("signals.guide.about.body")}</p></GuideSection>
      <GuideSection title={t("signals.guide.scenarios.title")}>
        {(["a", "b", "c", "sum"] as const).map((k) => <p key={k}>{t(`signals.guide.scenarios.${k}`)}</p>)}
      </GuideSection>
      <GuideSection title={t("signals.guide.probability.title")}><p>{t("signals.guide.probability.body")}</p></GuideSection>
      <GuideSection title={t("signals.guide.table.title")}>
        {TABLE_LINES.map((k) => <p key={k}>{t(`signals.guide.table.${k}`)}</p>)}
      </GuideSection>
      <GuideSection title={t("signals.guide.rulesTitle")}>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {RULES.map((id) => <li key={id}>{t(`signals.guide.rules.${id}` as MessageKey)}</li>)}
        </ul>
      </GuideSection>
      <GuideSection title={t("signals.guide.trend.title")}><p>{t("signals.guide.trend.body")}</p></GuideSection>
      <GuideSection title={t("signals.guide.manual.title")}><p>{t("signals.guide.manual.body")}</p></GuideSection>
      <GuideSection title={t("signals.guide.schedule.title")}><p>{t("signals.guide.schedule.body")}</p></GuideSection>
    </PageGuide>
  );
}
