# API Usage

MoneyView exposes a local FastAPI backend. The main interactive portfolio flows use the watchlist and attribution endpoints under `/api/v1/portfolio`.

Base URLs:

- app docs: `http://127.0.0.1:8000/docs`
- API root example: `http://127.0.0.1:8000/api/v1`

## Watchlist Model

The watchlist is persisted in the local SQLite `watchlist` table.

Each row includes:

- `ticker`
- `name`
- `sector`
- `group_name`
- `weight`

`weight` is a decimal portfolio weight between `0.0` and `1.0`. Example: `0.35` means `35%`.

Current behavior:

- the Portfolio page uses saved positive watchlist weights when present
- if no positive saved weights exist, the Portfolio page falls back to an equal-weight basket
- if saved positive weights sum to less than `1.0`, the remainder is treated as cash in the Portfolio attribution flow
- direct API clients can still call the attribution endpoint with explicit `weights`

## Get Watchlist

`GET /api/v1/portfolio/watchlist`

Purpose:

- returns DB-backed holdings for the Portfolio page
- includes latest close, delta badge, and sparkline values
- bootstraps the watchlist once if the DB is empty

Example:

```powershell
curl http://127.0.0.1:8000/api/v1/portfolio/watchlist
```

Example response:

```json
[
  {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "sector": "Information Technology",
    "group_name": "core",
    "weight": 0.35,
    "last_close": 214.1,
    "delta": {
      "label": "+1.3%",
      "value": 0.013,
      "direction": "up"
    },
    "sparkline": [208.4, 209.9, 211.5, 214.1]
  }
]
```

Notes:

- if the local `watchlist` table already has rows, those rows are returned
- if the table is empty and `apps/api/services/webscrap/stock_targets.json` exists, the backend seeds from that file once
- if the table is empty and the JSON file is missing, the backend seeds a small built-in default list once
- after the user adds, edits, or deletes holdings, the DB state becomes authoritative and bootstrap seeding does not overwrite it
- the Portfolio page uses the returned `weight` values when any positive saved weights exist
- otherwise it falls back to an equal-weight portfolio for attribution and export

## Add Or Update Watchlist Item

`POST /api/v1/portfolio/watchlist`

Purpose:

- adds a new holding
- updates an existing holding when the ticker already exists
- stores watchlist metadata in SQLite

Example:

```powershell
curl -X POST http://127.0.0.1:8000/api/v1/portfolio/watchlist ^
  -H "Content-Type: application/json" ^
  -d "{\"ticker\":\"MSFT\",\"name\":\"Microsoft Corp.\",\"sector\":\"Information Technology\",\"group_name\":\"core\",\"weight\":0.0}"
```

Request body:

```json
{
  "ticker": "MSFT",
  "name": "Microsoft Corp.",
  "sector": "Information Technology",
  "group_name": "core",
  "weight": 0.0
}
```

Response body:

```json
{
  "ticker": "MSFT",
  "name": "Microsoft Corp.",
  "sector": "Information Technology",
  "group_name": "core",
  "weight": 0.0
}
```

Rules:

- ticker is normalized to uppercase
- `weight` must be between `0.0` and `1.0`
- this endpoint writes directly to SQLite
- the current Portfolio page uses the stored `weight` field for portfolio sizing when any positive saved weights exist
- zero-weight names remain tracked in the watchlist without affecting the weighted portfolio

## Delete Watchlist Item

`DELETE /api/v1/portfolio/watchlist/{ticker}`

Purpose:

- removes a holding from the local watchlist table
- preserves the empty state instead of silently reseeding defaults later

Example:

```powershell
curl -X DELETE http://127.0.0.1:8000/api/v1/portfolio/watchlist/MSFT
```

Success response:

```json
{
  "status": "ok",
  "ticker": "MSFT"
}
```

If the ticker does not exist, the endpoint returns `404`.

## Portfolio Attribution

`POST /api/v1/portfolio/attribution`

Purpose:

- calculates portfolio return, benchmark return, active return, beta, and sector attribution
- uses arithmetic Brinson-Fachler attribution
- accepts any explicit portfolio payload with caller-supplied weights

Example with explicit weights:

```powershell
curl -X POST http://127.0.0.1:8000/api/v1/portfolio/attribution ^
  -H "Content-Type: application/json" ^
  -d "{\"tickers\":[\"AAPL\",\"MSFT\",\"XOM\"],\"weights\":[0.333333,0.333333,0.333334],\"benchmark\":\"^GSPC\",\"period\":\"5y\",\"currency\":\"USD\",\"allow_synthetic_fallback\":true,\"allow_benchmark_proxy\":true,\"attribution_method\":\"brinson_fachler_arithmetic\"}"
```

Request body:

```json
{
  "tickers": ["AAPL", "MSFT", "XOM"],
  "weights": [0.333333, 0.333333, 0.333334],
  "benchmark": "^GSPC",
  "period": "5y",
  "currency": "USD",
  "allow_synthetic_fallback": true,
  "allow_benchmark_proxy": true,
  "attribution_method": "brinson_fachler_arithmetic"
}
```

Response shape:

```json
{
  "data": {
    "active_return": 0.021,
    "totals": {
      "portfolio_return": 0.143,
      "benchmark_return": 0.122
    },
    "risk_metrics": {
      "beta": 1.04
    },
    "sector_breakdowns": [],
    "metadata": {
      "benchmark": "^GSPC",
      "benchmark_weights_source": "provider_derived"
    }
  },
  "meta": {
    "request_id": "..."
  }
}
```

Rules:

- `tickers` and `weights` lengths must match
- ticker duplicates are normalized and merged by the schema layer
- only `USD`, daily returns, and beginning-of-period weights are currently implemented
- if `allow_cash=true`, total weight may be below `1.0` and the remainder is treated as cash
- if `allow_cash=false`, weights must sum to `1.0`
- if `allow_short=false`, negative weights are rejected
- explicit `benchmark_weights`, when provided, must sum to `1.0`

## Common Workflow

1. Call `GET /api/v1/portfolio/watchlist` to load or bootstrap holdings.
2. Call `POST /api/v1/portfolio/watchlist` to add a holding or update its saved metadata.
3. Call `DELETE /api/v1/portfolio/watchlist/{ticker}` when the user removes a holding.
4. Build the attribution request from saved watchlist weights when they exist, or fall back to equal weights when they do not, and call `POST /api/v1/portfolio/attribution`.

## Related Docs

- [`README.md`](../README.md)
- [`docs/corporate-analysis-tab.md`](./corporate-analysis-tab.md)
- [`docs/monte-carlo-tab.md`](./monte-carlo-tab.md)
- [`docs/portfolio-tab.md`](./portfolio-tab.md)
- [`docs/architecture/app-blueprint.md`](./architecture/app-blueprint.md)
- [`docs/architecture/data-flow.md`](./architecture/data-flow.md)
