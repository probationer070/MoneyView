# Development Todo

Purpose: track ACTIVE MoneyView work. Completed tracks are archived, not kept here.

**History lives in `guideline/sop/todo4.md`** -- every completed track through
2026-08-30, with the reasoning, the rejected alternatives and the measured
figures. Consult it before re-litigating a decision; it is the record of why
things are the way they are.

Planning sources:
- `guideline/sop/suggestion.md` - primary critique and remediation source.
- `guideline/sop/finance-logic.md` - finance modeling standards.
- `guideline/sop/file-structure.md` - ownership boundaries.
- `docs/INDEX.md` - map of every documentation file in the repo.

Legend: `[ ]` not started, `[x]` complete

---

## Where things stand (2026-09-03)

`renewal` @ `7bfeb84`, **882 tests passing**, no skips or xfails.
(The 862 measured at `e28be2a` on 2026-08-30, plus Track B's 4 property tests
and its 16-case mutation harness. Track B is the only change since.)

Shipped and merged: the segment build-up engine; the write-time runnability
gate; the industry-benchmark chain (data, mapping, conservative-case generator)
with an HTTP route; 56 route handlers moved off the event loop; and the
over/undervaluation evidence panel with its route.

The original request -- value conservatively against top-industry averages, and
judge over/undervaluation from drawdown, volume and PE -- is structurally
complete. What remains is one half-built signal, no frontend, and the
follow-ups below.

---

## Track A - Finish the PE signal

The verdict panel's `trailing_pe` row refuses on **two independent grounds**.
Each is separately closable, and the row stays refused until both are.

- [ ] **A1. Load a Damodaran vintage carrying the price columns.**
      `trailing_pe`, `price_to_book`, `ev_sales` and `stdev_price` already exist
      in `industry_benchmark` and in `BENCHMARK_COLUMNS` as `required=False`,
      and `parse_workbook` reads them by header text. No code change needed:
      obtain the workbook and run `store_vintage(vintage, parse_workbook(path))`.
      Until then the row refuses `no_sector_pe: <vintage> has no trailing_pe`.
      Note the source workbook is NOT in the repo -- only test fixtures are.

- [ ] **A2. Confirm Yahoo's EPS line-item labels, then wire the arithmetic.**
      `trailing_pe_series` and `pe_change`
      (`packages/core_finance/price_signals.py`) are written and fully tested but
      have **no caller**, deliberately: the label names cannot be confirmed
      without inspecting a real stored bundle, and guessing them was ruled worse
      than refusing honestly. The row emits `eps_not_wired` today.
      Method: read `corporate_statements` for a ticker whose statements were
      actually acquired, find the income-statement rows carrying EPS (or derive
      it from net income / diluted shares), fixture them, then wire the PE row
      in `apps/api/services/valuation_verdict.py`.

---

## Track B - Close the defect class on the verdict panel  [COMPLETE 2026-09-03]

Kept here rather than archived to `todo4.md` because Track A and Track C have not
started and this record is what a fifth signal must be added against.

`apps/api/services/valuation_verdict.py` needed **ten** review rounds, and every
defect belonged to one class: a number or refusal wearing an attribution it has
not earned. Eight times, fixing one instance created or left a sibling.

The structural cause: `_own_window_source` concatenates four independently
gated clauses (window count, dropped bars, span, full-history), and **the
concatenation is unowned** -- each clause is individually true, and until the
last commit nothing asserted anything about the assembled sentence.

- [x] **B1. Property test: clause-to-noun attachment.** Done --
      `test_every_parenthetical_attaches_to_the_clause_it_describes`. It binds a
      span to its clause by NAME rather than by position (the older
      `test_no_source_string_ever_claims_more_bars_than_its_span_can_hold` binds
      positionally, which is how a reader parses the sentence but not how it is
      built), covers every row of the panel rather than the drawdown row alone,
      and every parenthetical rather than spans alone. Shown to catch
      `bare-span-wrong-noun`, `span-too-short-for-its-count` and
      `bar-count-labelled-in-days`.

- [x] **B2. Property test: subject-vs-peer basis symmetry.** Done, as a PAIR --
      and the pair is the finding. The string half
      (`test_the_peer_clause_names_the_same_basis_as_the_subject_clause`) was
      written first and reported as verified because it passed. It is not
      sufficient: the label and the peer sampling are produced by separate code
      paths, so reintroducing ND-12 moves the published figure from
      `peer mean 0.0%` to `peer mean -90.0%` while `source` stays byte-identical
      and the test still passes. The computed half
      (`test_the_peer_mean_is_computed_over_the_period_its_clause_names`) closes
      it: a peer spike outside the subject's window, on either side, across seven
      subject shapes, must not move the mean. Full write-up in `ERROR-LOG.md`
      2026-09-03. Note the panel itself was never exposed -- the pre-existing
      `test_every_close_in_the_peer_mean_lies_inside_the_subject_window` catches
      ND-12 from one hand-built case; what B2 adds is generality.

- [x] **B3. Restructuring the helper -- decided AGAINST, with evidence.** The
      peer clause's stated period and the peer sampling already read the same two
      locals (`start`, `end`, `valuation_verdict.py:241-261`), so they cannot
      disagree by construction -- which is the property the restructure was meant
      to create. One real duplication remains: `:136` recomputes
      `dated_closes[-len(window):]` independently of `:241`, so the window clause
      and the peer clause could drift if someone edited one. That is exactly what
      the `peer-clause-names-a-different-period` mutation exploits, and the B2
      string test catches it. The invariant a refactor would enforce structurally
      is therefore already pinned by a test, and rewriting a module that took ten
      review rounds to stabilise costs more risk than it removes (CLAUDE.md 3).
      Revisit only if a fifth signal needs a clause the positional concatenation
      cannot express.

**Done 2026-09-03.** The defect class is closed by a checked-in gate, not by a
one-time check: `tests/api/test_valuation_verdict_mutations.py` rebuilds
`valuation_verdict.py` in memory with each of six known defects reintroduced and
asserts the property test that should catch it does fail. Mutation is in-memory
only, so an interrupted run cannot leave a broken module in the tree. An
anchor-integrity test fails loudly if `valuation_verdict.py` is rewritten,
instructing the next author to re-verify the property tests by hand rather than
loosen the anchor. Procedure and rationale: `guideline/sop/test-verification.md`
and CLAUDE.md section 8. Suite: 882 passing, no skips or xfails.

---

## Track C - Frontend

- [ ] **C1. 3d - the valuation tab.** Nothing from sub-projects 1-3 has a UI;
      all of it is HTTP-only. The verdict panel is designed to be shown as rows
      with a `source` beside each -- a refused row is content, not an error
      state, and the UI must render it as such.

- [ ] **C2. 3c - uncertainty and attribution.** Monte Carlo, `/fork`, `/diff`,
      `/pricing`. Specced in
      `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`.

---

## Track D - Cleanups, each small and independent

- [ ] **D1. Delete `_validate_runnable`** (`apps/api/services/valuation_case.py`).
      Provably redundant: both its checks are now enforced by the engine at
      write time through `_validate_by_engine`. Because it runs FIRST its
      messages shadow the engine's, so editing an engine message leaves a stale
      copy diverging with no test failure.

- [ ] **D2. Move engine null-safety into the engine.**
      `CaseSpec.__post_init__` and `SegmentSpec.__post_init__` dereference
      required fields without null checks, and `valuation_case.py`'s
      `_validate_required_fields` is a service-layer mirror that must be kept in
      sync -- the same duplication the industry-benchmark spec argues against.

- [ ] **D3. Audit local databases for stored-but-unrunnable cases.** The
      write-time gate governs writes only; rows written before it are unaffected
      and still fail at run. No migration and no diagnostic exists.
      Per-developer, since `data/processed/` is gitignored.

- [ ] **D4. Restore route coverage of a computed drawdown.**
      `_seed_verdict_inputs` seeds 5 bars, so every route test's drawdown row
      refuses. The 200-with-refusals semantic is pinned; a computed row through
      the real `load_price_bars` is not.

- [ ] **D5. `test_verdict_route_is_404_when_nothing_is_stored` passes when the
      route does not exist.** It asserts no `detail`, so it cannot distinguish
      "no stored bars" from "route unregistered". One added assertion fixes it.

- [ ] **D6. The route loads bars twice** -- once to test emptiness, once inside
      `build_verdict`. `limit=1` on the guard is enough.

---

## Known limits, accepted deliberately

Recorded so nobody rediscovers them as bugs:

- **The peer set is a watchlist, not a sector census.** Peers are tickers this
  installation happens to store in the same industry. Every peer-based row
  reports both counts (`2 of 3`) rather than implying authority.
- **Benchmarking against the top of a sector is conservative for spotting
  undervaluation and anti-conservative for the opposite.** Each panel row names
  the basis it used, and the caveat is scoped to rows that genuinely use the
  sector top.
- **US-only.** Non-US tickers resolve to US industry benchmarks.
- **Vintage loading is manual.** An annual dataset does not need a scheduler.
- **A single usable volume yields a ratio of `1.0` by construction**
  (`fallback_recent == fallback_baseline == 1`). The source makes the degeneracy
  visible (`1/1 bars`); a minimum-bars floor would be cleaner.
- **`no_sector_pe` does not distinguish** "the vintage has no PE" from "the PE
  was screened out" -- both mean no usable sector PE, and the vintage is named.
- **`SectorBenchmark.rejected`** carries ~20 no-value entries per basket for the
  four optional columns. Read nowhere in `apps/`; diagnostic noise only.
- **A "full-history drawdown" is computed over NULL-filtered closes**, so on a
  sparse subject it means "full history of usable closes" -- inferable only from
  the adjacent stored-bars clause.

---

## Archived

- `guideline/sop/todo4.md` -- all completed tracks through 2026-08-30.
- `guideline/sop/todo3.md`, `todo3-spreadsheet-values.md`, `todo2.md` -- earlier
  planning sources, still referenced by the archived entries.
