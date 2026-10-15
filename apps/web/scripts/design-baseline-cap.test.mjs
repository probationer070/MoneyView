import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKET_WARN_CAP, warnCapExceeded } from "./design-baseline-cap.mjs";

test("the market warning cap is the recorded 295", () => {
  assert.equal(MARKET_WARN_CAP, 295);
});

test("exactly at the cap passes", () => {
  assert.equal(warnCapExceeded(295), false);
});

test("one warning over the cap fails", () => {
  assert.equal(warnCapExceeded(296), true);
});

test("fewer warnings than the cap pass", () => {
  assert.equal(warnCapExceeded(0), false);
});
