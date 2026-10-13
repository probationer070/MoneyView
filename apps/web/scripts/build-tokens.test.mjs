import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PATHS, cssName, emitted, flatten, parseRootVars, renderCss, renderTs, resolve, sameText, spliceDoc,
} from "./build-tokens.mjs";

const tree = {
  palette: { red: { 500: { $type: "color", $value: "#E54545" } } },
  state: { positive: { $type: "color", $value: "{palette.red.500}" } },
  delta: { up: { $type: "color", $value: "{state.positive}", $deprecated: "use state.positive" } },
  radius: { _: { $value: "0.5rem" }, sm: { $value: "4px" } },
  type: { caption: { _: { $value: "11px", $extensions: { "moneyview.theme": "--text-caption" } } } },
};

test("references resolve through chains and primitives are not emitted", () => {
  const resolved = resolve(flatten(tree));
  assert.equal(resolved.get("delta.up").value, "#E54545");
  assert.deepEqual(emitted(resolved).map((t) => cssName(t.path)),
    ["--state-positive", "--delta-up", "--radius", "--radius-sm", "--type-caption"]);
});

test("unknown references and cycles are refused", () => {
  assert.throws(() => resolve(flatten({ a: { $value: "{nope}" } })), /unknown token reference \{nope\}/);
  assert.throws(() => resolve(flatten({ a: { $value: "{b}" }, b: { $value: "{a}" } })), /cycle/);
});

test("css has the root vars, the reset block and the theme mapping", () => {
  const css = renderCss(resolve(flatten(tree)), ["--color-*"]);
  assert.equal(parseRootVars(css)["--radius"], "0.5rem");
  assert.match(css, /@theme \{\n {2}--color-\*: initial;\n\}/);
  assert.match(css, /@theme inline \{\n {2}--text-caption: var\(--type-caption\);\n\}/);
});

test("ts output nests values and keeps a group's own value under _", () => {
  assert.match(renderTs(resolve(flatten(tree))), /"radius": \{\n\s+"_": "0.5rem",\n\s+"sm": "4px"/);
});

test("check treats CRLF and LF as equal", () => {
  assert.ok(sameText("a\r\nb\r\n", "a\nb\n"));
  assert.ok(!sameText("a\nb\n", "a\nc\n"));
});

test("splice refuses a doc without markers", () => {
  assert.throws(() => spliceDoc("no markers", "| t |"), /markers/);
});

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const oklab = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const [l, m, s] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const source = () => JSON.parse(readFileSync(PATHS.source, "utf8"));
const design = () => JSON.parse(readFileSync(PATHS.redesign, "utf8"));

test("paper values equal the redesign's tokens.json", () => {
  const css = parseRootVars(renderCss(resolve(flatten(source())), []));
  const d = design();
  const colours = Object.fromEntries(d.color.tokens.map((t) => [t.name, t.value.paper]));
  const paper = (name) => { const ref = /^\{(.+)\}$/.exec(colours[name]); return ref ? paper(ref[1]) : colours[name]; };
  const expected = {};
  for (const name of Object.keys(colours)) expected[`--${name}`] = paper(name);
  for (const group of ["spacing", "radius", "breakpoint", "layout"]) for (const t of d[group].tokens) expected[`--${t.name}`] = t.value;
  for (const g of d.type.groups) for (const s of g.styles) {
    expected[`--type-${s.name}`] = s.fontSize;
    expected[`--type-${s.name}-line-height`] = s.lineHeight;
    expected[`--type-${s.name}-weight`] = String(s.fontWeight);
    expected[`--type-${s.name}-tracking`] = s.letterSpacing ?? "0";
    expected[`--type-${s.name}-family`] = css[`--font-family-${g.family}`];
  }
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(String(css[name]).toLowerCase(), String(value).toLowerCase(), `${name}`);
  }
});

test("no value that exists only in the void theme is carried", () => {
  const tokens = design().color.tokens;
  const paperValues = new Set(tokens.map((t) => t.value.paper.toLowerCase()));
  const voidOnly = tokens.map((t) => t.value.void.toLowerCase()).filter((v) => v.startsWith("#") && !paperValues.has(v));
  const file = readFileSync(PATHS.source, "utf8").toLowerCase();
  assert.deepEqual(voidOnly.filter((v) => file.includes(v)), []);
});

test("every semantic colour is a reference into palette, never a literal", () => {
  const exempt = new Set(["palette", "overlay"]); // overlay.scrim is a palette colour with alpha
  const literal = [...flatten(source()).values()]
    .filter((t) => !exempt.has(t.path[0]) && typeof t.value === "string" && /^(#|rgba?\(|oklch\()/.test(t.value));
  assert.deepEqual(literal.map((t) => t.path.join(".")), []);
});

test("text reaches 4.5:1 and chart series 3:1 on every ground; series stay apart", () => {
  const r = resolve(flatten(source()));
  const v = (id) => r.get(id).value;
  const grounds = ["bg._", "surface._", "surface.raised"].map(v);
  for (const id of ["ink._", "ink.secondary", "ink.muted", "brand.text", "up._", "down._", "status.error.ink", "status.warning.ink", "status.success.ink"]) {
    for (const g of grounds) assert.ok(contrast(hex(v(id)), hex(g)) >= 4.5, `${id} on ${g}`);
  }
  for (const tone of ["error", "warning", "success"]) {
    assert.ok(contrast(hex(v(`status.${tone}.ink`)), hex(v(`status.${tone}.surface`))) >= 4.5, `status.${tone} ink on its surface`);
  }
  assert.ok(contrast(hex(v("on.brand")), hex(v("brand._"))) >= 4.5, "on-brand on brand");
  const series = [1, 2, 3, 4, 5].map((i) => v(`chart.${i}`));
  for (const s of series) for (const g of grounds) assert.ok(contrast(hex(s), hex(g)) >= 3, `${s} on ${g}`);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const [a, b] = [oklab(hex(series[i])), oklab(hex(series[j]))];
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 0.08, `chart ${i + 1} and ${j + 1} are too close`);
  }
});

test("app type styles have a type-* utility, landing styles do not, every style is complete", () => {
  const flat = flatten(source());
  const styles = new Set([...flat.values()].filter((t) => t.path[0] === "type" && t.path.length === 3).map((t) => t.path[1]));
  const APP = ["heading-5", "panel-title", "body", "label", "small", "figure", "figure-md", "mono-link", "mono", "caption"];
  assert.equal(styles.size, 17);
  for (const s of styles) {
    for (const leaf of ["_", "line-height", "weight", "tracking", "family"]) assert.ok(flat.has(`type.${s}.${leaf}`), `type.${s}.${leaf} missing`);
    assert.equal(flat.get(`type.${s}._`).utility?.[0] ?? null, APP.includes(s) ? `type-${s}` : null, `type.${s} utility`);
  }
});

test("every pre-migration variable still resolves until Task 14 removes the aliases", () => {
  const baseline = JSON.parse(readFileSync(new URL("./__fixtures__/globals-root-vars.baseline.json", import.meta.url)));
  const generated = parseRootVars(renderCss(resolve(flatten(source())), []));
  const removed = new Set(["--space-7"]); // 0 references (counted 2026-10-13)
  assert.deepEqual(Object.keys(baseline).filter((n) => !removed.has(n) && !(n in generated)), []);
});

test("utility groups render one @utility with a declaration per leaf", () => {
  const t = {
    font: { $value: "serif" },
    type: { body: { $extensions: { "moneyview.utility": "type-body" }, _: { $value: "15px" }, "line-height": { $value: "24px" }, family: { $value: "{font}" } } },
  };
  assert.match(renderCss(resolve(flatten(t)), []),
    /@utility type-body \{\n {2}font-size: var\(--type-body\);\n {2}line-height: var\(--type-body-line-height\);\n {2}font-family: var\(--type-body-family\);\n\}/);
});

test("deprecated tokens carry the marker the lint rule reads", () => {
  const t = { ink: { $value: "#282828" }, text: { primary: { $value: "{ink}", $deprecated: "use --ink" } } };
  assert.match(renderCss(resolve(flatten(t)), []), /--text-primary: #282828; \/\* deprecated: use --ink \*\//);
});

test("breakpoint theme keys are emitted as literal values", () => {
  const t = { bp: { desktop: { $value: "992px", $extensions: { "moneyview.theme": "--breakpoint-lg" } } } };
  const css = renderCss(resolve(flatten(t)), []);
  assert.match(css, /@theme \{\n {2}--breakpoint-lg: 992px;\n\}/);
  assert.doesNotMatch(css, /--breakpoint-lg: var\(/);
});

test("flatten skips $-prefixed keys such as $meta", () => {
  assert.deepEqual([...flatten({ $meta: { $value: "1" }, a: { $value: "2" } }).keys()], ["a"]);
});

const SCRIPT = fileURLToPath(new URL("./build-tokens.mjs", import.meta.url));
const DOC = "# Tokens\n\n<!-- tokens:generated:start -->\n<!-- tokens:generated:end -->\n";

// A throwaway copy of the apps/web and docs layout, so the generator's real paths can be exercised.
function sandbox(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "build-tokens-"));
  try {
    const web = path.join(root, "apps/web");
    for (const dir of ["scripts", "tokens", "app", "lib"]) mkdirSync(path.join(web, dir), { recursive: true });
    mkdirSync(path.join(root, "docs/design"), { recursive: true });
    copyFileSync(SCRIPT, path.join(web, "scripts/build-tokens.mjs"));
    writeFileSync(path.join(web, "tokens/moneyview.tokens.json"),
      JSON.stringify({ ...tree, $extensions: { "moneyview.themeReset": ["--color-*"] } }, null, 2));
    writeFileSync(path.join(root, "docs/design/MoneyView_Design_Tokens.md"), DOC);
    const run = (...args) => spawnSync(process.execPath, [path.join(web, "scripts/build-tokens.mjs"), ...args], { encoding: "utf8" });
    return fn({ web, root, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("generator writes the reset, theme and doc outputs, and check accepts them", () => sandbox(({ web, root, run }) => {
  assert.equal(run().status, 0);
  const cssPath = path.join(web, "app/tokens.generated.css");
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /@theme \{\n {2}--color-\*: initial;\n\}/);
  assert.match(css, /@theme inline \{\n {2}--text-caption: var\(--type-caption\);\n\}/);
  assert.match(readFileSync(path.join(root, "docs/design/MoneyView_Design_Tokens.md"), "utf8"),
    /\| `type\.caption` \| `--type-caption` \| `11px` \|/);
  assert.equal(run("--check").status, 0);
  // Git on Windows (core.autocrlf) checks files out with CRLF; check must still pass.
  writeFileSync(cssPath, css.replace(/\n/g, "\r\n"));
  assert.equal(run("--check").status, 0);
}));

test("check fails and names a hand-edited generated file", () => sandbox(({ web, run }) => {
  assert.equal(run().status, 0);
  const cssPath = path.join(web, "app/tokens.generated.css");
  writeFileSync(cssPath, readFileSync(cssPath, "utf8") + "/* hand edit */\n");
  const stale = run("--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /app[\\/]tokens\.generated\.css/);
}));

test("globals.css imports tailwind first, then the generated tokens", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const tailwind = css.indexOf('@import "tailwindcss";');
  const tokens = css.indexOf('@import "./tokens.generated.css";');
  assert.ok(tailwind >= 0 && tokens > tailwind, "tokens import must follow the tailwind import");
});

test("the real token file maps the font families into @theme inline", () => {
  const tokens = JSON.parse(readFileSync(PATHS.source, "utf8"));
  const css = renderCss(resolve(flatten(tokens)), []);
  assert.match(css, /@theme inline \{[^}]*\n {2}--font-sans: var\(--font-family-sans\);/);
  assert.match(css, /@theme inline \{[^}]*\n {2}--font-mono: var\(--font-family-mono\);/);
});

test("deprecated strokes and marks (accent, chart, delta, state) keep 3:1 on the page ground", () => {
  const resolved = resolve(flatten(source()));
  const ground = hex(resolved.get("bg._").value);
  const aliases = [...resolved.values()].filter((t) => t.deprecated
    && (["accent", "delta", "state"].includes(t.path[0]) || (t.path[0] === "chart" && t.path[1] !== "grid")));
  assert.ok(aliases.length > 0);
  for (const t of aliases) {
    const value = t.value;
    assert.ok(/^#[0-9a-f]{6}$/i.test(value), `${t.path.join(".")} resolves to ${value}`);
    assert.ok(contrast(hex(value), ground) >= 3, `${t.path.join(".")} ${value} is ${contrast(hex(value), ground).toFixed(2)}:1 on the ground`);
  }
});
