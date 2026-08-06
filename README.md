# MoneyView

<p align="center">
  <img src="./data/img/MoneyView-Page3.png" alt="MoneyView Dashboard" width="100%" />
</p>

<p align="center">
  <strong>Local-first financial analytics workspace</strong><br/>
  Market monitoring, portfolio attribution, corporate valuation, and Monte Carlo simulation in one dashboard.
</p>

---

## Contents

[What it is](#what-it-is) · [Requirements](#requirements) · [First-time setup](#first-time-setup) · [Running](#running) · [Screens](#screens) · [Developer dashboards](#developer-dashboards) · [Watchlist](#watchlist) · [Testing](#testing) · [Shared types](#shared-schema-types) · [API](#key-api-endpoints) · [Layout](#repository-layout)

---

## What it is

A FastAPI backend ([`apps/api`](./apps/api)), a Next.js frontend ([`apps/web`](./apps/web)), and a shared finance engine ([`packages/core_finance`](./packages)), over local SQLite-backed workflows. Everything runs on your machine.

| Area | What it covers | Deep dive |
|---|---|---|
| **Market Overview** | Major indices, commodities, FX, crypto, and trend cards | [`docs/tabs/market-overview-tab.txt`](./docs/tabs/market-overview-tab.txt) |
| **Portfolio** | Portfolio and benchmark return, active return, beta, attribution effects, holdings detail | [`docs/tabs/portfolio-tab.txt`](./docs/tabs/portfolio-tab.txt) |
| **Corporate Analysis** | DCF valuation assumptions, hurdle-rate decomposition, WACC × terminal-growth sensitivity, value-driver views | [`docs/tabs/corporate-analysis-tab.txt`](./docs/tabs/corporate-analysis-tab.txt) |
| **Simulation Lab** | Path simulation, risk analysis, return distribution, corporate valuation, correlation model | [`docs/tabs/monte-carlo-tab.txt`](./docs/tabs/monte-carlo-tab.txt) |

Start at [`docs/INDEX.md`](./docs/INDEX.md) for a map of every document in the repo.

## Stack

| Layer | Tools |
|---|---|
| Frontend | Next.js, React, TypeScript, Recharts |
| Backend | FastAPI, Pydantic |
| Data | SQLite, local cache, Yahoo/yfinance-based ingestion paths |
| Python tooling | Conda, `uv`, `pytest` |
| Frontend tooling | Node.js, `npm`, Playwright |

## Requirements

Conda · Python `>=3.12` · Node.js `>=20` · `uv` · `npm`

## First-time setup

Do this once, before the first run.

```powershell
conda create -n moneyview python=3.13 -y
conda activate moneyview
python -m pip install -U uv
uv pip install -e ".[dev]"
cd apps\web; npm install; cd ..\..
Copy-Item config\.env.example config\.env
```

Then install the global `run` command, so you can start MoneyView from any folder:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\install_run_command.ps1
```

> If you skip the dependency steps, the launcher installs what is missing on first run —
> or force it with `run MoneyView -InstallDeps`. Backend packages install into the selected
> runtime env; if your active env is `base` and a `moneyview` env exists, `moneyview` wins.

## Running

```cmd
run MoneyView
```

That is the whole thing. It starts the backend and frontend, opens a PowerShell window for
each, and opens your browser.

**Didn't install the global command?** Run the same thing from the repo root — `.\run.cmd MoneyView`
in PowerShell, or `run MoneyView` in `cmd.exe`. Both forward to the canonical launcher,
[`scripts/start_local.ps1`](./scripts/start_local.ps1), which you can also call directly:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -OpenBrowser
```

### Where things are

| | |
|---|---|
| App | http://localhost:3000 |
| Portfolio · Corporate · Monte Carlo | `/portfolio` · `/corporate` · `/monte-carlo` |
| API health | http://127.0.0.1:8000/api/v1/health |
| API docs | http://127.0.0.1:8000/docs |
| Logs | `data/cache/logs/api-server.log`, `data/cache/logs/next-server.log` |

**To stop:** close the two spawned PowerShell windows.

### Launcher options

| Flag | Effect |
|---|---|
| `-CheckOnly` | Validate prerequisites and ports, start nothing |
| `-AutoPort` | Scan for free ports when 8000/3000 are taken |
| `-InstallDeps` | Install missing backend/frontend dependencies first |
| `-DevMonitor` | Enable server-side performance instrumentation (see below) |
| `-BuildWeb -ProductionWeb` | Production build instead of `next dev` — much lighter |

### Running the halves separately

```powershell
python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000 --reload
```

```powershell
cd apps\web; npm run dev
```

> If PowerShell blocks `npm`, use `npm.cmd run dev`.

### Resource cost

`run MoneyView` uses roughly **1.5–1.7 GB of RAM** — about 85% of that is `next dev`, with the
FastAPI backend at ~156 MB. CPU is bursty during route compilation, then idle. If you are
*using* MoneyView rather than developing the frontend, `-BuildWeb -ProductionWeb` is
substantially lighter.

[`docs/local-run-resources.md`](./docs/local-run-resources.md) has the measured figures, the
measurement method, and the operational hazards — notably that a `next dev` which logs "Ready"
but never binds its port does not exit, and has reached 5 GB.

## Screens

<details>
<summary><strong>Market Overview</strong> — cards for indices, commodities, FX, and crypto</summary>
<p align="center"><img src="./data/img/MoneyView-Page4.png" alt="Market Overview" width="100%" /></p>
</details>

<details>
<summary><strong>Portfolio Command Center</strong> — holdings, weighted testing, snapshots, attribution, drill-down</summary>
<table>
  <tr>
    <td width="33%"><img src="./data/img/MoneyView-Page21.png" alt="Portfolio view 1" width="100%" /></td>
    <td width="33%"><img src="./data/img/MoneyView-Page22.png" alt="Portfolio view 2" width="100%" /></td>
    <td width="33%"><img src="./data/img/MoneyView-Page23.png" alt="Portfolio view 3" width="100%" /></td>
  </tr>
</table>
</details>

<details>
<summary><strong>Corporate Analysis</strong> — assumptions, hurdle-rate decomposition, valuation visuals</summary>
<p align="center"><img src="./data/img/MoneyView-Page1.png" alt="Corporate Analysis" width="100%" /></p>
</details>

<details>
<summary><strong>Simulation Lab</strong> — path simulation, risk, valuation uncertainty, correlation structure</summary>
<table>
  <tr>
    <td width="50%"><img src="./data/img/MoneyView-Page5.png" alt="Simulation Lab view 1" width="100%" /></td>
    <td width="50%"><img src="./data/img/MoneyView-Page51.png" alt="Simulation Lab view 2" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="./data/img/MoneyView-Page52.png" alt="Simulation Lab view 3" width="100%" /></td>
    <td width="50%"><img src="./data/img/MoneyView-Page53.png" alt="Simulation Lab view 4" width="100%" /></td>
  </tr>
  <tr>
    <td colspan="2"><img src="./data/img/MoneyView-Page54.png" alt="Simulation Lab view 5" width="100%" /></td>
  </tr>
</table>
</details>

## Developer dashboards

Two dashboards exist and are **not linked from any navigation**:

| URL | What |
|---|---|
| `http://localhost:3000/dev/performance` | Request waterfalls, scope breakdown, per-ticker cost, cache effectiveness |
| `http://localhost:3000/dev/monitor` | Live event tail and latency panels |

Both need server-side instrumentation, which is **off by default** — it costs 12–19% request
latency and up to 128 MB. Turn it on for a run:

```cmd
run MoneyView -DevMonitor
```

The startup banner then prints the dashboard URLs. Without the switch it says the dashboards
are disabled and names the flag, rather than leaving you at a blank page.

## Watchlist

Portfolio holdings live in the local SQLite `watchlist` table, and **that table is the source
of truth**. On first run:

- rows already in the DB are used as-is
- if empty and `apps/api/services/webscrap/stock_targets.json` exists, MoneyView seeds from it once
- if empty and that file is missing, MoneyView seeds a small built-in default once

Once you add or delete holdings from the Portfolio page, those changes are authoritative —
bootstrap seeding will not overwrite them.

The Portfolio page uses saved positive weights when they exist, and falls back to an
equal-weight basket when none do. If saved weights total under `100%`, the remainder is
treated as implied cash in the attribution flow.

## Testing

| Command | What it does |
|---|---|
| `pytest -q` | Python test suite |
| `cd apps\web; npm run test:e2e` | Playwright end-to-end suite (uses ports 3101/8110, not 3000/8000) |
| `cd apps\web; npx tsc --noEmit` | Frontend typecheck |
| `python scripts/validate_sqlite_schema.py` | Validate the local SQLite schema (add `--strict` to tighten) |
| `python scripts/ingest_dry_run.py` | Dry-run the ingestion sources |
| `python scripts/reconstruct_sqlite_db.py` | Preview a local DB reconstruction (add `--apply` to perform it, with backup) |
| `python scripts/benchmark_sqlite.py` | Benchmark SQLite workloads |
| `python scripts/benchmark_finance.py` | Benchmark finance workloads |

> The Playwright config sets `reuseExistingServer: false`, so two suite runs at once will kill
> each other's servers. Check 3101 and 8110 are free before starting one.

## Shared schema types

Backend Pydantic models are the source of truth for the public portfolio/report contracts.
Regenerate after changing a public model:

```powershell
python scripts/export_schema.py
npx json2ts packages/shared-types/generated/portfolio.schema.json > packages/shared-types/generated/portfolio.ts
```

Output lands in [`packages/shared-types/generated/portfolio.ts`](./packages/shared-types/generated/portfolio.ts).
Check for drift with `git diff --exit-code packages/shared-types`.

See [`docs/architecture/schema-evolution.md`](./docs/architecture/schema-evolution.md).

## Key API endpoints

Full reference: [`docs/api-usage.md`](./docs/api-usage.md). Interactive docs at `/docs` while running.

| Method | Path |
|---|---|
| `POST` | `/api/v1/portfolio/attribution` |
| `POST` | `/api/v1/report/summary` |
| `GET` `POST` | `/api/v1/portfolio/watchlist` |
| `DELETE` | `/api/v1/portfolio/watchlist/{ticker}` |

<details>
<summary>Example request bodies</summary>

`POST /api/v1/portfolio/attribution`

```json
{
  "tickers": ["AAPL", "MSFT", "TSLA"],
  "weights": [0.3333, 0.3333, 0.3333],
  "benchmark": "^GSPC",
  "period": "5y",
  "currency": "USD",
  "attribution_method": "brinson_fachler_arithmetic",
  "allow_synthetic_fallback": true,
  "allow_benchmark_proxy": true
}
```

`POST /api/v1/portfolio/watchlist`

```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Information Technology",
  "group_name": "core",
  "weight": 0.0
}
```

</details>

## Repository layout

```text
MoneyView/
├─ apps/
│  ├─ api/          FastAPI backend
│  └─ web/          Next.js frontend
├─ packages/        Shared finance engine and generated types
├─ config/          Local env files
├─ data/            SQLite cache, logs, images, raw and processed data
├─ docs/            Architecture, design, and per-tab documentation
├─ guideline/       SOPs and process specifications
├─ scripts/         Launcher, benchmarks, schema and ingestion tools
└─ tests/           Python test suite
```

## Notes

- Designed for local development and experimentation first.
- Screenshots load from [`data/img`](./data/img).
- PowerShell execution-policy warnings appearing *after* a command completes are usually
  non-blocking, unless the command itself failed.
