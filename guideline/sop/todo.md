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

- [ ] **F4. Unmarked fade provenance gap.** A stored conservative case's
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

- [ ] **I-C2. Price-derived market events, if wanted.** Track J already delivered
      categories, per-category visibility, one global filter and registered event
      sources. What remains is only the price-derived events: S&P low, an oil shock
      over a threshold, and a drawdown, each computed from cached `indices` rows with a
      stated basis. Each would be a registered source in J's registry, not a new system.
      Brief: `docs/superpowers/plans/2026-09-12-portfolio-count-and-watchlist-drift.md`.

### Follow-ups carried from closed tracks

Each one was re-checked against the code on 2026-09-26 and is still true.

- [ ] **`ModalShell.tsx:45` fails eslint's `react-hooks/refs` rule**
      (`onCloseRef.current = onClose` during render). That line is the deliberate
      mechanism of an ERROR-LOG'd fix (2026-08-02, commit `1e4abf0`). It keeps the Escape
      listener alive across a caller's re-render. Read that entry before touching it; do
      not make a drive-by lint fix.
- [x] **A failed `/market/spreads` fetch is invisible.** FIXED 2026-09-26. The section
      now always renders, with a loading line, an alert on failure, or "No spreads were
      returned". Three e2e tests; three mutations caught.
- [ ] **`/market/spreads` fetches live data inline** on a cache miss or a stale cache,
      with no per-request timeout. The first request after each daily cache boundary can
      make up to seven live fetches in a row. Since 2026-09-26 the section shows
      "Loading spreads…" meanwhile, instead of nothing. The backend fix is a design
      decision, because each option trades something:
      - parallel fetches, which risk Yahoo rate limits;
      - serving yesterday's cache while refreshing in the background, which shows stale
        spreads first;
      - a per-request timeout, which turns a slow day into refusals.
- [ ] **`/simulate` refusal grouping matches by substring** across the whole code table,
      so a reworded engine message could be absorbed under the wrong code while still
      passing the completeness test. Fixing it needs a design decision: an exact
      code-to-raise-site map, which has a maintenance cost.
- [ ] **`/simulate`'s confidence-validation tests** cover one invalid string, not the
      falsy `""`/`None`/`0` cases that `case_fork` was specifically fixed for.
- [ ] **Deferred from the snapshot overhaul (Track E):** readable snapshot identity,
      charts over snapshot history, and the pre-existing annual-vs-horizonless conflation
      in `expected_return_spread`, which touches `/corporate`.

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
