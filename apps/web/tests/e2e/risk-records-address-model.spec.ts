import { expect, test } from "@playwright/test";
import { syncAddress, type AddressSync } from "../../lib/recordsAddress";

// The /alerts address and filter sync (plan Task 5): this page's own writes are absorbed, outside moves followed.
const RISK = "?kind=risk";
const ALL = "";

test("own writes landing in order are absorbed, an outside move is followed", () => {
  let state: AddressSync = { pending: [RISK], seen: ALL };
  const landed = syncAddress(state, RISK, RISK);
  expect(landed).toEqual({ pending: [], seen: RISK, follow: false });
  state = landed;
  expect(syncAddress(state, ALL, RISK), "back to the list from outside").toEqual({ pending: [], seen: ALL, follow: true });
});

test("A→B→A where B never lands leaves nothing pending to swallow a later outside move to B", () => {
  // Written: RISK, then ALL again. The address never left ALL, so no address change is ever seen.
  const caughtUp = syncAddress({ pending: [RISK, ALL], seen: ALL }, ALL, ALL);
  expect(caughtUp.pending).toEqual([]);
  expect(caughtUp.follow).toBe(false);
  // Later a nav link or back/forward moves the address to RISK: the filters must follow it.
  expect(syncAddress(caughtUp, RISK, ALL)).toEqual({ pending: [], seen: RISK, follow: true });
});

test("an intermediate own write landing late is still absorbed while a later write is owed", () => {
  // Written RISK then "?kind=surge"; RISK lands first.
  expect(syncAddress({ pending: [RISK, "?kind=surge"], seen: ALL }, RISK, "?kind=surge"))
    .toEqual({ pending: ["?kind=surge"], seen: RISK, follow: false });
});
