# Development Todo

Purpose: track ACTIVE MoneyView work. Completed tracks are archived, not kept here.

**History:**
- **`guideline/sop/todo6.md`** holds every track through 2026-09-29 (F4, G2, I-C2,
  the implied return vs WACC (metric v3), the FCFF floor removal (metric v4), typed engine
  refusals, the backend-port boot fallback, the volume-ratio floor and the launcher
  shortcuts). It is a full snapshot of this file as it stood before this cleanup.
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

## Where things stand (2026-09-29)

`renewal` @ `ae2cc78`, with PRs through #65 merged. The only open item is Track E, which
is deferred on data (see its entry).
- **Tests:** 1865 pytest passing, plus 16 environmental failures. `exchange_calendars`
  is not installed in the local Python env, and the same 16 fail on every branch.
- **Playwright:** 299 specs passed in the last full run (2026-09-27, #61).

---

## Open work

- [ ] **Deferred from the snapshot overhaul (Track E):** readable snapshot identity and
      charts over snapshot history. **Still blocked on data (re-checked 2026-09-29):**
      `corporate_comparison_snapshots_v3` holds 0 rows, because snapshots are saved only
      when you refresh the comparison yourself. The spec's reason ("it would be built and
      validated against nothing") still holds. Build the charts once history spans several
      days and metric versions. Readable identity stays cosmetic (spec §9).

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

- `guideline/sop/todo6.md` -- every track through 2026-09-29 (this file before cleanup).
- `guideline/sop/todo5.md` -- every track through 2026-09-26.
- `guideline/sop/todo4.md` -- all completed tracks through 2026-08-30.
- `guideline/sop/todo3.md`, `todo3-spreadsheet-values.md`, `todo2.md` -- earlier
  planning sources, still referenced by the archived entries.
