export function fmtMoney(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function fmtPerShare(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : "−"}${fmtPerShare(Math.abs(value))}`;
}
