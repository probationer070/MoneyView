import { englishTr, type Tr } from "../cases/caseFields";

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function pct2(value: number) {
  return `${value.toFixed(2)}%`;
}

export function numberText(value: number) {
  return value.toFixed(1);
}

export function numberText2(value: number) {
  return value.toFixed(2);
}

export function moneyText(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

export function betaInterpretation(beta: number, t: Tr = englishTr) {
  if (beta === 1) return t("corporate.calc.beta.one");
  if (beta > 1) return t("corporate.calc.beta.above", { beta: numberText2(beta), pct: numberText((beta - 1) * 100) });
  return t("corporate.calc.beta.below", { beta: numberText2(beta), pct: numberText((1 - beta) * 100) });
}
