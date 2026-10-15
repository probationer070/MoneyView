import { expect, test } from "@playwright/test";
import { tokens } from "../../lib/tokens.generated";
import { DESIGN_SCREENS } from "./helpers/designScreens";

// The market overview still renders pre-paper classes. DS Task 14b deletes this exclusion.
const MARKET_ROUTE = "/";

/** Every colour token as the computed-style string Chrome reports. */
function allowedColours(): Set<string> {
  const out = new Set(["rgba(0, 0, 0, 0)"]);
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const hex = /^#([0-9a-f]{6})$/i.exec(node);
      if (hex) out.add(`rgb(${[0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).join(", ")})`);
      const fn = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(node);
      if (fn) out.add(`rgba(${fn[1]}, ${fn[2]}, ${fn[3]}, ${fn[4]})`);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(tokens);
  return out;
}

for (const [route, mock] of DESIGN_SCREENS.filter(([r]) => r !== MARKET_ROUTE)) {
  test(`${route}: only token colours, redesign radii, no shadows`, async ({ page }) => {
    await mock(page);
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const allowed = [...allowedColours()];
    const violations = await page.evaluate((ok) => {
      const allowedSet = new Set(ok);
      const RADII = new Set(["0px", "2px", "4px"]);
      const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${[...el.classList].slice(0, 3).join(".")}`;
      const out: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        // SVG and canvas get chart colours through attributes and resolveCssColor (lint-checked);
        // lightweight-charts builds its own DOM. The Next.js dev overlay and the TanStack Query devtools
        // are injected by `next dev` only and are not part of the app's design.
        if (el.closest("svg, .tv-lightweight-charts, nextjs-portal, [class*='tsqd-']")) continue;
        const s = getComputedStyle(el);
        if (s.display === "none") continue;
        const colours: [string, string][] = [["color", s.color], ["background-color", s.backgroundColor]];
        for (const side of ["top", "right", "bottom", "left"]) {
          if (parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0) colours.push([`border-${side}-color`, s.getPropertyValue(`border-${side}-color`)]);
        }
        for (const [prop, value] of colours) if (!allowedSet.has(value)) out.push(`${label(el)} ${prop}: ${value}`);
        const radius = s.borderTopLeftRadius;
        if (!RADII.has(radius) && parseFloat(radius) < 999) out.push(`${label(el)} border-radius: ${radius}`);
        const visibleShadow = s.boxShadow !== "none" && s.boxShadow.split(/,(?![^(]*\))/).some((part) => !/rgba\(\d+, \d+, \d+, 0\)/.test(part));
        if (visibleShadow) out.push(`${label(el)} box-shadow: ${s.boxShadow}`);
      }
      return [...new Set(out)];
    }, allowed);
    expect(violations).toEqual([]);
  });
}
