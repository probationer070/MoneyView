import type { Tr } from "../cases/caseFields";

export interface BasisLabelInput {
  growthFallback: boolean;
  roicFallback: boolean;
  roicBasis: "recent_average" | "all_year_average" | "annual";
  roicYear: string;
  lastRoicYear?: number;
  /** True when the annual ROIC basis has no value for the selected year. */
  roicYearMissing: boolean;
}

export interface BasisLabels {
  roicYearUnavailableMessage: string;
  growthBasisLabel: string;
  roicBasisLabel: string;
  sourceLabel: string;
}

export function basisLabels(t: Tr, input: BasisLabelInput): BasisLabels {
  const { growthFallback, roicFallback, roicBasis, roicYear, lastRoicYear, roicYearMissing } = input;
  const year = `${roicYear || lastRoicYear || ""}`;
  return {
    roicYearUnavailableMessage: roicYearMissing ? t("corporate.calc.basis.roicUnavailable", { year: roicYear }) : "",
    growthBasisLabel: growthFallback ? t("corporate.calc.basis.growthFallback") : t("corporate.calc.basis.growthStable"),
    roicBasisLabel: roicBasis === "recent_average"
      ? t("corporate.calc.basis.roicRecent")
      : roicBasis === "all_year_average"
        ? t("corporate.calc.basis.roicAll")
        : t("corporate.calc.basis.roicAnnual", { year }).trim(),
    sourceLabel: [
      growthFallback ? t("corporate.calc.basis.sourceGrowthFallback") : t("corporate.calc.basis.sourceGrowthStable"),
      roicFallback ? t("corporate.calc.basis.sourceRoicFallback") : t("corporate.calc.basis.sourceRoicStable"),
      t("corporate.calc.basis.sourceOverrides"),
    ].join(" "),
  };
}
