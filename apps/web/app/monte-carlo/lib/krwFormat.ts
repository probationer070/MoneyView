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
