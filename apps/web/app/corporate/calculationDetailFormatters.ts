import { englishTr, type Tr } from "../cases/caseFields";
import { numberText, numberText2 } from "./corporateUtils";

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export { moneyText, numberText, numberText2, pct, pct2 } from "./corporateUtils";

export function betaInterpretation(beta: number, t: Tr = englishTr) {
  if (beta === 1) return t("corporate.calc.beta.one");
  if (beta > 1) return t("corporate.calc.beta.above", { beta: numberText2(beta), pct: numberText((beta - 1) * 100) });
  return t("corporate.calc.beta.below", { beta: numberText2(beta), pct: numberText((1 - beta) * 100) });
}
