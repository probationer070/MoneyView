import { formatNumber, MISSING, type FormatLocale } from "@/lib/format";

// Monte Carlo amounts are won. en shows millions (KRW 9.64M); ko shows 만원 and 억 (964만원, 1억 2,345만원).
const MAN_WON = 10_000;
const MILLION_WON = 1_000_000;
const EOK_MAN = 10_000;

// Rounds to whole won, half away from zero, on the magnitude. The unit branch is chosen on this rounded value.
export function formatKrwCompact(value: number | null | undefined, locale: FormatLocale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  const won = Math.round(Math.abs(value));
  const sign = value < 0 && won > 0 ? "-" : "";

  if (locale === "en") {
    if (won < MILLION_WON) return `${sign}KRW ${formatNumber(won, "integer", { locale })}`;
    const hundredths = Math.round(won / 10_000);
    const whole = formatNumber(Math.floor(hundredths / 100), "integer", { locale });
    return `${sign}KRW ${whole}.${String(hundredths % 100).padStart(2, "0")}M`;
  }

  if (won < MAN_WON) return `${sign}${formatNumber(won, "integer", { locale })}원`;
  const man = Math.round(won / MAN_WON);
  const eok = Math.floor(man / EOK_MAN);
  const rest = man % EOK_MAN;
  if (rest === 0) return `${sign}${formatNumber(eok, "integer", { locale })}억원`;
  if (eok > 0) return `${sign}${formatNumber(eok, "integer", { locale })}억 ${formatNumber(rest, "integer", { locale })}만원`;
  return `${sign}${formatNumber(man, "integer", { locale })}만원`;
}

export type KrwAxis = {
  divisor: 1_000_000 | 10_000;
  tick: (won: number) => string;
  unitKey: "monteCarlo.units.krwAxis";
};

// Chart data stays in won; only the tick labels change unit. The axis title (unitKey) carries the unit.
export function krwAxis(locale: FormatLocale): KrwAxis {
  if (locale === "en") {
    return {
      divisor: MILLION_WON,
      tick: (won) => formatNumber(won / MILLION_WON, "ratio", { digits: 1, locale }),
      unitKey: "monteCarlo.units.krwAxis",
    };
  }
  return {
    divisor: MAN_WON,
    tick: (won) => formatNumber(Math.round(won / MAN_WON), "integer", { locale }),
    unitKey: "monteCarlo.units.krwAxis",
  };
}

// Whole won, half away from zero, same rule as formatKrwCompact. A value that rounds to zero is 0, never -0.
function wholeWon(value: number): number {
  const won = Math.round(Math.abs(value));
  return value < 0 && won > 0 ? -won : won;
}

// Per-share price (whole won). en: KRW 50,000; ko: 50,000원 (owner decision D8).
// The sign goes first, like formatKrwCompact: -KRW 5,000 / -5,000원; a value that rounds to zero has no sign.
export function krw(value: number, locale: FormatLocale): string {
  if (!Number.isFinite(value)) return MISSING;
  const won = wholeWon(value);
  const sign = won < 0 ? "-" : "";
  const amount = formatNumber(Math.abs(won), "integer", { locale });
  return locale === "en" ? `${sign}KRW ${amount}` : `${sign}${amount}원`;
}

// A won interval: one prefix (en) or one suffix (ko), joined by an en dash. Either side not finite reads a dash.
// Each end carries its own sign (KRW -5,000–-3,000); an end that rounds to zero reads 0, never -0.
export function formatKrwRange(lo: number | null, hi: number | null, locale: FormatLocale): string {
  if (lo === null || hi === null || !Number.isFinite(lo) || !Number.isFinite(hi)) return MISSING;
  const from = formatNumber(wholeWon(lo), "integer", { locale });
  const to = formatNumber(wholeWon(hi), "integer", { locale });
  return locale === "en" ? `KRW ${from}–${to}` : `${from}–${to}원`;
}
