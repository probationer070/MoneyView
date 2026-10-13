import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Design values must come from tokens (apps/web/tokens/moneyview.tokens.json).
 *
 * Colour and type-scale checks run on every string: a palette class in a lookup table is as
 * raw as one in className. Shadow and radius checks run only in class contexts, because
 * "rounded" and "shadow" are ordinary English words in UI copy.
 */
const DEFAULT_TOKENS_CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/tokens.generated.css");
// Custom properties that legitimately live outside the token file: next/font families,
// Tailwind internals, and AppShell's locally scoped padding.
const LOCAL_VAR = /^--(?:font-|tw-|main-pad-)/;
const VAR_REF = /var\((--[\w-]+)/g;
const tokenCache = new Map();

/** Names defined in the generated token CSS. An undefined var() renders as nothing, silently. */
function tokenVars(file) {
  if (!tokenCache.has(file)) {
    const known = new Set();
    const deprecated = new Set();
    for (const m of readFileSync(file, "utf8").matchAll(/^\s*(--[\w-]+)\s*:[^;]*;(\s*\/\* deprecated)?/gm)) {
      known.add(m[1]);
      if (m[2]) deprecated.add(m[1]);
    }
    tokenCache.set(file, { known, deprecated });
  }
  return tokenCache.get(file);
}

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const START = String.raw`(?:^|[\s"'\x60:])`;
const END = String.raw`(?=$|[\s"'\x60])`;

const EVERYWHERE = [
  // 6- and 8-digit hex is always a colour. 3- and 4-digit hex is a colour only in a colour context:
  // the whole string, a Tailwind arbitrary value, or after a CSS colour property. Elsewhere it
  // reads as prose ("Issue #123", "see #bad idea").
  ["hex", /(?<![A-Za-z/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b/],
  ["hex", /^#[0-9a-fA-F]{3,4}$|\[#[0-9a-fA-F]{3,4}\]|(?<![A-Za-z-])(?:color|fill|stroke|background(?:-color)?|border(?:-color)?|outline(?:-color)?|caret-color|accent-color|stop-color)\s*[:=]\s*["'\x60]?#[0-9a-fA-F]{3,4}\b/],
  ["colorFn", /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/],
  ["paletteClass", new RegExp(`${START}(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|placeholder|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?${END}`)],
  ["typeScale", new RegExp(`${START}text-(?:xs|sm|base|lg|xl|[2-9]xl)${END}`)],
  ["arbitraryPx", new RegExp(`${START}text-\\[\\d+(?:\\.\\d+)?px\\]`)],
  ["lengthTypeVar", /text-\[length:var\(--type-/],
];
const CLASS_ONLY = [
  ["rawShadow", new RegExp(`${START}shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner|none))?${END}`)],
  ["rawRadius", new RegExp(`${START}rounded(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl))?${END}`)],
];
const CLASS_HELPERS = new Set(["clsx", "cn", "twMerge", "cva"]);

function inClassContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "JSXAttribute") return p.name.name === "className";
    if (p.type === "CallExpression" && p.callee.type === "Identifier" && CLASS_HELPERS.has(p.callee.name)) return true;
    if (p.type === "Property" && (p.key.name === "className" || p.key.value === "className")) return true;
    if (p.type === "VariableDeclarator") return /class(es)?$/i.test(p.id?.name ?? "");
  }
  return false;
}

const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      hex: "Raw hex colour. Use a colour token: var(--token), or tokens.* for canvas.",
      colorFn: "Raw colour function. Use a colour token.",
      paletteClass: "Tailwind palette class. Use a colour token: bg-[var(--token)].",
      typeScale: "Tailwind type scale. Use a type utility: type-body, type-small, type-caption, ...",
      arbitraryPx: "Arbitrary px font size. Use a type utility.",
      lengthTypeVar: "Old type-token form. Use the type-<style> utility, which also sets family, weight, line height and tracking.",
      rawShadow: "Tailwind shadow. MoneyView has no shadows: use border border-[var(--line)].",
      rawRadius: "Tailwind radius. Use rounded-[var(--radius-1|2)], no class for square, or rounded-full for dots.",
      numericFontSize: "Numeric font size. Use tokens.type.<style>._ from lib/tokens.generated.ts.",
      unknownVar: "{{name}} is not defined in app/tokens.generated.css; an undefined var() renders as nothing.",
    },
  },
  create(context) {
    const vars = tokenVars(context.settings?.moneyview?.tokensCss ?? DEFAULT_TOKENS_CSS);
    const check = (node, text) => {
      for (const [messageId, re] of EVERYWHERE) if (re.test(text)) context.report({ node, messageId });
      if (inClassContext(node)) {
        for (const [messageId, re] of CLASS_ONLY) if (re.test(text)) context.report({ node, messageId });
      }
      for (const [, name] of text.matchAll(VAR_REF)) {
        if (LOCAL_VAR.test(name)) continue;
        if (!vars.known.has(name)) context.report({ node, messageId: "unknownVar", data: { name } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      'Property[key.name="fontSize"] > Literal'(node) {
        if (typeof node.value === "number") context.report({ node, messageId: "numericFontSize" });
      },
    };
  },
};

export default rule;
