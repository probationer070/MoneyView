1. Comparison: Computed on Read vs. Persisted Snapshots

Recommendation:
Persisted snapshots (default) + real-time calculation option (hybrid)

→ This aligns exactly with the intended direction: 
“Use snapshot-based storage while also allowing real-time computation.”

Reasons (aligned with user goals):

- Historical record is essential:
  Without daily snapshots of ROIC-WACC, DCF, and 
  “expected stock return vs. market expected return,” 
  it is impossible to reproduce the exact comparison results viewed on a given day.
  Using only computed-on-read causes values to change on every refresh,
  making backtesting and indicator validation impossible.

- Auditability & reproducibility:
  Since this data is used for actual investment decisions,
  an “as of” timestamp is required.

- Performance:
  Persisted data is significantly faster for dashboards and tables
  where users want to compare multiple stocks at a glance.

- Mitigating drawbacks:
  Issues like stale data can be solved with:
    - Daily automatic snapshot generation
    - Manual “Refresh” button for users

Problems with Computed-on-Read Only:

- No historical comparison → cannot achieve “investment indicator testing”
- Results change on every page load due to live prices and assumptions → reduces trust

Enhancements after selection:

- Hybrid UI:
  Default: show latest persisted daily snapshot
  Toggle: “Live” button → switch to computed-on-read mode instantly

- Snapshot policy:
  - Auto-generate daily at 00:00 (KST) via cron job
  - Allow manual “Save as snapshot” at any time
  - Retention: 1 year (or unlimited, depending on storage cost)

- View separation:
  - Watchlist View: computed-on-read (lightweight tracking)
  - Portfolio View: persisted snapshots (investment + history)


2. Watchlist Weights: Auto-normalize vs. Partial Weights with Implied Cash

Recommendation:
Partial weights with implied cash (total < 100% = cash holding)

→ Matches the intended direction:
“Weight-based portfolio with explicit cash consideration.”

Reasons (aligned with user goals):

- Need flexible cash allocation:
  Users must be able to simulate portfolios like
  “70% invested, 30% cash.”
  Auto-normalize forces everything to 100%, distorting tests.

- Preserve user intent:
  Adjusting one stock should NOT automatically change others.

- Custom UI flexibility:
  Independent sliders for:
    - Cash allocation
    - Each stock weight
  → ideal for real investment testing

- Clear separation:
  - Watchlist: simple list (no weights)
  - Portfolio: weighted + cash-based structure

Problems with Auto-normalize:

- Cannot test cash positions → invalidates market-risk comparisons
- Editing one stock changes others automatically → confusion + poor reproducibility

Enhancements after selection:

- UI improvements (required):
  - Show “Total Allocation” (e.g., 82.5% invested + 17.5% cash)
  - Provide “Auto-normalize to 100%” button (optional use only)
  - Handle >100%:
      - Warn user + cap OR
      - Allow and mark as “Leverage”

- Attribution logic:
  - Represent cash as a separate row (“Cash”)
  - Expected return:
      - 0% OR risk-free rate
  - Include cash in weighted average calculations

- View differentiation:
  - Watchlist View:
      - No weights or default 0% (comparison only)
  - Portfolio View:
      - Partial weights + cash + snapshots (testing & tracking)


3. Final Recommended Architecture

Category        | Watchlist (Tracking)             | Portfolio (Investment)                  | Notes
-----------------------------------------------------------------------------------------------
Comparison      | Computed-on-read (default)       | Persisted snapshots (default) + Live   | Hybrid model
Weights         | No weights (simple list)         | Partial weights + implied cash         | Cash supported
Daily Updates   | Real-time                        | Daily snapshot auto-save              | Historical tracking
Custom UI       | Not required                     | Cash + weight control UI              | Testing-focused
Audit/History   | Not required                     | Snapshot history                      | Core for backtesting


4. Implementation Priority

Phase 1 (Current Sprint):
- Implement partial weights + implied cash
- Create Portfolio View

Phase 2:
- Daily persisted snapshot job
- Hybrid UI toggle (Snapshot vs Live)

Phase 3:
- Full separation of Watchlist vs Portfolio
- Snapshot timeline UI (historical tracking)