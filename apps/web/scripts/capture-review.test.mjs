import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./capture-review.mjs", import.meta.url));

// The script reads design-capture/ relative to the working directory, so each case runs in its own temp root.
function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "capture-review-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeCapture(root, label, files) {
  const dir = path.join(root, "design-capture", label);
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes);
}

const run = (root, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });

describe("capture-review --equal", () => {
  it("identical folders exit 0", () => {
    withRoot((root) => {
      const files = { "market.png": Buffer.from([1, 2, 3]), "cases.png": Buffer.from([4, 5]) };
      writeCapture(root, "a", files);
      writeCapture(root, "b", files);
      const result = run(root, ["a", "b", "--equal"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /2 screens byte-identical/);
    });
  });

  it("one differing byte exits 1 and names the file", () => {
    withRoot((root) => {
      writeCapture(root, "a", { "market.png": Buffer.from([1, 2, 3]), "cases.png": Buffer.from([4, 5]) });
      writeCapture(root, "b", { "market.png": Buffer.from([1, 2, 9]), "cases.png": Buffer.from([4, 5]) });
      const result = run(root, ["a", "b", "--equal"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /differs: market\.png/);
      assert.doesNotMatch(result.stderr, /cases\.png/);
    });
  });

  it("a file missing on one side counts as a difference", () => {
    withRoot((root) => {
      writeCapture(root, "a", { "market.png": Buffer.from([1]), "cases.png": Buffer.from([2]) });
      writeCapture(root, "b", { "market.png": Buffer.from([1]) });
      const result = run(root, ["a", "b", "--equal"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /differs: cases\.png/);
    });
  });

  it("empty folders fail", () => {
    withRoot((root) => {
      writeCapture(root, "a", {});
      writeCapture(root, "b", {});
      const result = run(root, ["a", "b", "--equal"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /no captures found/);
    });
  });

  it("a missing argument is a usage error, exit 2", () => {
    withRoot((root) => {
      const result = run(root, ["a", "--equal"]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /usage/);
    });
  });
});
