/**
 * Always-bilingual small labels (eyebrows, table headers): Korean first, English second, both
 * shown in every locale (the redesign's "시장 MARKET"). Korean terms follow
 * docs/design/MoneyView_Glossary.md; English is stored in plain case and uppercased by CSS.
 */
export const LABELS = {
  market: ["시장", "Market"],
  name: ["종목", "Name"],
  price: ["현재가", "Price"],
} as const satisfies Record<string, readonly [string, string]>;

export type LabelKey = keyof typeof LABELS;
