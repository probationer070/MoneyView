# Development Todo

Purpose: track the active implementation plan for aligning corporate metric calculation, audit payloads, and UI exposure with `guideline/suggestion.md`.

Status snapshot: as of 2026-04-26, the backend extraction and stable ROIC/Growth formula work are largely in place. The remaining work is to finish verification and fully enforce the suggestion-doc rules for metric versioning, unified audit payloads, and required metadata across API and UI contracts.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses



## ROIC And Growth Upgrade Plan

Source:
- `guideline/suggestion.md`
- `guideline/finance-logic.md`

Problem:
- `guideline/suggestion.md` sets four explicit rules that must now drive the remaining implementation work:
  - version metric calculations instead of overwriting existing historical fields
  - expose CAGR as the primary growth metric in the main UI
  - keep a single unified audit payload for corporate metrics
  - always include method and quality metadata on decision-grade metrics
- The backend formula upgrade work is mostly complete, but `guideline/todo.md` still leaves some of those rules as open decisions instead of required follow-through tasks.
- The next step is to treat the suggestion doc as the source of truth for contract cleanup, metadata consistency, and regression coverage.

Target outcome:
- Statement-derived ROIC and Growth use a single stable calculation pipeline shared by metrics, history, and audit payloads.
- Existing fields are not silently repurposed; stable calculations are versioned so history remains reproducible and auditable.
- ROIC, Growth, and downstream DCF assumptions expose method, quality, confidence, notes, and calculation-version metadata consistently.
- UI surfaces distinguish `primary decision metric`, `supporting context`, and `suppressed metric` from one backend contract.
- Audit data for ROIC, Growth, DCF, and WACC remains unified in one response shape instead of fragmenting into separate audit endpoints.

Implementation track:

Phase 1 - Extract reusable finance logic:
- [x] Create a reusable backend calculation module outside `apps/api/routes`.
  - Preferred ownership:
    - reusable formulas and pure helpers in `packages/core_finance`
    - Yahoo statement orchestration and mapping in `apps/api/services`
- [x] Move or reimplement the following route-local helpers behind that service boundary:
  - `_annual_growth_rates`
  - `_growth_value`
  - `_roic_value`
  - ROIC record assembly in `_yahoo_statement_metrics()`
  - ROIC audit record assembly in `_build_metric_audit()`
- [x] Keep `apps/api/routes/corporate.py` responsible only for request parsing and response shaping after the extraction.

Phase 2 - Replace formula policy with stable ROIC:
- [x] Implement the `guideline/suggestion.md` safe-number and clamp helpers in the shared finance path.
- [x] Replace tax normalization with:
  - positive pretax years only
  - ignore negative and absurd tax rates
  - median valid rate
  - clamp to configured min and max bounds
  - fallback note when no valid tax rate exists
- [x] Replace invested-capital policy with the stable definition from `guideline/suggestion.md`:
  - `invested_capital = total_stockholder_equity + short_term_debt + long_term_debt`
  - do not subtract cash from the denominator
  - reject zero, negative, or tiny invested capital
- [x] Compute average invested capital from current and previous balance-sheet rows when possible, with explicit fallback notes when previous-year data is unavailable.
- [x] Apply ROIC sanity gating from the suggestion doc before promoting the value to decision surfaces.
- [x] Preserve both:
  - raw computed decimal value for debugging/audit
  - final percent value plus quality flag for UI

Phase 3 - Replace primary growth-rate policy:
- [x] Make revenue CAGR from annual statement history the primary Growth Rate for corporate metrics.
- [x] Require at least two valid annual revenue points and reject tiny or non-positive revenue bases.
- [x] Add growth sanity bounds from `guideline/suggestion.md` so absurd CAGR outputs are suppressed instead of displayed.
- [x] Keep average annual YoY growth only as a secondary supporting metric for audit/detail views, not the default decision metric.
- [x] Review whether `growth_basis` should remain externally selectable for UI exploration or be narrowed so the default endpoint always returns the stable CAGR as the main value.

Phase 4 - Align endpoint contracts and downstream usage:
- [x] Extend backend response payloads so ROIC and Growth include:
  - quality flag
  - warnings or notes
  - source selection
  - calculation version
  - primary-vs-supporting metric role where needed
- [x] Review model impacts in:
  - `apps/api/models/schema_parts/corporate.py`
  - `apps/api/models/schemas.py`
  - `packages/shared-types/corporate.ts`
- [x] Update `_valuation_params_from_metrics()` in [apps/api/routes/corporate.py](/E:/MoneyView/apps/api/routes/corporate.py:270) so downstream DCF inputs consume the stabilized Growth and ROIC outputs intentionally rather than assuming all metric values are equally trustworthy.
- [x] Confirm Corporate Analysis UI copy in `apps/web/app/corporate/` reflects:
  - CAGR as the primary Growth Rate
  - supporting annual-growth rows as secondary context
  - ROIC suppression or downgrade when quality is not decision-grade

Phase 4A - Enforce suggestion-doc contract rules:
- [x] Preserve legacy and stable metric variants side-by-side instead of switching fields in place.
  - Example target shape:
    - `roic_legacy`
    - `roic_stable_v2`
    - `growth_avg_legacy`
    - `growth_cagr_v2`
- [x] Ensure each decision-grade metric carries explicit metadata from `guideline/suggestion.md`:
  - `method`
  - `quality`
  - `confidence`
  - calculation notes or warnings where fallback logic applies
- [x] Review whether all frontend-consumed responses expose stable version identifiers consistently enough to support auditability and future formula changes.
- [x] Confirm main UI views display only CAGR as Growth while keeping average YoY growth confined to audit or detail contexts.
- [x] Confirm the corporate audit response remains a single unified payload containing at least:
  - `roic`
  - `growth`
  - `dcf`
  - `wacc`

Phase 5 - Verification and regression coverage:
- [x] Add pure-finance tests for the new ROIC and growth helpers under `tests/core_finance/`.
  - valid median tax-rate case
  - fallback tax-rate case
  - missing operating-income case
  - tiny or negative invested-capital rejection
  - previous-year invested-capital fallback
  - ROIC outlier rejection
  - valid CAGR case
  - insufficient revenue history case
  - invalid revenue-base case
  - growth outlier rejection
- [x] Update route or service tests under `tests/api/` to verify:
  - metrics endpoint returns stable Growth and ROIC from the new pipeline
  - metric audit endpoint exposes the new notes and quality states
  - suspicious or invalid values are suppressed from primary decision payloads
  - legacy and stable versioned fields coexist without overwriting historical semantics
  - unified audit payload contains growth, ROIC, DCF, and WACC together
- [x] Update any fixtures or E2E mocks that currently assume the old denominator or growth-basis behavior.

Resolved direction from `guideline/suggestion.md`:
- [x] Stable ROIC and Growth should be introduced as versioned calculations instead of overwriting historical fields.
- [x] CAGR is the primary Growth metric for main UI surfaces; average YoY remains supporting audit context only.
- [x] Growth audit should stay inside the existing unified corporate metric audit payload alongside ROIC, DCF, and WACC.
