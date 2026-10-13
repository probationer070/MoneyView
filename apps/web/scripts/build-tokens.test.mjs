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

test("generated vars equal the pre-migration globals.css", () => {
  const baseline = JSON.parse(readFileSync(new URL("./__fixtures__/globals-root-vars.baseline.json", import.meta.url)));
  const tokens = JSON.parse(readFileSync(PATHS.source, "utf8"));
  const generated = parseRootVars(renderCss(resolve(flatten(tokens)), []));
  const norm = (v) => (/^#[0-9a-f]+$/i.test(v) ? v.toLowerCase() : v.replace(/\s+/g, " "));
  for (const [name, value] of Object.entries(baseline)) {
    assert.ok(name in generated, `${name} is missing from the token file`);
    assert.equal(norm(generated[name]), norm(value), `${name} changed value`);
  }
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
