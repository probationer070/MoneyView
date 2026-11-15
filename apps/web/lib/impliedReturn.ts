import { en, type Messages } from "@/lib/i18n/messages/en";
import { ko } from "@/lib/i18n/messages/ko";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locale";
import { englishTr, type Tr } from "@/app/cases/caseFields";

/**
 * Reader wording for `implied_return_refusal` (packages/core_finance/expected_return.py,
 * IMPLIED_RETURN_REFUSAL_CODES). The backend owns the vocabulary: an unrecognised code is
 * shown as sent rather than hidden, so a code added there still reaches the reader. The
 * sentences live in `valuation.refusal` in the message catalogs.
 */
const CATALOGS: Record<Locale, Messages> = { en, ko };

/** The catalog translator for a locale: what the functions use when no translator is passed. */
function localeTr(locale: Locale): Tr {
  return (key, params) => translate(CATALOGS[locale], key, params);
}

/** An explicit translator wins over the locale; the default keeps the locale's catalog. */
function resolveTr(locale: Locale, t: Tr): Tr {
  return t === englishTr ? localeTr(locale) : t;
}

function refusalTextWith(code: string, t: Tr): string | null {
  const key = `valuation.refusal.${code}`;
  const text = t(key as MessageKey);
  return text === key ? null : text;
}

/** The reader wording for a code the catalogs know, or null (callers then use the server's message). */
export function knownRefusalText(code: string, locale: Locale = "en"): string | null {
  return refusalTextWith(code, localeTr(locale));
}

export function impliedReturnRefusalText(code: string | null, locale: Locale = "en", t: Tr = englishTr): string {
  const tr = resolveTr(locale, t);
  if (code === null) return tr("impliedReturn.notRecorded");
  return refusalTextWith(code, tr) ?? code;
}
