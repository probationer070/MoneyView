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
// Custom properties that legitimately live outside the token file: the three next/font families
// (layout.tsx), Tailwind internals, and AppShell's locally scoped padding. Any other --font-* name
// is a typo or a removed family and is reported.
const LOCAL_VAR = /^--(?:font-(?:host-grotesk|pretendard|geist-mono)$|tw-|main-pad-)/;
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
  ["brandText", new RegExp(`${START}text-\\[var\\(--brand\\)\\](?:\\/\\d+)?${END}`)],
];
const CLASS_ONLY = [
  ["rawShadow", new RegExp(`${START}shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner|none))?${END}`)],
  ["rawRadius", new RegExp(`${START}rounded(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl))?${END}`)],
];
const CLASS_HELPERS = new Set(["clsx", "cn", "twMerge", "cva"]);

// Exemptions are comments on the same line as the element's opening tag, or the line before it.
//   rounded-full:  {/* rounded-full: dot */}   (dot, track, fill or spinner)
//   font weight:   {/* M2: why the weight differs from the type style */}
const ROUNDED_FULL_OK = /\brounded-full:\s*(?:dot|track|fill|spinner)\b/;
const WEIGHT_OK = /\bM2:\s*\S/;
const WEIGHT_CLASS = /^font-(?:medium|semibold|bold|extrabold|black)$/;
const HOVER_VARIANTS = new Set(["hover", "focus", "focus-visible", "active", "group-hover", "peer-hover"]);
const PSEUDO_VARIANTS = new Set(["before", "after"]);
const MONO_CLASS = /\btype-(?:mono|figure)/;

function inClassContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "JSXAttribute") return p.name.name === "className";
    if (p.type === "CallExpression" && p.callee.type === "Identifier" && CLASS_HELPERS.has(p.callee.name)) return true;
    if (p.type === "Property" && (p.key.name === "className" || p.key.value === "className")) return true;
    if (p.type === "VariableDeclarator") return /class(es)?$/i.test(p.id?.name ?? "");
  }
  return false;
}

const classTokens = (text) => text.split(/[\s"'\x60]+/).filter(Boolean);

/** "md:hover:bg-x" -> { variants: ["md", "hover"], base: "bg-x" }. A colon inside [...] is not a separator. */
function splitVariants(token) {
  const parts = token.split(/:(?![^[]*\])/);
  return { variants: parts.slice(0, -1), base: parts[parts.length - 1] };
}

/** The node whose source holds a literal's whole class list: the className attribute, else the outermost class helper call, className property or class-named declarator. */
function classScope(node) {
  let scope = null;
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "JSXAttribute") return p.name.name === "className" ? p : scope;
    if (p.type === "CallExpression" && p.callee.type === "Identifier" && CLASS_HELPERS.has(p.callee.name)) scope = p;
    else if (p.type === "Property" && (p.key.name === "className" || p.key.value === "className")) scope = p;
    else if (p.type === "VariableDeclarator") return /class(es)?$/i.test(p.id?.name ?? "") ? p : scope;
  }
  return scope;
}

/** True for a formatNumber(...) call, also inside ?:, &&, + and template literals. */
function formatsNumber(e) {
  switch (e?.type) {
    case "CallExpression": return e.callee.type === "Identifier" && e.callee.name === "formatNumber";
    case "ConditionalExpression": return formatsNumber(e.consequent) || formatsNumber(e.alternate);
    case "LogicalExpression": return formatsNumber(e.right);
    case "BinaryExpression": return formatsNumber(e.left) || formatsNumber(e.right);
    case "TemplateLiteral": return e.expressions.some(formatsNumber);
    default: return false;
  }
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
      deprecatedVar: "{{name}} is a deprecated alias; app/tokens.generated.css names its replacement.",
      roundedFull: "rounded-full is for dots, tracks, fills and spinners. Mark one with a comment on the same or previous line, {/* rounded-full: dot */} (or track, fill, spinner), or use rounded-[var(--radius-2)] for a chip.",
      fontWeight: "A bold, semibold, medium or black weight overrides the type style. Delete it, or justify it in a comment on the same or previous line: {/* M2: <why> */}.",
      brandGround: "bg-[var(--brand)] behind text needs text-[var(--on-brand)] in the same className. A fill with no text is fine as an element without children.",
      brandHover: "A hover, focus or active ground is bg-[var(--brand-soft)], not the solid brand fill.",
      brandText: "Brand as text is --brand-text: text-[var(--brand-text)].",
      figureMono: "A figure needs type-mono (cell, row, inline) or type-figure-md / type-figure (KPI), on this element or an ancestor.",
    },
  },
  create(context) {
    const vars = tokenVars(context.settings?.moneyview?.tokensCss ?? DEFAULT_TOKENS_CSS);
    const sourceCode = context.sourceCode;
    const comments = sourceCode.getAllComments();
    const hasComment = (node, scope, re) => {
      const opening = scope?.type === "JSXAttribute" && scope.parent?.type === "JSXOpeningElement" ? scope.parent : node;
      const from = opening.loc.start.line - 1;
      const to = node.loc.end.line;
      return comments.some((c) => c.loc.end.line >= from && c.loc.start.line <= to && re.test(c.value));
    };
    // An element with no children cannot hold text, so a brand fill on it (dot, bar, marker) needs no on-brand ink.
    const hasNoChildren = (scope) => {
      const element = scope?.type === "JSXAttribute" ? scope.parent?.parent : null;
      return element?.type === "JSXElement" && element.children.every((c) =>
        (c.type === "JSXText" && c.value.trim() === "") || (c.type === "JSXExpressionContainer" && c.expression.type === "JSXEmptyExpression"));
    };
    const checkClasses = (node, text) => {
      const scope = classScope(node);
      let rounded = false, weight = false, ground = false;
      for (const token of classTokens(text)) {
        const { variants, base } = splitVariants(token);
        if (base === "rounded-full") rounded = true;
        if (WEIGHT_CLASS.test(base)) weight = true;
        if (base === "bg-[var(--brand)]") {
          if (variants.some((v) => HOVER_VARIANTS.has(v))) context.report({ node, messageId: "brandHover" });
          else if (!variants.some((v) => PSEUDO_VARIANTS.has(v))) ground = true;
        }
      }
      if (rounded && !hasComment(node, scope, ROUNDED_FULL_OK)) context.report({ node, messageId: "roundedFull" });
      if (weight && !hasComment(node, scope, WEIGHT_OK)) context.report({ node, messageId: "fontWeight" });
      if (ground && !hasNoChildren(scope) && !(scope && sourceCode.getText(scope).includes("text-[var(--on-brand)]"))) {
        context.report({ node, messageId: "brandGround" });
      }
    };
    const check = (node, text) => {
      for (const [messageId, re] of EVERYWHERE) if (re.test(text)) context.report({ node, messageId });
      if (inClassContext(node)) {
        for (const [messageId, re] of CLASS_ONLY) if (re.test(text)) context.report({ node, messageId });
        checkClasses(node, text);
      }
      for (const [, name] of text.matchAll(VAR_REF)) {
        if (LOCAL_VAR.test(name)) continue;
        if (!vars.known.has(name)) context.report({ node, messageId: "unknownVar", data: { name } });
        else if (vars.deprecated.has(name)) context.report({ node, messageId: "deprecatedVar", data: { name } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      // <td>{formatNumber(...)}</td>: an element whose only content is a figure must set it in mono.
      JSXExpressionContainer(node) {
        const element = node.parent;
        if (element.type !== "JSXElement" || !formatsNumber(node.expression)) return;
        const tag = element.openingElement.name;
        if (tag.type !== "JSXIdentifier" || !/^[a-z]/.test(tag.name)) return;
        const onlyExpressions = element.children.every((c) => (c.type === "JSXText" && c.value.trim() === "") || c.type === "JSXExpressionContainer");
        if (!onlyExpressions) return;
        for (let el = element; el; el = el.parent) {
          if (el.type !== "JSXElement") continue;
          const attr = el.openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === "className");
          if (!attr) continue;
          if (MONO_CLASS.test(sourceCode.getText(attr))) return;
          const e = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : null;
          const opaque = e && (e.type === "Identifier" || e.type === "MemberExpression" || (e.type === "CallExpression" && !(e.callee.type === "Identifier" && CLASS_HELPERS.has(e.callee.name))));
          if (opaque) return;
        }
        context.report({ node, messageId: "figureMono" });
      },
      'Property[key.name="fontSize"] > Literal'(node) {
        if (typeof node.value === "number") context.report({ node, messageId: "numericFontSize" });
      },
    };
  },
};

export default rule;
