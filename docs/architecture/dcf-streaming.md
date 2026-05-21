# DCF Partial Streaming

The backend DCF transport is now split into three phases so the UI can render valuation results before the full report is assembled and transferred.

## Transport Shape

Phase 1:
- endpoint: `POST /api/v1/corporate/dcf/{ticker}/stream`
- event: `phase1`
- payload: summary only
- fields: `report_id`, `ticker`, `estimated_value`, `intrinsic_value_per_share`, `enterprise_value`, `equity_value`, `valuation_method`, `bridge_quality`, `current_price`, `upside_pct`, `status`, `generated_at`

Phase 2:
- endpoint: `POST /api/v1/corporate/dcf/{ticker}/stream`
- event: `phase2`
- payload: assumption summary only
- fields: `wacc_used`, `margin_used`, `growth_used`, `fcff_used`, `esg_penalty_used`, `terminal_growth_used`, `enterprise_value_index`

Phase 3:
- endpoint: `POST /api/v1/corporate/dcf/{ticker}/report`
- trigger: explicit user action
- payload: full report only
- fields include `projection_rows`, `wacc_breakdown`, terminal-value components, enterprise-to-equity bridge fields, and valuation intermediates

## Ownership

- `apps/api/routes/corporate.py` owns HTTP transport and SSE framing.
- `apps/api/services/corporate_dcf.py` owns phased DCF assembly and report identifiers.
- `apps/web/app/corporate/page.tsx` owns progressive rendering, session caching, and explicit full-report retrieval.
- `packages/shared-types/corporate.ts` mirrors the public DCF payloads for frontend consumers.

## Compatibility

- `POST /api/v1/corporate/dcf/{ticker}` remains available as a compatibility summary path for existing consumers.
- The default live path must not ship `projection_rows`, `wacc_breakdown`, `terminal_value`, or other full-report intermediates.

## Measured Impact

Using the representative AAPL fixture that backs the focused route tests:

- summary compatibility payload: about `343` bytes
- streamed phase payloads combined: about `604` bytes
- explicit full report payload: about `1308` bytes

That keeps the default live path about `53.8%` smaller than shipping the full report by default, while still allowing the UI to render phase 1 before any phase 3 retrieval.
