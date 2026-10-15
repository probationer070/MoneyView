import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RuleTester } from "eslint";
import rule from "./no-raw-design-values.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { moneyview: { tokensCss: fileURLToPath(new URL("./__fixtures__/tokens.css", import.meta.url)) } },
});

tester.run("no-raw-design-values", rule, {
  valid: [
    'const a = <div className="bg-[var(--bg-surface)] type-caption rounded-[var(--radius-sm)] shadow-[var(--shadow-modal)]" />;',
    'const note = "Values are rounded to two decimals and drawn without a shadow";',
    'const s = { stroke: "var(--chart-grid)" };',
    'const t = "text-transparent";',
    'const s = { fontSize: tokens.type.caption._ };',
    'const a = "Issue #123";',
    'const a = "/x#add-form";',
    'const a = "see #bad idea";',
    'const a = <main className="pt-[var(--main-pad-top)] [--main-pad-top:5rem]" />;',
    'const f = "var(--font-pretendard)";',
    'const s = { stroke: "var(--fixture-only)" };',
    'const t = "var(--tw-ring-offset-width)";',
    'const s = { fill: "var(--bg-surface, var(--fixture-only))" };',
  ],
  invalid: [
    { code: 'const s = { fill: "var(--bg-muted)" };', errors: [{ messageId: "unknownVar" }] },
    { code: 'const a = <div className="bg-[var(--surface)]" />;', errors: [{ messageId: "unknownVar" }] },
    { code: 'const s = { fill: "var(--bg-muted, 4px)" };', errors: [{ messageId: "unknownVar" }] },
    { code: 'const s = { fill: "var(--fixture-only, var(--chart-old))" };', errors: [{ messageId: "unknownVar" }] },
    { code: 'const s = { fill: "var(--bg-muted, var(--chart-old))" };', errors: [{ messageId: "unknownVar" }, { messageId: "unknownVar" }] },
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
    { code: 'const f = "var(--font-pretendrad)";', errors: [{ messageId: "unknownVar" }] },
    { code: 'const f = "var(--font-inter)";', errors: [{ messageId: "unknownVar" }] },
    { code: 'const f = "var(--font-pretendard-old)";', errors: [{ messageId: "unknownVar" }] },
    { code: 'const a = <div className="bg-[var(--old-alias)]" />;', errors: [{ messageId: "deprecatedVar" }] },
  ],
});

// Without the setting, the rule reads the generated token CSS: the real names pass and the real bug is caught.
const liveTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
});

liveTester.run("no-raw-design-values (default token file)", rule, {
  valid: ['const s = { fill: "var(--surface-raised)" };'],
  invalid: [{ code: 'const s = { fill: "var(--bg-muted)" };', errors: [{ messageId: "unknownVar" }] }],
});

// Task 14a: radius, weight, brand and figure rules.
tester.run("no-raw-design-values (14a: radius, weight, brand, figures)", rule, {
  valid: [
    // rounded-full: an exemption comment on the previous line, or on the same line.
    'const a = (\n  <div>\n    {/* rounded-full: dot */}\n    <span className="h-2 w-2 rounded-full" />\n  </div>\n);',
    'const a = <span className="h-2 w-2 rounded-full" />; // rounded-full: track',
    'const a = (\n  <div>\n    {/* rounded-full: spinner */}\n    <span\n      aria-hidden\n      className="h-3 w-3 rounded-full"\n    />\n  </div>\n);',
    'const a = <div className="rounded-[var(--radius-2)] border" />;',
    'const note = "a rounded-full pill";',
    // font weight: a justification comment, or no weight class at all.
    'const a = <p>Total {/* M2: inline emphasis; the weight separates the label from the text */}<span className="font-semibold">x</span></p>;',
    'const a = (\n  <div>\n    {/* M2: snapshot title differs from the body style */}\n    <p className="font-bold">x</p>\n  </div>\n);',
    'const a = <p className="type-body font-mono font-normal">x</p>;',
    'const s = "font-bold is not allowed here";',
    // brand ground: with on-brand ink, with no children, in a pseudo-element, with a soft hover, in a tone table.
    'const a = <button className="bg-[var(--brand)] text-[var(--on-brand)]">Go</button>;',
    'const a = <button className={clsx("bg-[var(--brand)]", disabled && "opacity-50", "text-[var(--on-brand)]")}>Go</button>;',
    'const a = <div className="h-1 bg-[var(--brand)]" />;',
    'const a = <span className="w-1 bg-[var(--brand)]"></span>;',
    'const a = <a className="after:bg-[var(--brand)]">Tab</a>;',
    'const a = <a className="hover:bg-[var(--brand-soft)] text-[var(--ink)]">Go</a>;',
    'const TONE = { dot: "bg-[var(--brand)]" };',
    'const a = <Icon className="text-[var(--brand-text)]" />;',
    // figures: mono on the element or an ancestor; prose; components; an unreadable className; other attributes and formatters.
    'const a = <td className="type-mono">{formatNumber(v, "integer")}</td>;',
    'const a = <p className="type-figure-md">{formatNumber(v, "percent")}</p>;',
    'const a = <td className="type-mono"><span>{formatNumber(v)}</span></td>;',
    'const a = <p className="type-body">Total {formatNumber(v)} draws</p>;',
    'const a = <Cell>{formatNumber(v)}</Cell>;',
    'const a = <td className={cellClass}>{formatNumber(v)}</td>;',
    'const a = <td className="type-body">{formatDate(v)}</td>;',
    'const a = <Delta value={formatNumber(v)} />;',
  ],
  invalid: [
    { code: 'const a = <span className="h-2 w-2 rounded-full" />;', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = <span className="md:rounded-full" />;', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = clsx("p-2", ok && "rounded-full");', errors: [{ messageId: "roundedFull" }] },
    // The comment must name dot, track, fill or spinner, and sit within one line of the opening tag.
    { code: 'const a = (\n  <div>\n    {/* rounded-full: chip */}\n    <span className="rounded-full" />\n  </div>\n);', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = (\n  <div>\n    {/* rounded-full: a colour-key dot */}\n    <span className="rounded-full" />\n  </div>\n);', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = (\n  <div>\n    {/* rounded-full: dot */}\n\n    <span className="rounded-full" />\n  </div>\n);', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = <p className="font-bold">x</p>;', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = <p className="md:font-medium">x</p>;', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = clsx("p-2", ok && "font-black");', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = <p className="font-extrabold">x</p>;', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = (\n  <div>\n    {/* bold on purpose */}\n    <p className="font-bold">x</p>\n  </div>\n);', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = (\n  <div>\n    {/* M2: */}\n    <p className="font-bold">x</p>\n  </div>\n);', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = <button className="bg-[var(--brand)] text-[var(--ink)]">Go</button>;', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = <button className="bg-[var(--brand)]">Go</button>;', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = clsx("bg-[var(--brand)]", "px-2");', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = { className: "bg-[var(--brand)] px-2" };', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = <button className="hover:bg-[var(--brand)]">Go</button>;', errors: [{ messageId: "brandHover" }] },
    { code: 'const a = <button className="bg-[var(--brand-soft)] hover:bg-[var(--brand)] text-[var(--ink)]">Go</button>;', errors: [{ messageId: "brandHover" }] },
    { code: 'const a = <button className="focus-visible:bg-[var(--brand)] text-[var(--on-brand)]">Go</button>;', errors: [{ messageId: "brandHover" }] },
    { code: 'const a = <Icon className="text-[var(--brand)]" />;', errors: [{ messageId: "brandText" }] },
    { code: 'const a = <a className="hover:text-[var(--brand)]">Go</a>;', errors: [{ messageId: "brandText" }] },
    { code: 'const c = "text-[var(--brand)]";', errors: [{ messageId: "brandText" }] },
    { code: 'const a = <td className="type-body tabular-nums">{formatNumber(v, "integer")}</td>;', errors: [{ messageId: "figureMono" }] },
    { code: 'const a = <span>{formatNumber(v)}</span>;', errors: [{ messageId: "figureMono" }] },
    { code: 'const a = <p className="type-body">{v >= 0 ? "+" : ""}{formatNumber(v)}</p>;', errors: [{ messageId: "figureMono" }] },
    { code: 'const a = <span className="type-small">{v == null ? "—" : formatNumber(v)}</span>;', errors: [{ messageId: "figureMono" }] },
  ],
});
