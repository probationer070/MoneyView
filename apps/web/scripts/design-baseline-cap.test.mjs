import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKET_WARN_CAP, warnCapExceeded } from "./design-baseline-cap.mjs";

test("the market warning cap is 0 after the market one-screen plan", () => {
  assert.equal(MARKET_WARN_CAP, 0);
});

test("exactly at the cap passes", () => {
  assert.equal(warnCapExceeded(0), false);
});

test("one warning over the cap fails", () => {
  assert.equal(warnCapExceeded(1), true);
});

test("fewer warnings than the cap pass", () => {
  assert.equal(warnCapExceeded(0, 5), false);
});
