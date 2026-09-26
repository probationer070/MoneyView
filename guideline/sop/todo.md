# Development Todo

Purpose: track ACTIVE MoneyView work. Completed tracks are archived, not kept here.

**History:**
- **`guideline/sop/todo5.md`** holds every track through 2026-09-26 (A-L, including C2's
  Cases tab and `/pricing`, and the F2, F3, G5 and H8 fixes), with the reasoning, the
  rejected alternatives and the measured figures. It is a full snapshot of this file
  as it stood before this cleanup.
- **`guideline/sop/todo4.md`** holds everything through 2026-08-30.

Consult them before re-litigating a decision; they record why things are the way
they are.

Planning sources:
- `guideline/sop/suggestion.md` - primary critique and remediation source.
- `guideline/sop/finance-logic.md` - finance modeling standards.
- `guideline/sop/file-structure.md` - ownership boundaries.
- `docs/INDEX.md` - map of every documentation file in the repo.

Legend: `[ ]` not started, `[x]` complete

---

## Where things stand (2026-09-26)

`renewal` @ `a729016`, with PRs through #53 merged. Every track in `todo5.md` is closed
except the items below, all of them optional or cleanup.
- **Tests:** 1664 pytest passing, plus 16 environmental failures. `exchange_calendars`
  is not installed in the local Python env, and the same 16 fail on every branch.
- **Playwright:** 267 specs passed in the last full run, which predates `/pricing`;
  `/pricing` added 3.

---

## Open work

- [x] **F4. Unmarked fade provenance gap.** FIXED 2026-09-26 with case-level
      narratives (`case_narrative`, an optional records-sync child so older peers still
      read every case without one). A conservative case now stores the claim for
      `wacc_initial`/`wacc_stable`/`effective_tax_rate`/`roic_stable`; the `roic_stable`
      claim names which bound won. Forks drop the claim of a case field they change. The
      Cases tab shows the claims. 22 pytest tests and 1 e2e; 16 mutations caught. **Rollout:** update both
      PCs before generating a new conservative case, or the older PC skips the file that
      carries it. The original entry follows.
      A stored conservative case's
      `wacc_initial`/`wacc_stable`/`effective_tax_rate` (and `roic_stable`,
      via `after_tax_roc`) carry no flag distinguishing a faded case-level
      value from one that was never faded -- `fade`'s meta dict is discarded
      for these three case-level fields because the narrative-claim
      machinery only covers segment-level fields
      (`conservative_case.py:217-229`). No value computes wrong (the
      `ERROR-LOG.md` bar in CLAUDE.md §7 is not met), so this is deliberately
      **not** an `ERROR-LOG.md` entry -- it is missing provenance metadata, a
      different thing from a wrong number. Already fully accounted for in
      `docs/metrics/industry-benchmarks.md`'s `fade` entry. Fix, if taken, is a
      case-level flag or a narrated claim for
      `wacc_initial`/`wacc_stable`/`effective_tax_rate`.

- [ ] **G2. NULL-close rows in the database.** The read guard makes them inert, so this
      is cleanup rather than a fix. Re-measured 2026-09-26: 2 rows remain in `stocks`
      (`META 2026-03-16`, `^KS11 2026-04-22`), and `indices` holds 1. Nothing to do
      unless the count grows again.

- [x] **I-C2. Price-derived market events.** DONE 2026-09-26. A new `computed` origin
      covers S&P 500 drawdowns (10% below the prior peak, peak to trough) and oil shocks
      (±20% over 20 sessions, overlapping windows merged). Both are computed from cached
      closes, with a structured `basis`. See the addendum in
      `docs/superpowers/specs/2026-09-15-market-event-registry-design.md`. In the current
      cache they find 2 drawdowns and 12 oil episodes. 22 pytest tests and 2 e2e tests;
      16 mutations caught. The original entry follows.
      Track J already delivered
      categories, per-category visibility, one global filter and registered event
      sources. What remains is only the price-derived events: S&P low, an oil shock
      over a threshold, and a drawdown, each computed from cached `indices` rows with a
      stated basis. Each would be a registered source in J's registry, not a new system.
      Brief: `docs/superpowers/plans/2026-09-12-portfolio-count-and-watchlist-drift.md`.

### Follow-ups carried from closed tracks

Each one was re-checked against the code on 2026-09-26 and is still true.

- [x] **`ModalShell.tsx` failed eslint's `react-hooks/refs` rule.** FIXED 2026-09-26.
      The `onClose` ref is now updated in a layout effect, not during render. Escape
      registration still depends on `open` alone (ERROR-LOG 2026-08-02). The Escape
      regression spec (`portfolio-watchlist.spec.ts`) passes 10/10 with the change, and
      fails when the original bug (registration depending on `onClose`) is reintroduced.
- [x] **A failed `/market/spreads` fetch is invisible.** FIXED 2026-09-26. The section
      now always renders, with a loading line, an alert on failure, or "No spreads were
      returned". Three e2e tests; three mutations caught.
- [x] **`/market/spreads` fetched live data inline.** FIXED 2026-09-26: serving the
      stale cache with a background refresh, chosen with the user over parallel fetches
      (Yahoo rate limits) and a timeout (refusals on a slow day). `get_stock_ohlcv(...,
      refresh="background")` returns a stale cache at once and refreshes it on a daemon
      thread. At most one refresh runs per ticker, and the marker is cleared even on
      failure. A cache miss still fetches inline. The default stays inline for every
      other caller. Six tests; four mutations caught.
- [x] **`/simulate` refusal grouping matched by substring.** FIXED 2026-09-26 with
      typed refusals, chosen with the user. `core_finance.refusals.EngineRefusal`
      (a `ValueError`) carries a stable code, and all 44 raise sites in
      `segment_valuation.py`/`dcf.py` state theirs. 35 kept the code the old table
      gave them, and the 9 the table never classified got their own. Messages are
      unchanged. Tests: the 20 driven conditions each raise their code, and a
      structural test requires every engine raise to use a literal known code, with
      every code used. Four mutations are each caught.
- [x] **`/simulate`'s confidence-validation tests.** Already covered: a parametrized
      test refuses `""`, `None`, `0` and an invalid string. Verified 2026-09-26 by
      reintroducing `case_fork`'s old `raw.get("confidence") and ...` pattern: all three
      falsy rows fail.
- [x] **The annual-vs-horizonless conflation in `expected_return_spread`.** FIXED
      2026-09-26: replaced by the market-implied return vs WACC (metric v3), with six
      ordered refusal codes; the old column is retired, not read. Spec
      `docs/superpowers/specs/2026-09-26-implied-return-spread-design.md`; ERROR-LOG
      2026-09-26.
- [x] **The comparison DCF floors FCFF at $1B** FIXED 2026-09-26 (metric v4; spec
      `docs/superpowers/specs/2026-09-26-dcf-fcff-floor-removal-design.md`): both DCF paths value
      real FCFF and refuse a non-positive forecast as `non_positive_fcff`. Original entry: (`_dcf_snapshot`,
      `base_fcff = max(fcff, 1.0)`, in billions). This inflates `dcf_value` / "DCF value vs
      price" for every company with FCFF under $1B, and in that band it can contradict the
      implied return's sign. Found in the implied-return final review, 2026-09-26, and it
      predates that work. The fix is to refuse or mark instead of flooring. ERROR-LOG 2026-09-26.
- [ ] **Deferred from the snapshot overhaul (Track E):** readable snapshot identity and
      charts over snapshot history.

---

## Known limits, accepted deliberately

Recorded so nobody rediscovers them as bugs.

**Verdict panel and benchmarks**
- **The peer set is a watchlist, not a sector census.** Peers are tickers this
  installation happens to store in the same industry. Every peer-based row reports
  both counts (`2 of 3`) rather than implying authority.
- **Benchmarking against the top of a sector is conservative for spotting
  undervaluation and anti-conservative for the opposite.** Each panel row names the
  basis it used. `/pricing` deliberately uses the company's own industry instead.
- **US-only.** Non-US tickers resolve to US industry benchmarks.
- **Vintage loading is manual.** An annual dataset does not need a scheduler.
- **A single usable volume yields a ratio of `1.0` by construction.** The source makes
  the degeneracy visible (`1/1 bars`); a minimum-bars floor would be cleaner.
- **`no_sector_pe` does not distinguish** "the vintage has no PE" from "the PE was
  screened out". Both mean no usable sector PE, and the vintage is named.
- **`SectorBenchmark.rejected`** carries about 20 no-value entries per basket for the
  four optional columns. It is read nowhere in `apps/`; diagnostic noise only.
- **A "full-history drawdown" is computed over NULL-filtered closes**, so on a sparse
  subject it means "full history of usable closes".
- **`valuation_verdict.py` builds its source sentences by positional concatenation.**
  Restructuring was decided against (Track B3). Revisit only if a fifth signal needs a
  clause the concatenation cannot express. The mutation harness in
  `tests/api/test_valuation_verdict_mutations.py` guards it.

**CAPM beta**
- **A beta relevered for CAPM does not round-trip exactly at extreme leverage.**
  `debt_ratio` is capped at 90 (D/E at most 9) and the unlevered beta is clamped to
  [0.4, 3.0]. The tax rate now matches on both sides (F2, 2026-09-26).

**Decision log**
- **The empty-memo route test passes if only the Pydantic validator is removed**,
  because `record_decision` guards independently. That redundancy is deliberate defence
  in depth, but the route test alone does not pin the request model.

**Event registry**
- User events and category edits are per machine and not synced.
- The tooltip shows a source's host, not a link.
- The XNYS calendar's coverage is fixed when the API process starts (one year ahead).
  A server left running for a year stops generating quad-witching dates past that point
  until restarted.

---

## Archived

- `guideline/sop/todo5.md` -- every track through 2026-09-26 (this file before cleanup).
- `guideline/sop/todo4.md` -- all completed tracks through 2026-08-30.
- `guideline/sop/todo3.md`, `todo3-spreadsheet-values.md`, `todo2.md` -- earlier
  planning sources, still referenced by the archived entries.
