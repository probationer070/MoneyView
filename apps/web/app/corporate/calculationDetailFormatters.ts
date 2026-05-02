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

export function betaInterpretation(beta: number) {
  if (beta === 1) return "Beta 1.00 implies market-level volatility.";
  if (beta > 1) return `Beta ${numberText2(beta)} implies about ${numberText((beta - 1) * 100)}% higher volatility than the market.`;
  return `Beta ${numberText2(beta)} implies about ${numberText((1 - beta) * 100)}% lower volatility than the market.`;
}
