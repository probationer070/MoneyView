# MoneyView

Local-first financial analytics platform with:
- FastAPI backend (`apps/api`)
- Next.js frontend (`apps/web`)
- Portfolio attribution and reporting (Phase 5)

## Requirements

- Conda
- Python `>=3.12`
- uv
- Node.js `>=20`
- npm

## Quick Start

From the project root, start both the FastAPI backend and Next.js frontend with the Windows launcher:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -OpenBrowser
```

The launcher starts the backend and frontend in separate PowerShell windows, writes the backend discovery file, and opens the app in your browser.

Open these URLs manually if the browser does not open:

- App: `http://localhost:3000`
- Portfolio: `http://localhost:3000/portfolio`
- API health: `http://127.0.0.1:8000/api/v1/health`
- API docs: `http://127.0.0.1:8000/docs`

To stop the app, close the spawned PowerShell windows.

First-time dependency install:

```powershell
conda create -n moneyview python=3.12 -y
conda activate moneyview
python -m pip install -U uv
uv pip install -e ".[dev]"
cd apps\web
npm install
cd ..\..
```

If frontend dependencies are missing, the launcher can install them:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -InstallDeps -OpenBrowser
```

Check prerequisites without starting processes:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -CheckOnly
```

## 1) Python Environment

MoneyView uses conda for the Python environment and `uv` for Python package installation.

Create and activate the conda environment:

```powershell
conda create -n moneyview python=3.12 -y
conda activate moneyview
```

Install `uv` inside the active conda environment if it is not already available:

```powershell
python -m pip install -U uv
```

Install MoneyView Python dependencies from the project root:

```powershell
uv pip install -e ".[dev]"
```

If you are using `cmd` instead of PowerShell, this also works:

```powershell
uv pip install -e .[dev]
```

Check the active Python interpreter:

```powershell
python --version
where python
```

Create local env file from template:

```powershell
Copy-Item config\.env.example config\.env
```

## 2) Run Backend (FastAPI)

From project root:

```powershell
python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

```powershell
curl http://127.0.0.1:8000/api/v1/health
```

API docs:

- `http://127.0.0.1:8000/docs`

## 3) Run Frontend (Next.js)

In a new terminal:

```powershell
cd apps\web
npm install
npm run dev
```

If PowerShell blocks `npm`, use:

```powershell
npm.cmd run dev
```

Frontend URL:

- `http://localhost:3000`
- Portfolio command center: `http://localhost:3000/portfolio`

## 4) Local Windows Launcher

Check prerequisites and write the backend discovery file without starting processes:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -CheckOnly
```

Start the local runtime in separate PowerShell windows:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1
```

Useful options:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -AutoPort -OpenBrowser
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -InstallDeps
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -BuildWeb -ProductionWeb
```

## 5) Run Tests

From project root:

```powershell
pytest -q
```

Validate the local SQLite schema:

```powershell
python scripts/validate_sqlite_schema.py
```

Use strict mode before hardening or migrating the local DB schema:

```powershell
python scripts/validate_sqlite_schema.py --strict
```

Dry-run local ingestion sources without writing SQLite:

```powershell
python scripts/ingest_dry_run.py
```

Preview local DB reconstruction:

```powershell
python scripts/reconstruct_sqlite_db.py
```

Apply local DB reconstruction with an automatic backup:

```powershell
python scripts/reconstruct_sqlite_db.py --apply
```

Benchmark local SQLite workloads:

```powershell
python scripts/benchmark_sqlite.py
```

Benchmark Python/NumPy finance workloads:

```powershell
python scripts/benchmark_finance.py
```

## 6) Shared Schema Types

Backend Pydantic models are the source of truth for portfolio/report API contracts.

Regenerate the shared schema after changing public Pydantic models:

```powershell
python scripts/export_schema.py
npx json2ts packages/shared-types/generated/portfolio.schema.json > packages/shared-types/generated/portfolio.ts
```

The generated TypeScript entry point is:

- `packages/shared-types/generated/portfolio.ts`

CI or review should fail if generated shared types drift from the backend schema:

```powershell
git diff --exit-code packages/shared-types
```

See `docs/architecture/schema-evolution.md` for compatibility rules.

## 7) Phase 5 Endpoints

### Portfolio Attribution

`POST /api/v1/portfolio/attribution`

Example:

```json
{
  "tickers": ["AAPL", "MSFT", "TSLA"],
  "weights": [0.4, 0.4, 0.2],
  "benchmark": "^GSPC",
  "period": "1y",
  "currency": "USD",
  "attribution_method": "brinson_fachler_arithmetic",
  "allow_synthetic_fallback": true,
  "allow_benchmark_proxy": true
}
```

For production-grade attribution, provide `benchmark_weights` instead of using `allow_benchmark_proxy`, and keep `allow_synthetic_fallback` disabled so missing price data fails fast.

### Report Summary (canonical payload)

`POST /api/v1/report/summary`

### Report Export (backend static rendering)

`POST /api/v1/report/export`

Example:

```json
{
  "request": {
    "tickers": ["AAPL", "MSFT", "TSLA"],
    "weights": [0.4, 0.4, 0.2],
    "filters": {
      "period": "1y",
      "benchmark": "^GSPC",
      "currency": "USD",
      "date_to": "2025-12-31"
    },
    "attribution_method": "brinson_fachler_arithmetic",
    "allow_synthetic_fallback": true,
    "allow_benchmark_proxy": true,
    "version": "phase5-v1"
  },
  "format": "html"
}
```

Supported export formats:
- `html`
- `pdf` (print-safe HTML payload)
- `markdown`
- `csv`
- `json`

## Notes

- Default DB path: `data/processed/moneyview.db`
- Watchlist can seed from `apps/api/services/webscrap/stock_targets.json` when DB watchlist is empty.
