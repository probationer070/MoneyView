// Drift counts per category, from the lint rule itself so the baseline and the gate agree.
import { ESLint } from "eslint";

const DEFAULT = ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"];
const patterns = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const results = await new ESLint().lintFiles(patterns);
const counts = {};
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId === "moneyview/no-raw-design-values") counts[message.messageId] = (counts[message.messageId] ?? 0) + 1;
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ ...counts, total }, null, 2));
