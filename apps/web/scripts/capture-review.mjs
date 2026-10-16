// Compare two DESIGN_CAPTURE folders under apps/web/design-capture/.
//   node scripts/capture-review.mjs <a> <b> --equal   exit 1 unless every PNG is byte-identical
//   node scripts/capture-review.mjs <a> <b>           write design-capture/review-<a>-vs-<b>.html
// Chromium encodes identical pixels to identical PNG bytes, so byte equality is pixel equality.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "design-capture";
const [a, b] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!a || !b) {
  console.error("usage: capture-review.mjs <a> <b> [--equal]");
  process.exit(2);
}
const pngs = (dir) => (existsSync(path.join(ROOT, dir)) ? readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(".png")) : []);
const names = [...new Set([...pngs(a), ...pngs(b)])].sort();
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (process.argv.includes("--equal")) {
  const differing = names.filter((n) => {
    const [x, y] = [path.join(ROOT, a, n), path.join(ROOT, b, n)];
    return !existsSync(x) || !existsSync(y) || hash(x) !== hash(y);
  });
  if (!names.length || differing.length) {
    console.error(names.length ? `differs: ${differing.join(", ")}` : "no captures found");
    process.exit(1);
  }
  console.log(`${names.length} screens byte-identical`);
} else {
  const rows = names.map((n) => `<h2>${n}</h2><div class="pair"><img src="${a}/${n}"><img src="${b}/${n}"></div>`).join("\n");
  const out = path.join(ROOT, `review-${a}-vs-${b}.html`);
  writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${a} vs ${b}</title><style>.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;border:1px solid}</style><h1>${a} (left) / ${b} (right)</h1>\n${rows}\n`);
  console.log(`open ${out}`);
}
