// Drift counts per category, from the lint rule itself so the baseline and the gate agree.
// bySeverity splits the same hits by the level eslint.config.mjs gives their file: "error" is
// everything the lock covers, "warn" is the market exception (DS Task 14b removes it).
import { ESLint } from "eslint";
import { MARKET_WARN_CAP, warnCapExceeded } from "./design-baseline-cap.mjs";

const DEFAULT = ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"];
const patterns = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const results = await new ESLint().lintFiles(patterns);
const counts = {};
const bySeverity = { error: 0, warn: 0 };
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId !== "moneyview/no-raw-design-values") continue;
    counts[message.messageId] = (counts[message.messageId] ?? 0) + 1;
    bySeverity[message.severity === 2 ? "error" : "warn"] += 1;
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ ...counts, total, bySeverity }, null, 2));
if (warnCapExceeded(bySeverity.warn)) {
  console.error(`design:baseline: ${bySeverity.warn} warnings, above the cap of ${MARKET_WARN_CAP} (scripts/design-baseline-cap.mjs).`);
  process.exitCode = 1;
}
