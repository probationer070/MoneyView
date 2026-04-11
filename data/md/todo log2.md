# Corporate Target Metrics And Safe Sync Todo

Purpose: extend corporate analysis and portfolio/watchlist workflows so every target stock can be compared on value creation, intrinsic value, and return expectations without corrupting user-managed portfolio weights.

## Confirmed Current State

- [x] `watchlist` in SQLite is the live mutable store already used by the Portfolio page.
- [x] `stock_targets.json` is currently treated as a seed/import source and as a manual resync source.
- [x] Portfolio attribution in `apps/web/app/portfolio/page.tsx` still ignores stored `watchlist.weight` and forces equal-weight baskets.
- [x] Corporate metrics already persist ticker-level `growth`, `roic`, `wacc`, `fcff`, and related assumptions in `corporate_metrics`.
- [x] Corporate DCF already returns `estimated_value`, `current_price`, and `upside_pct`, but there is no persisted cross-stock comparison surface yet.
- [x] There is no explicit backend formula or stored field for market expected return today.

## Formula Decisions

- [ ] Reconfirm and document the market expected return formula in backend-owned finance logic.
- [ ] Prefer a backend-derived formula, not frontend-only math.
- [ ] If a reusable formula does not already exist in `packages/core_finance`, add one there instead of embedding it in route handlers.
- [ ] Start with a clear definition for comparison:
  `market_expected_return = risk_free_rate + equity_risk_premium`
- [ ] If the implementation needs stock-specific expected return rather than generic upside:
  `stock_expected_return = market_expected_return + alpha`
  or
  `stock_expected_return = dcf_implied_return`
  The final implementation must choose one explicit definition and label it in the API/UI.
- [ ] For the stock-vs-market comparison metric, store and expose:
  `expected_return_spread = stock_expected_return - market_expected_return`

## Per-Stock Metrics Going Forward 

- [ ] For every target stock, record and expose `roic_minus_wacc` at portfolio level.
- [ ] For every target stock, record and expose DCF-derived value output at portfolio level.
- [ ] For every target stock, record and expose stock expected return, market expected return, and expected-return spread at portfolio level.
- [ ] Define whether these values are persisted snapshots, computed on read, or both.
- [ ] Keep the source labels explicit so users can distinguish:
  `saved corporate assumptions`
  `live market price`
  `derived market expected return`
  `derived stock expected return`

## Backend

- [ ] Add reusable finance helper(s) in `packages/core_finance` for market expected return and return-spread calculations if missing.
- [ ] Extend the corporate service/route layer with a comparison-oriented payload for all target stocks.
- [ ] Add a backend-owned section that compares each stock on:
  `ROIC - WACC`
  `DCF value`
  `Expected stock return vs market expected return`
- [ ] Keep route handlers thin; calculation and sync logic should live in services or shared finance packages.
- [ ] Decide whether to add a new comparison endpoint or extend an existing corporate/portfolio endpoint without breaking current consumers.
- [ ] If API payloads consumed by the web change materially, update `packages/shared-types`.

## Comparison Surface

- [ ] Enable comparison of the three required metrics across all target stocks in one backend response.
- [ ] Return comparison rows keyed by ticker with stable names/sectors where available.
- [ ] Include enough fields for sorting/filtering in the UI:
  ticker, name, sector, weight, roic, wacc, roic_minus_wacc, dcf_value, current_price, stock_expected_return, market_expected_return, expected_return_spread.
- [ ] Ensure the comparison response remains usable even when some stocks are missing statement data or live price data. (if missing, return "no statement data" or "no live price data")
- [ ] Fail soft per ticker rather than failing the entire comparison set.

## Sync Model

- [ ] Add an explicit sync button in the relevant UI, backed by a dedicated API action rather than silent automatic overwrite behavior.
- [ ] Treat SQLite `watchlist` as the source of truth for mutable portfolio allocation weights.
- [ ] Treat `stock_targets.json` as an import/export or seed snapshot, not the primary mutable store.
- [ ] Avoid any sync behavior that overwrites user-adjusted `watchlist.weight` by default.
- [ ] Define sync direction explicitly before implementation:
  preferred default: `watchlist -> stock_targets.json`
  reason: current weights are mutable in DB and should survive file regeneration/resync.
- [ ] If JSON introduces new tickers, merge them in without resetting existing DB weights.
- [ ] If DB has tickers missing from JSON, preserve them unless the user explicitly requests destructive reconciliation.
- [ ] If both sides contain the same ticker, preserve DB weight by default and only refresh metadata fields that are safe to sync.
- [ ] Keep ticker identity normalization strict: uppercase ticker key, stable dedupe behavior.

## Weight Storage Rules

- [ ] Preserve and expose per-stock portfolio allocation weights in `watchlist`.
- [ ] Stop treating attribution inputs as forced equal weight once stored weights are available for use.
- [ ] Decide whether weights must auto-normalize to 1.0 on save or may remain partial with cash implied.
- [ ] Keep the current `PortfolioInput` validation rules aligned with whatever watchlist-weight editing model is chosen.
- [ ] Ensure sync does not silently convert intentionally sparse weights into equal weights.

## Frontend

- [ ] Add a sync control with clear wording about which side is authoritative.
- [ ] Show the last sync result/source so users can tell whether data came from JSON import, DB export, or manual merge.
- [ ] Add a comparison section/table for all target stocks covering the three required metrics.
- [ ] Update existing portfolio copy that currently states the basket is equal-weight once the backend/frontend start honoring stored weights.
- [ ] Keep page-level mutation ownership in route pages or container-level logic, not presentational chart components.

## Data Safety

- [ ] No destructive sync by default.
- [ ] Any operation that can overwrite JSON or DB rows should be explicit and scoped.
- [ ] Preserve existing ticker metadata and user-added companies where possible.
- [ ] Make merge behavior deterministic and testable.
- [ ] Document source-of-truth behavior in code comments or architecture notes if the final implementation meaningfully changes current workflow.

## Verification

- [ ] Add backend tests for market expected return formula behavior and stock-vs-market spread calculations.
- [ ] Add backend tests for comparison payload assembly across multiple tickers.
- [ ] Add backend tests for safe sync behavior:
  DB weights preserved on sync
  new JSON tickers merged safely
  existing JSON export includes weights
  no empty/invalid JSON corruption path
- [ ] Add frontend verification for the new sync button and metric comparison surface.
- [ ] Update any assertions that currently assume equal-weight-only portfolio attribution if that behavior changes.

## Risks To Watch

- [ ] Do not let JSON resync wipe out user-managed weights in `watchlist`.
- [ ] Do not hide whether expected return is market-level, DCF-implied, CAPM-style, or another derived number.
- [ ] Do not duplicate financial formulas across backend and frontend.
- [ ] Do not break current corporate metrics persistence while adding comparison snapshots or derived fields.
- [ ] Do not ship a comparison table that mixes persisted values and live-derived values without labeling the source.
