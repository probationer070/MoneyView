import { en, type Messages } from "@/lib/i18n/messages/en";
import { ko } from "@/lib/i18n/messages/ko";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Reader wording for `implied_return_refusal` (packages/core_finance/expected_return.py,
 * IMPLIED_RETURN_REFUSAL_CODES). The backend owns the vocabulary: an unrecognised code is
 * shown as sent rather than hidden, so a code added there still reaches the reader. The
 * sentences live in `valuation.refusal` in the message catalogs.
 */
const CATALOGS: Record<Locale, Messages> = { en, ko };

/** A snapshot from before metric v3 recorded no implied return. Not a refusal. */
export const IMPLIED_RETURN_NOT_RECORDED = "Not recorded before metric v3.";

/** The reader wording for a code the catalogs know, or null (callers then use the server's message). */
export function knownRefusalText(code: string, locale: Locale = "en"): string | null {
  const key = `valuation.refusal.${code}`;
  const text = translate(CATALOGS[locale], key as MessageKey);
  return text === key ? null : text;
}

export function impliedReturnRefusalText(code: string | null, locale: Locale = "en"): string {
  if (code === null) return IMPLIED_RETURN_NOT_RECORDED;
  return knownRefusalText(code, locale) ?? code;
}
