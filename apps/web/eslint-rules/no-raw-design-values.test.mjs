import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "./no-raw-design-values.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-raw-design-values", rule, {
  valid: [
    'const a = <div className="bg-[var(--bg-surface)] type-caption rounded-[var(--radius-sm)] rounded-full shadow-[var(--shadow-modal)]" />;',
    'const note = "Values are rounded to two decimals and drawn without a shadow";',
    'const s = { stroke: "var(--chart-grid)" };',
    'const t = "text-transparent";',
    'const s = { fontSize: tokens.type.caption._ };',
    'const a = "Issue #123";',
    'const a = "/x#add-form";',
    'const a = "see #bad idea";',
  ],
  invalid: [
    { code: 'const a = <div className="bg-amber-50" />;', errors: [{ messageId: "paletteClass" }] },
    { code: 'const TONE = { error: "text-red-600" };', errors: [{ messageId: "paletteClass" }] },
    { code: 'const a = <div className="hover:text-white/85" />;', errors: [{ messageId: "paletteClass" }] },
    { code: 'const a = <div className="text-xs" />;', errors: [{ messageId: "typeScale" }] },
    { code: 'const a = <div className="text-[11px]" />;', errors: [{ messageId: "arbitraryPx" }] },
    { code: 'const a = <div className="text-[length:var(--type-caption)]" />;', errors: [{ messageId: "lengthTypeVar" }] },
    { code: 'const a = <div className="shadow-lg rounded-md" />;', errors: [{ messageId: "rawShadow" }, { messageId: "rawRadius" }] },
    { code: 'const a = clsx("p-2", ok && "rounded");', errors: [{ messageId: "rawRadius" }] },
    { code: 'const a = cn(base, "rounded");', errors: [{ messageId: "rawRadius" }] },
    { code: 'const x = { className: "shadow" };', errors: [{ messageId: "rawShadow" }] },
    { code: 'const classes = "rounded";', errors: [{ messageId: "rawRadius" }] },
    { code: 'const c = "#39F1C0";', errors: [{ messageId: "hex" }] },
    { code: 'const c = "#fff";', errors: [{ messageId: "hex" }] },
    { code: 'const a = "bg-[#fff]";', errors: [{ messageId: "hex" }] },
    { code: 'const s = { color: "#abcd" };', errors: [{ messageId: "hex" }] },
    { code: 'const css = "fill: #fff;";', errors: [{ messageId: "hex" }] },
    { code: 'const c = `rgba(0, 0, 0, ${a})`;', errors: [{ messageId: "colorFn" }] },
    { code: 'const s = { fontSize: 11 };', errors: [{ messageId: "numericFontSize" }] },
  ],
});
