import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

test("Host Grotesk sets Latin, Pretendard sets Hangul, Geist Mono sets figures", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const r = await page.evaluate(async () => {
    const root = getComputedStyle(document.documentElement);
    const v = (name: string) => root.getPropertyValue(name).trim();
    const f = { sans: v("--font-family-sans"), mono: v("--font-family-mono"), host: v("--font-host-grotesk"), pre: v("--font-pretendard"), geist: v("--font-geist-mono") };
    try {
      await Promise.all([
        document.fonts.load(`500 40px ${f.host}`, "Market"),
        document.fonts.load(`500 40px ${f.pre}`, "시장"),
        document.fonts.load(`500 40px ${f.geist}`, "0123"),
      ]);
    } catch {
      // An empty font variable makes load() throw; the assertions below report it by name.
    }
    const width = (text: string, family: string) => {
      const el = document.createElement("span");
      Object.assign(el.style, { fontFamily: family, fontSize: "40px", fontWeight: "500", position: "absolute", whiteSpace: "nowrap" });
      el.textContent = text;
      document.body.appendChild(el);
      return el.getBoundingClientRect().width;
    };
    const loaded = [...document.fonts].filter((x) => x.status === "loaded").map((x) => x.family.toLowerCase());
    return {
      f, loaded,
      latinSans: width("Market overview", f.sans), latinHost: width("Market overview", f.host), latinPre: width("Market overview", f.pre),
      hangulSans: width("시장개요가치평가", f.sans), hangulPre: width("시장개요가치평가", f.pre), hangulSerif: width("시장개요가치평가", "serif"),
      ones: width("111.11", f.mono), eights: width("888.88", f.mono), geistOnes: width("111.11", f.geist),
    };
  });
  for (const value of Object.values(r.f)) expect(value, "a font variable is empty").not.toBe("");
  for (const name of ["hostgrotesk", "pretendard", "geistmono"]) expect(r.loaded.some((x) => x.includes(name)), `${name} loaded`).toBe(true);
  expect(Math.abs(r.latinSans - r.latinHost)).toBeLessThan(0.5); // Latin comes from Host Grotesk
  expect(Math.abs(r.latinHost - r.latinPre)).toBeGreaterThan(2); // ...which is measurably not Pretendard
  // The Hangul sample has no spaces: a space comes from the Latin font (Host Grotesk), not Pretendard.
  expect(Math.abs(r.hangulSans - r.hangulPre)).toBeLessThan(0.5); // Hangul falls through to Pretendard
  expect(Math.abs(r.hangulPre - r.hangulSerif)).toBeGreaterThan(2); // ...and Pretendard really rendered
  expect(Math.abs(r.ones - r.eights)).toBeLessThan(0.5); // figures are fixed-width
  expect(Math.abs(r.ones - r.geistOnes)).toBeLessThan(0.5); // ...because they are Geist Mono
});
