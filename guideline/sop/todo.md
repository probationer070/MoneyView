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

## Where things stand (2026-08-30)

`renewal` @ `e28be2a`, **862 tests passing**, no skips or xfails.

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

## Track B - Close the defect class on the verdict panel

**Do this before adding a fifth signal to the panel.** This is the recommended
next piece of work.

`apps/api/services/valuation_verdict.py` needed **ten** review rounds, and every
defect belonged to one class: a number or refusal wearing an attribution it has
not earned. Eight times, fixing one instance created or left a sibling.

The structural cause: `_own_window_source` concatenates four independently
gated clauses (window count, dropped bars, span, full-history), and **the
concatenation is unowned** -- each clause is individually true, and until the
last commit nothing asserted anything about the assembled sentence.

- [ ] **B1. Property test: clause-to-noun attachment.** One exists already
      (`test_no_source_string_ever_claims_more_bars_than_its_span_can_hold`) --
      the count immediately preceding a span must fit inside that span. Extend
      the idea so every parenthetical must attach to the clause it describes.
      A shipped defect read `550 of 800 stored bars have a close (spans ...)`
      across 500 days; 550 daily bars cannot span 500 days.

- [ ] **B2. Property test: subject-vs-peer basis symmetry.** Whatever basis the
      subject's `source` names, the peer clause must name the same one. Every
      cross-basis defect found so far -- a `252d` label on a 502-day window,
      peers measured over their own positions rather than the subject's dates --
      would have failed such a test.

- [ ] **B3. Consider restructuring the helper** so each clause declares its own
      subject rather than being concatenated positionally. Judgement call; the
      property tests may be enough on their own.

**Estimate: about half a day. It is the difference between the next signal
costing one review round or nine.**

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
