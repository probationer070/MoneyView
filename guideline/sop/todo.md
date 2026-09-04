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

`renewal` @ `3bdd3d0` (PRs #13-15 merged) + Track E, **942 tests passing**, no
skips or xfails.
(The 862 measured at `e28be2a` on 2026-08-30, plus Track B's 4 property tests
and its 16-case mutation harness, plus Track A2's 7 tests and 2 mutations.)

**Local-data caveat for anyone running the panel by hand:** `corporate_quote_facts`
is still EMPTY, so `resolve_peers` and `resolve_for_ticker` both fail for every
ticker -- `build_verdict("AAPL")` today refuses drawdown and trailing_pe with
`no_industry: AAPL`, and only the volume row computes. Acquiring quote facts is a
separate network call; nothing in A2 depends on it.

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

- [ ] **A1. Load a Damodaran vintage carrying the price columns.** STILL OPEN --
      blocked only on obtaining the file, which is not in the repo and cannot be
      produced from anything here. No code change needed:

          from apps.api.services.db import init_db
          from apps.api.services.industry_benchmark_store import (
              parse_workbook, store_vintage,
          )
          init_db()   # see below -- older local DBs have no industry_benchmark table
          store_vintage("2026-01-01", parse_workbook(r"path\to\workbook.xlsx"))

      The vintage key is the PUBLICATION date, not the fetch date. `parse_workbook`
      reads sheet `"Industry Average Beta (US)"` and locates columns by HEADER
      TEXT, so column order does not matter. It requires `Industry Name`,
      `Number of firms`, and the nine `required=True` headers in
      `BENCHMARK_COLUMNS`. **`Trailing PE` is `required=False`**, so a workbook
      lacking it parses successfully and silently leaves the column `None` --
      which reproduces exactly the `no_sector_pe` refusal this task exists to
      close. Check the workbook actually carries `Trailing PE` before loading.
      `tests/fixtures/damodaran_industries.txt` pins the 2026 vintage's 99
      industry names verbatim (including the upstream "Heathcare" misspelling)
      if you need to confirm a candidate file is the right dataset.

      Verified 2026-09-03: `data/processed/moneyview.db` predates this feature
      and had no `industry_benchmark` table at all; `init_db()` has since created
      it (additively -- it is `CREATE TABLE IF NOT EXISTS` plus
      `ALTER TABLE ADD COLUMN`, no DROP or DELETE anywhere).

- [x] **A2. Yahoo's EPS labels confirmed, and the arithmetic wired.**
      Done 2026-09-03. A real AAPL bundle was fetched and persisted
      (`corporate_statements`, 1701 rows), which settled the labels by
      inspection rather than by guessing. Yahoo's annual income statement
      reports **`Diluted EPS`** directly -- 7.46 / 6.08 / 6.13 / 6.11 for
      FY2025-2022, with FY2021 all-NaN -- alongside `Basic EPS`, `Net Income`,
      `Net Income Common Stockholders` and `Diluted Average Shares`. The real
      rows are fixtured in `tests/fixtures/aapl_income_annual.py`; the LABELS
      are the point of that fixture, not the values.

      `_EPS_LABELS = ("Diluted EPS",)` with no fallback to basic. Diluted is
      deliberate and conservative: more shares means lower EPS means a HIGHER
      PE, so the stock looks more expensive -- the safe direction for a panel
      testing UNDERvaluation. Falling back to basic would trade the conservative
      figure for the anti-conservative one on exactly the tickers where diluted
      is missing, which is worse than refusing.

      The row now publishes `price / eps` from the newest annual period with a
      strictly positive EPS, skipping NaN periods and loss-making years (a
      negative PE sorts as "cheap" in any ascending comparison). `source` names
      BOTH bases subject-first, mirroring the drawdown row's ND-A fix:
      `own PE: Diluted EPS 7.46 for FY2025-09-30, price 333.43 as of 2026-07-30;
      Damodaran <vintage> top-5-by-ROC sector basket (3 of 5 industries)`.
      `comparison` keeps the sector average even on a refused row -- the sector
      figure is real information regardless of whether the subject's PE resolved.
      New refusals: `no_statements`, `no_positive_eps` (naming the periods it
      examined). Covered by two mutations in
      `tests/api/test_valuation_verdict_mutations.py`.

      **`trailing_pe_series` and `pe_change` are still uncalled, now for a
      different reason.** They key EPS by the close's calendar YEAR, so for a
      September fiscal year a March close is priced against earnings not
      reported until October -- lookahead bias. Closing A2 needs only the
      current PE, so they were left alone rather than wired with a caveat. They
      are not forgotten; a PE-CHANGE signal is a separate decision, and under
      this panel's rules it would owe its own basis disclosure.

      Note the todo's original fallback suggestion -- "derive it from net income
      / diluted shares" -- would ALSO have required a guess: before this task no
      net-income label existed anywhere in the repo. Only `Diluted Average
      Shares` was mapped (`equity_bridge.py`). Reading `Diluted EPS` directly
      avoids the derivation entirely.

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

## Track D - Cleanups  [ALL CLOSED 2026-09-03]

- [x] **D1. Deleted `_validate_runnable`** (`apps/api/services/valuation_case.py`).
      Done 2026-09-03. The redundancy was verified before deleting, not assumed:
      the both-curves-set rule is enforced by `SegmentSpec.__post_init__`
      (`segment_valuation.py:130`, message carries "different revenue curves")
      and the 10-year-horizon rule by `_gap_closing_revenues` (`:338`, message
      carries "10-year horizon" since `_EARLY_YEARS = 5`) -- the exact phrases
      `test_valuation_seed.py`'s two `pytest.raises(match=...)` assertions pin.
      Both tests still pass with the function gone, which is the proof. 29 lines
      removed; `_validate_by_engine` reaches both through `run_case`.

- [x] **D2. Moved engine null-safety into the engine.** Done 2026-09-03.
      `CaseSpec.__post_init__` and `SegmentSpec.__post_init__`
      (`segment_valuation.py`) now guard every field they dereference
      unconditionally with an explicit `None` check at the very top,
      naming the field(s) in a `ValueError` -- not derived from dataclass
      introspection, which was the service-layer mirror's blind spot
      (`_validate_required_fields` and `_required_field_names`, both
      deleted from `valuation_case.py`, 82 lines removed). The two tests at
      `test_valuation_case_service.py:296-329` still pass unchanged, proving
      the outward behaviour held. New property tests in
      `tests/core_finance/test_segment_valuation.py` keep the introspection
      as a TEST: they sweep every field the old predicate would have called
      required and assert each raises `ValueError` naming itself when set to
      `None` alone (14 `CaseSpec` fields, 7 `SegmentSpec` fields, plus two
      non-empty-sweep guards -- 23 new tests, 892 -> 915 passing). Mutation-
      verified: removing `shares_basic` from the engine's guard list made
      `test_a_missing_required_case_field_raises_valueerror_naming_it[shares_basic]`
      fail with `TypeError: '<=' not supported between instances of
      'NoneType' and 'int'` at `self.shares_basic <= 0`, uncaught by
      `pytest.raises(ValueError)` -- exactly the regression the guard
      exists to prevent. Restored; `git diff --stat` on the engine file
      showed only the intended change.

- [x] **D3. Audited -- nothing to migrate on this machine.** Run 2026-09-03
      against `data/processed/moneyview.db`: **0 rows in `valuation_case`, 0 in
      `segment`**, so no case predates the write-time gate here and there is
      nothing unrunnable to find. The three `moneyview-e2e*.db` files have no
      `valuation_case` table at all.

      No diagnostic script was written, deliberately. With zero cases it could
      not be exercised against real data, which makes it exactly the speculative
      machinery CLAUDE.md section 2 rules out -- and the audit itself is a dozen
      lines of read-only SQL. Write one when a machine turns up that actually
      has cases. **This item is per-developer: closing it here says nothing
      about anyone else's database.**

- [x] **D4. Route coverage of a computed drawdown restored.** Done
      2026-09-03. `test_verdict_route_serves_a_computed_drawdown_not_only_refusals`
      seeds 260 bars falling from a peak of 200.0 to a last close of 150.0, plus
      three flat same-industry peers, and drives a real -25% drawdown and a real
      peer mean through the actual `load_price_bars` and `VerdictPanel`. A
      refused row serialises `value: None`; a computed one serialises floats and
      a comparison string, and only the refusal path had ever been exercised.

      Mutation-verified, and the mutation is the point: with the route feeding
      `build_verdict` only the last 5 bars -- so every drawdown refuses -- the
      new test fails while `test_verdict_route_returns_a_panel` and
      `test_verdict_route_returns_200_with_refused_rows` both keep passing.
      They cannot see that regression, because a refusal is what they already
      assert. That is the hole this test closes.

- [x] **D5. `test_verdict_route_is_404_when_nothing_is_stored` now names its
      own 404.** Done 2026-09-03. Confirmed the defect first: FastAPI answers an
      unregistered path with exactly `404 {"detail": "Not Found"}`, so the
      status-only assertion passed against an EMPTY app -- it would have gone on
      passing if the router were dropped entirely. The test now asserts
      `detail == "no stored price bars for NOTHING"`, which an unregistered route
      cannot produce.

- [x] **D6. The route no longer loads every bar to test emptiness.**
      Done 2026-09-03. `load_price_bars(ticker, limit=1)` on the guard; the full
      history is loaded once, inside `build_verdict`. For AAPL that guard was
      pulling 1,310 rows to answer a yes/no question.

---

## Track E - Snapshot overhaul (backend)  [SHIPPED 2026-09-03]

Spec: `docs/superpowers/specs/2026-09-03-snapshot-overhaul-design.md`
Plan: `docs/superpowers/plans/2026-09-03-snapshot-overhaul-backend.md`

The complaint was that snapshots carry no memo and no visualization, so their
utility is worse than a commercial service. The fix is not a prettier history:
snapshots stay as expiring telemetry, and a new **decision** record takes over
the job they were failing at.

- [x] **E1. `investment_decision` — the durable record.** One row per ticker per
      decision: memo (NOT NULL -- a decision without a stated reason is a
      snapshot), action, and the model's figures COPIED at record time. No
      retention policy, deliberately: `SNAPSHOT_RETENTION_DAYS = 365` prunes
      snapshots, and the code already said so before this work started.

- [x] **E2. The server captures the figures, never the client.**
      `POST /api/v1/decisions` accepts `{ticker, action, memo}` and nothing else;
      the request model uses `extra="forbid"`, so a client that smuggles a price
      gets a 422 rather than having it silently dropped. A browser-posted figure
      could be stale or rounded for display and would be stored as what the user
      believed, undetectably.

- [x] **E3. A decision is recordable when the model cannot value the ticker.**
      `figures_unavailable_reason` is stored INSTEAD of the figures. Review
      caught that the first implementation's refusal path was dead against real
      data -- `latest_market_price` returns `0.0` rather than raising, and
      `metrics_for_ticker` falls back to generic defaults, so an unvaluable
      ticker would have been recorded with fallback figures wearing a captured
      attribution. A non-positive price is now detected explicitly.

- [x] **E4. Outcomes are computed on read, never stored.** A persisted outcome is
      correct only until the next bar arrives and then silently wrong. Both dates
      travel with the number, because the figure it sits beside -- gap to fair
      value -- has no time horizon and the move does.

- [x] **E5. No accuracy metric, ever.** `dcf_implied_return` is
      `(intrinsic / price) - 1`: total upside, NO horizon. Combining it with a
      realized return would be the same basis mismatch `ERROR-LOG.md` already
      records twice. Guarded by an allowlist over the response's top-level keys,
      so a combined figure fails whatever it is named -- a blocklist of five
      suspicious words let `gap_vs_move` through.

- [x] **E6. Snapshot dedupe on write.** `_snapshot_version_id` is deterministic --
      day, universe, assumptions (in their stored percentage form), schema -- so a
      repeated refresh replaces in place instead of appending. An output-comparison
      rule was rejected: across the 8 live versions of 2026-04-23, `MSFT` and
      `IAUM` are byte-identical and only `^GSPC` ticks by pennies, so it would have
      caught 3 of 8. See `ERROR-LOG.md` 2026-09-03.

- [x] **E10. Final whole-branch review fix wave.** A number-and-attribution
      divergence bug reached the default path: `_default_figures_loader` reached
      `_dcf_snapshot` and `metrics_for_ticker` for the figures but dropped both
      quality discriminators they already compute (`bridge_quality`, and
      `metrics_for_ticker`'s discarded `is_real` flag), so a ticker with no
      statements, no `corporate_metrics` row, and no equity bridge got a decision
      row with a fabricated `dcf_value` (enterprise value, not per-share),
      `dcf_implied_return=0.0`, and hash-derived `roic`/`wacc`, all under a
      captured `figures_source` with `figures_unavailable_reason` NULL -- the
      third occurrence of the discriminator-dropped-on-reuse defect class (see
      `ERROR-LOG.md` 2026-09-03). Fixed by adding
      `metrics_for_ticker_with_provenance` and gating `record_decision` on both
      discriminators, mirroring the existing non-positive-price guard.
      Also: `DecisionRow`/`DecisionOutcome` now expose the gap and the move on
      the SAME scale (`dcf_implied_return_pct`, `outcome.price_move_pct` --
      previously 100x apart, DB columns unchanged); `metric_schema_version`,
      `risk_free_rate` and `equity_risk_premium` are now on the wire (previously
      stored and unreturned); the allowlist test guarding "never combine the gap
      and the move" (E5) is now also asserted at the route/wire layer, not just
      the service dict; a blank `ticker` (`"  "`) is now a 422, mirroring the
      memo validator; and E's own "known limits" bullet about the bars loader
      below is resolved. Full report:
      `.superpowers/sdd/2026-09-03-snapshot-overhaul-backend/final-fix-report.md`.

      **Review of the fix wave found its verification weaker than reported.** The
      new guard is two conditions in an `elif` chain, and the reproduction case
      trips both, so each could be deleted alone with all 949 tests still green;
      hardcoding either discriminator inside `_default_figures_loader` was also
      uncaught, and `metrics_for_ticker_with_provenance` -- the function the fix
      rests on -- had no direct test. Four tests added to isolate each condition
      and to assert the loader's output directly rather than through the guard
      chain; all six mutations are now caught by a named test. The lesson is in
      `ERROR-LOG.md`'s amendment: mutate chained conditions ONE AT A TIME, or the
      strongest evidence a suite can give certifies less than it sounds like.

### Not done, deliberately

- [ ] **E7. Run the reset.** `python scripts/reset_snapshots.py` clears all three
      snapshot tables (139 + 0 + 880 rows) after backing the database up. The
      script is written and tested; it has NOT been run. Snapshot rows are
      point-in-time records that cannot be regenerated, so the irreversible step
      is left to a human hand even though it was authorised.

- [ ] **E8. `GET /api/v1/decisions/{id}`.** Spec §4 names it; no task implemented
      it. Nothing consumes it -- the list endpoint already returns every decision
      with its outcome -- so it waits for the frontend plan to supply a real
      caller rather than being built on speculation.

- [ ] **E9. The frontend.** The `/decisions` page and the spec's §6 scatter chart
      (gap-at-decision against price-move-since, two labelled series, no trend
      line and no R²). Its plan is written after this ships, against a real API
      response rather than an imagined one.

### Known limits of this iteration

- **`list_decisions` calls the bars loader once per decision**, with no de-dup
  across repeated tickers. Acceptable for a personal decision log; it would not
  be for a paginated endpoint.
- **The empty-memo route test passes if only the Pydantic validator is removed**,
  because `record_decision` guards independently. That redundancy is deliberate
  defence in depth, but the route test alone does not pin the request model.
- **Deferred from the spec:** readable snapshot identity, charts over snapshot
  history, and the pre-existing annual-vs-horizonless conflation in
  `expected_return_spread`, which predates this work and touches `/corporate`.

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
