import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawDesignValues from "./eslint-rules/no-raw-design-values.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    ignores: ["lib/tokens.generated.ts"],
    plugins: { moneyview: { rules: { "no-raw-design-values": noRawDesignValues } } },
    rules: { "moneyview/no-raw-design-values": "error" },
  },
  // The market overview still renders the pre-paper classes and deprecated aliases. It is migrated by
  // its own one-screen plan, and DS Task 14b (docs/superpowers/plans/2026-10-12-design-system-formalization.md)
  // deletes this block so the rule is an error everywhere.
  {
    files: ["components/market/**/*.{ts,tsx}", "app/page.tsx"],
    rules: { "moneyview/no-raw-design-values": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
