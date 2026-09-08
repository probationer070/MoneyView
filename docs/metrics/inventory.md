# Metric Reference — Source Inventory

Confirmed 2026-09-08 against the working tree at `e9d4112` (branch `metric-reference`).
This table is the authority for what gets an entry in `docs/metrics/`. The spec's
50 (`docs/superpowers/specs/2026-09-08-metric-reference-design.md` §2) were
candidates enumerated from the outside; this is what a family-by-family read of
`packages/core_finance/` and the four named `apps/api` files actually has, with
every claim checked against a specific `file:line`.

**Headline finding.** Of the spec's 50 candidates: **38 confirmed distinct**
implementation sites, **4 duplicates** of another candidate already in this
table (`trailing_pe_series`, `dcf_implied_return_pct`, `roic`-at-decision,
`wacc`-at-decision), and **8 not present** — the named function exists in
source but is never invoked from anywhere under `apps/`, confirmed by a
repo-wide grep for its import, not merely absent from the one call site the
spec author had in mind (`calculate_crp`, `calculate_wacc`,
`decompose_hurdle_rate`, `wacc_sensitivity`, `unlever_beta`, `relever_beta`,
`bottom_up_beta`, `calculate_fcff`). One additional duplicate
(`stock_expected_return`) was found but was never one of the spec's named 50,
so it is recorded but not counted in the totals below. 4 genuinely new
candidates were found and deliberately not added — see "Follow-up candidates".

Two entire core_finance modules turned up nothing: `risk_analysis.py`
(`payback_period`, `sensitivity_analysis`, `monte_carlo_npv`) is dead code with
zero references anywhere under `apps/`, and `packages/core_finance/hurdle_rate.py`
is likewise never imported by `apps/` at all — WACC and the beta used against it
are reported as stored/passthrough inputs, not computed by this module's
formulas. See "Notable findings" at the end.

38 confirmed + 4 duplicates + 8 not-present = 50. **This exact reconciliation to
50 is itself a flag, not a clean result** — see the note at the end of this file
before trusting it.

| Metric | Family | Source | Status |
| --- | --- | --- | --- |
| `drawdown` | price-signals | `packages/core_finance/price_signals.py:19` `drawdown_from_peak` | distinct |
| `volume_ratio` | price-signals | `packages/core_finance/price_signals.py:35` `volume_ratio` | distinct |
| `trailing_pe` | price-signals | `apps/api/services/valuation_verdict.py:446` (inline `price / eps`) | distinct |
| `pe_change` | price-signals | `packages/core_finance/price_signals.py:63` `pe_change` | distinct |
| `market_expected_return` | discount-rates-and-returns | `packages/core_finance/expected_return.py:32` `calculate_market_expected_return`; reported `apps/api/services/corporate_comparison.py:449,473` | distinct |
| `capm_expected_return` | discount-rates-and-returns | `packages/core_finance/expected_return.py:41` `calculate_capm_expected_return`; reported `apps/api/services/corporate_comparison.py:447` | distinct |
| `dcf_implied_return` | discount-rates-and-returns | `packages/core_finance/expected_return.py:54` `calculate_dcf_implied_return`; reported `apps/api/services/corporate_comparison.py:446` | distinct |
| `expected_return_spread` | discount-rates-and-returns | `packages/core_finance/expected_return.py:65` `calculate_expected_return_spread`; reported `apps/api/services/corporate_comparison.py:450` | distinct |
| NOPAT | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:279` `calculate_nopat` | distinct |
| average invested capital (ROIC denominator) | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:314` `average_invested_capital_result` (calls `calculate_invested_capital:289`) | distinct |
| ROIC | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:349` `build_roic_records`, basis dispatch at `:499` `roic_value` | distinct |
| ROIC quality | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:512` `assess_roic_quality` | distinct |
| revenue growth | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:400` `annual_growth_rates`, `:446` `stable_growth_payload`, basis dispatch at `:481` `growth_value` | distinct |
| growth quality | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:435` `assess_growth_quality` | distinct |
| effective tax rate | fundamental-quality | `packages/core_finance/corporate_statement_metrics.py:254` `stable_tax_result` | distinct |
| `calculate_terminal_value` | dcf-mechanics | `packages/core_finance/dcf.py:41`; live only via the sensitivity grid path (`sensitivity_cell:181` → `multi_stage_dcf:124`), NOT the base-case report | distinct |
| `calculate_npv` | dcf-mechanics | `packages/core_finance/dcf.py:61`; same transitive path as above | distinct |
| `calculate_net_debt` | dcf-mechanics | `packages/core_finance/dcf.py:87`; `apps/api/services/equity_bridge.py:22` | distinct |
| `calculate_equity_value` | dcf-mechanics | `packages/core_finance/dcf.py:74`; `apps/api/services/corporate_comparison.py:26` | distinct |
| `calculate_intrinsic_value_per_share` | dcf-mechanics | `packages/core_finance/dcf.py:107`; `apps/api/services/corporate_comparison.py:26` | distinct |
| segment revenue path | dcf-mechanics | `packages/core_finance/segment_valuation.py:388` `revenue_path` (4 shapes); used by `apps/api/services/valuation_case.py` | distinct |
| sales-to-capital reinvestment | dcf-mechanics | `packages/core_finance/segment_valuation.py:485` `reinvestment` | distinct |
| `terminal_capital_intensity_change` | dcf-mechanics | `packages/core_finance/segment_valuation.py:774` (field), computed `:951` in `run_case` | distinct |
| `dcf_gap` | verdict-panel | `apps/api/services/valuation_verdict.py:486` | distinct |
| `direction` (fixed framing constant) | verdict-panel | `apps/api/services/valuation_verdict.py:29` `DIRECTION` | distinct |
| `price_move_pct` | verdict-panel | `apps/api/services/investment_decision.py:52` (`price_move`, raw fraction); percent conversion at `apps/api/models/schema_parts/decision.py:42-51` | distinct |
| `resolve_benchmark` (sector benchmark average) | industry-benchmarks | `packages/core_finance/industry_benchmark.py:155`; `apps/api/services/industry_benchmark_store.py:181` | distinct |
| `fade` (conservative-direction normalisation) | industry-benchmarks | `packages/core_finance/industry_benchmark.py:250`; `apps/api/services/conservative_case.py:209` | distinct |
| `screen_row` (firm-count floor) | industry-benchmarks | `packages/core_finance/industry_benchmark.py:103`, `MIN_FIRMS` at `:28` | distinct |
| `screen_value` (plausibility band) | industry-benchmarks | `packages/core_finance/industry_benchmark.py:113`, bands at `:53-79` | distinct |
| `column_by_key` (benchmark column lookup) | industry-benchmarks | `packages/core_finance/industry_benchmark.py:84`; `apps/api/services/conservative_case.py:189` | distinct |
| Shapley contribution | attribution-and-uncertainty | `packages/core_finance/shapley.py:22` `shapley_contributions`; `apps/api/services/case_diff.py:115` | distinct |
| Spearman `association` | attribution-and-uncertainty | `packages/core_finance/rank_correlation.py:36` `spearman`; `apps/api/services/case_simulate.py:305-308` (`association_among_accepted_samples`) | distinct |
| `three_p` | attribution-and-uncertainty | `apps/api/services/case_fork.py:41` `_THREE_P`, applied `:112`; also `case_simulate.py:85` | distinct |
| `REFUSED_FRACTION_CAP` | attribution-and-uncertainty | `apps/api/services/case_simulate.py:46`, applied `:56-60,263-270` | distinct |
| `SHAPLEY_INPUT_CAP` | attribution-and-uncertainty | `apps/api/services/case_diff.py:31`, applied `:93-97` | distinct |
| `confidence` (segment-narrative label) | attribution-and-uncertainty | `apps/api/services/case_fork.py:50` `_CONFIDENCE`, applied `:123`; also `case_simulate.py:93` | distinct |
| Monte Carlo summary (`p10`/`p50`/`p90`/`mean`, conditional on acceptance) | attribution-and-uncertainty | `apps/api/services/case_simulate.py:280-295` | distinct |

## Dropped candidates

| Candidate | Why |
| --- | --- |
| `trailing_pe_series` (`packages/core_finance/price_signals.py:45`) | duplicate of `trailing_pe`. Confirmed unreferenced by any `apps/api` caller (grepped repo-wide); `valuation_verdict.py:446` computes the reported `trailing_pe` field directly as `price / eps`, not through this series function. Same concept, two formulas — the entry for `trailing_pe` should note this divergence rather than documenting a second, unused one. |
| `stock_expected_return` (`packages/core_finance/expected_return.py:27,89`) | duplicate of `dcf_implied_return`. `ExpectedReturnResult.stock_expected_return` is assigned literally as `dcf_implied_return` (line 89) — the two fields are numerically identical by construction, always. Not one of the spec's named 11 for this family, but worth recording because a future editor could mistake it for a sixth CAPM-family metric. |
| `dcf_implied_return_pct` (`apps/api/models/schema_parts/decision.py:67`) | duplicate/snapshot of `dcf_implied_return`. Populated from `apps/api/services/corporate_comparison.py:340-372` (`_dcf_snapshot`), which calls the same `calculate_expected_return_result` already documented under `dcf_implied_return`. This copy exists to freeze the figure at decision time (see `metric_schema_version` in Follow-up candidates), not to compute something new. |
| `roic` (`apps/api/models/schema_parts/decision.py:68`) | duplicate/snapshot of ROIC, same `_dcf_snapshot` provenance as above. |
| `wacc` (`apps/api/models/schema_parts/decision.py:69`) | duplicate/snapshot of the WACC figure reported by `corporate_dcf.py` (see Follow-up candidates — the live figure itself is not one of this plan's 50 either), same `_dcf_snapshot` provenance. |
| `calculate_crp` (`packages/core_finance/hurdle_rate.py:35`) | not present. Repo-wide grep for `from packages.core_finance.hurdle_rate` finds zero hits under `apps/` — this module is imported nowhere outside itself and `packages/core_finance/__init__.py`'s re-export. |
| `calculate_wacc` (`packages/core_finance/hurdle_rate.py:76`) | not present, same reason. The WACC actually reported (`corporate_dcf.py:132,295`) is a caller-supplied input clamped to a floor, not this function's `(E/V)r_e + (D/V)r_d(1-t)` decomposition. |
| `decompose_hurdle_rate` (`packages/core_finance/hurdle_rate.py:55`) | not present, same reason. |
| `wacc_sensitivity` (`packages/core_finance/hurdle_rate.py:108`) | not present, same reason. Note the name collision risk with `packages/core_finance/dcf.py:226` `sensitivity_grid`, which IS live and does something superficially similar (a WACC axis) but sweeps WACC × terminal growth, not WACC × D/E. |
| `unlever_beta` (`packages/core_finance/beta.py:14`) | not present. Zero references under `apps/`; `tests/core_finance/test_beta.py` is the only caller in the repo. |
| `relever_beta` (`packages/core_finance/beta.py:23`) | not present as a call site, though its formula is duplicated inline at `apps/api/services/corporate_comparison.py:1129-1131` (`_levered_beta_from_metrics`, the same Hamada relever expression, hand-rolled rather than calling this function). Flagged as a finding below, not fixed. |
| `bottom_up_beta` (`packages/core_finance/beta.py:32`) | not present, same reason as `unlever_beta`. The whole peer-averaging methodology its docstring describes is never executed in production; beta is taken directly from a stored `CorporateMetrics.unlevered_beta`. |
| `calculate_fcff` (`packages/core_finance/dcf.py:13`) | not present. Zero references under `apps/`, and not even used internally by `multi_stage_dcf`/`sensitivity_grid`, which both take a pre-computed FCFF list rather than deriving one. |

## Follow-up candidates (NOT in this plan's scope)

Genuinely new metrics found while confirming, recorded rather than absorbed.

| Candidate | Source | Why it may deserve an entry |
| --- | --- | --- |
| `wacc` (as actually reported) | `apps/api/services/corporate_dcf.py:132` (floored at 0.001), `:295` (`wacc_used`) | The figure a reader actually sees is a clamped input, not the `hurdle_rate.py` decomposition the spec's candidate list assumed. Its own guard (floor at 0.001) and its relationship to `terminal_growth`'s clamp (`min(terminal_growth_rate, wacc - 0.005)`, line 133) are exactly the kind of implementation-specific semantics §3.3 asks for. |
| `unlevered_beta` (as actually reported) | `apps/api/services/corporate_dcf.py:309` (`DCFWaccBreakdown`) | Reported as a stored/passthrough value (`params.unlevered_beta or metrics.unlevered_beta`), not computed by `beta.py:14`. A reader could reasonably assume "unlevered" here means this codebase performed the unlevering; it did not, at least not in this code path. |
| Sensitivity grid (`sensitivity_grid`/`sensitivity_cell`, `undefined_reason`) | `packages/core_finance/dcf.py:226,181`; reported via `apps/api/services/corporate_dcf.py:230-259` as `DCFSensitivityGrid`/`DCFSensitivityCell` | Live and reported, not in the spec's 9 for dcf-mechanics. Carries a specific misreading risk worth flagging for whoever writes the entry: the grid's `is_base` cell is produced by `multi_stage_dcf` (via `calculate_terminal_value`/`calculate_npv`), while the headline base-case numbers in the SAME report (`corporate_dcf.py:141-165`) are computed by an independent, hand-rolled implementation of the same formulas. The two are not guaranteed to agree exactly and no test in this pass confirmed they do — see "Notable findings" below. |
| `metric_schema_version` | `apps/api/models/schema_parts/decision.py:80` | Exists specifically because a stored decision's dollar figures can be silently reinterpreted under today's defaults once `DEFAULT_RISK_FREE_RATE`/`DEFAULT_EQUITY_RISK_PREMIUM` change (see the docstring at lines 70-80 and `ERROR-LOG.md`'s 2026-08-05 entry). That is a textbook "material interpretive ambiguity" candidate, but it wasn't part of the enumerated 50 and is not added here. |

## Notable findings (not fixed — recorded per the task's constraints)

- **`packages/core_finance/risk_analysis.py` is entirely dead code.** `payback_period`, `sensitivity_analysis`, and `monte_carlo_npv` have zero references anywhere under `apps/` (confirmed by repo-wide grep). None of the spec's 50 candidates map to this file, and no family's description covers "risk analysis" as a topic — the spec's own family list corroborates that this module was never in scope, even though the task-1 brief names it as a file to check.
- **`packages/core_finance/hurdle_rate.py` is entirely unused in production.** All four functions (`calculate_crp`, `calculate_wacc`, `decompose_hurdle_rate`, `wacc_sensitivity`) are imported nowhere under `apps/` — not even a single call site. WACC and the beta figures the API actually reports (`corporate_dcf.py`) are stored/passthrough inputs, not the output of this module's formulas.
- **`packages/core_finance/beta.py` is effectively unused.** `unlever_beta` and `bottom_up_beta` have zero callers under `apps/`. `relever_beta`'s formula is live, but only as a hand-duplicated reimplementation at `apps/api/services/corporate_comparison.py:1129-1131` — the shared function itself is never called. A future change to the Hamada formula in `beta.py` would not propagate to this call site; the two must be kept in sync by hand today, and nothing enforces that.
- **`packages/core_finance/dcf.py`'s `calculate_fcff` is dead code**, and so is `calculate_growth_rate` (`dcf.py:28`, not one of the spec's 9 but checked while confirming). Neither has a caller anywhere in `apps/` or in `packages/core_finance` itself — `multi_stage_dcf` and `sensitivity_grid` both take a pre-computed FCFF list as an argument rather than deriving it.
- **The DCF report's base case and its own sensitivity grid use two independent implementations of the same formulas.** `apps/api/services/corporate_dcf.py:141-165` hand-computes projected FCFF, terminal value, and PV inline; the sensitivity grid built two lines later (`:230`) calls `packages/core_finance/dcf.py`'s `sensitivity_grid` → `multi_stage_dcf` → `calculate_terminal_value`/`calculate_npv` for the identical inputs. The `is_base` cell is documented (`dcf.py:236-239`) as reproducing the base valuation "exactly," but the two code paths are not the same code, and confirming that claim was out of scope for a documentation-only task — it deserves a test, not an inventory row.

## On the reconciliation to exactly 50

38 distinct + 4 duplicate + 8 not-present sums to exactly 50, matching the
spec's total. That is called out explicitly per the task instructions: **an
exact match is a reason for suspicion, not confidence.** Two things make this
particular reconciliation more defensible than a coincidence would be:

1. It required real, family-by-family fixes that pulled in different
   directions — `discount-rates-and-returns` came in at 4 confirmed against 11
   candidates (7 absent), while `fundamental-quality` and `industry-benchmarks`
   confirmed at their full spec counts (7 and 5) with no drops at all. A
   shallow pass that just accepted the spec's list would show 50/50/0/0
   everywhere; this one does not.
2. The two families with drops (`price-signals`, `discount-rates-and-returns`,
   `dcf-mechanics`, `verdict-panel`) each have an independently-verified
   reason cited above (a grep with zero hits, a literal field aliasing, a
   dataclass line assigning one field from another) rather than a judgment
   call dressed up as a fact.

The total matching 50 is nonetheless a coincidence of family-level
over- and under-counts, not evidence the spec's per-family enumeration was
individually correct. A reviewer should re-check the family-level math above,
not the headline total.
