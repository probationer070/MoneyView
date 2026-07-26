# Local Run: Resource Footprint & Developer Tools

Measured 2026-07-27 on Windows 11, 15.4 GB RAM, 16 logical cores. Numbers are from
direct measurement, not estimates; the method for each is given so they can be
re-checked when the app changes.

---

## 1. What `run MoneyView` costs

| Component | RAM | Notes |
| --- | --- | --- |
| Backend (`uvicorn` + FastAPI app) | **~156 MB** | 3.2 s to import; pandas, numpy and yfinance dominate |
| Frontend (`next dev`, 4 processes) | **~1.3–1.5 GB** | one main process ~1.1 GB plus three workers |
| **Total, steady state** | **~1.5–1.7 GB** | |
| Dev monitor ring buffer, when enabled | **up to +128 MB** | 6.5 KB/event × the 20,000-event limit |

CPU is **bursty, not sustained**: `next dev` spends a few CPU-seconds compiling routes
on demand, then idles. Neither process pins a core during normal use.

**`next dev` is ~85% of the total.** If you are *using* MoneyView rather than developing
the frontend, a production build is dramatically lighter and has no file watching or
on-demand compilation:

```powershell
cd apps\web
npm run build
npm run start
```

### How these were measured

- Backend: `psutil` RSS before and after `import apps.api.main`, then after one real
  request through `TestClient`.
- Ring buffer: RSS delta across 24 instrumented requests divided by buffered event
  count. **This is an upper bound** — it includes request-handling allocations, not
  only events. Spec §03.7 claims ~1.7 KB/event (33 MB full); the measured figure is
  ~4× that, so treat the spec number as optimistic until isolated more precisely.
- Frontend: summed `WorkingSet64` of all `node` processes minus the editor's, after
  starting `next dev` and compiling a route.

---

## 2. Developer tool URLs

Neither page is linked from any navigation. They are reached by typing the path.

| URL | What it shows |
| --- | --- |
| `http://localhost:3000/dev/performance` | Analysis dashboard: request waterfalls, scope breakdown, per-ticker costs, cache effectiveness |
| `http://localhost:3000/dev/monitor` | Older live event tail: operation latency, ticker fetch latency, metric timing, data-quality warnings |

### Both require the dev monitor flag

```
MONEYVIEW_DEV_MONITOR=true
```

must be set **for the API process** before it starts. Without it,
`is_dev_monitor_enabled()` returns false, every `/api/v1/dev/performance/*` endpoint
returns 404, and both pages render an "is disabled" empty state.

`scripts/start_local.ps1` (what `run MoneyView` invokes) **does not set this flag**, and
there is no `.env` file in the repository. So by default the dashboards render as empty
shells. This is working as designed — the flag is off because instrumentation is not
free — but nothing currently tells you the switch exists.

### The flag is not free

Enabling it costs, per the 2026-07-27 baseline:

- **12–19% added request latency** on span-heavy scenarios (191–466 µs per emitted
  event, dominated by event construction and validation rather than persistence)
- **up to 128 MB** of ring buffer

Leave it off for normal use; turn it on when you want to look at the dashboards.

---

## 3. Operational hazards

### A `next dev` that fails to bind does not exit

Observed once: the dev server logged `✓ Ready in 1184ms`, **never listened on its
port**, and grew to **5,081 MB**. Free RAM fell from 7.3 GB to 2.6 GB and returned the
instant the process was killed.

**"Ready" and "listening" are different claims.** After starting the dev server, check
that something is actually bound rather than trusting the log line:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 3000 }
```

The failure was not reproducible — four hypotheses were tested and disproven; see
`ERROR-LOG.md`, entry *"`next dev` reached 5 GB and never bound its port"*. What is
certain is that such a process keeps running, holds gigabytes, and is invisible unless
you look, because its log still says Ready.

### Verify kills actually killed

`taskkill //F //PID <pid>` driven from `ps -W` output has **silently failed** in this
environment — processes believed dead ran to completion. Three benchmark runs once
executed concurrently this way, contending for CPU, network and SQLite, and produced a
plausible but entirely false performance report.

Use PowerShell and assert the count afterwards:

```powershell
Get-Process node,python -ErrorAction SilentlyContinue | Stop-Process -Force
(Get-Process node -ErrorAction SilentlyContinue).Count   # confirm
```

### Long-running benchmarks are the other heavy consumer

`scripts/benchmark_scenarios.py` runs a 138-ticker fan-out with live network calls
across three passes per scenario. A full run takes tens of minutes, holds a backend's
worth of memory, and sustains CPU throughout. Run one at a time, and confirm exactly one
Python process is alive before leaving it. Concurrent runs also earn provider rate
limits, which invalidate every measurement taken during them.

---

## 4. Ports

| Service | Default port | Set by |
| --- | --- | --- |
| FastAPI backend | 8000 | `-ApiPort` in `scripts/start_local.ps1` |
| Next.js frontend | 3000 | `-WebPort` in `scripts/start_local.ps1` |

The frontend resolves the backend through `NEXT_PUBLIC_API_BASE_URL`, defaulting to
`http://127.0.0.1:8000`.

---

## Related

- `ERROR-LOG.md` — the incident records behind §3
- `docs/perf/` — generated baselines; see the "Measurement conditions" header of any
  report for what was frozen or neutralised to produce it
- `docs/architecture/local-first-runtime.md` — the runtime architecture and policy this
  document reports measurements for
