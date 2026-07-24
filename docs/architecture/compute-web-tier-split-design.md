# Compute / Web Tier Split — Design Spec

**Date:** 2026-07-24 (rev. 3 — review v2 incorporated; §E resolved)
**Status:** Design — **approved, ready for implementation plan.**
**Author:** probationer070
**Scope:** Phase 1 only (local, two processes). Cloud/VPC/Tailscale + Wazuh placement are Phase 2, out of scope here.

## Motivation (§E resolved: portfolio / architecture demonstration)

**There is no immediate product requirement for this split.** MoneyView is and remains a
**local-first** application (verified: `main.py:152` whitelists `tauri://localhost`;
`docs/architecture/local-first-runtime.md` treats Docker/cloud as *"future upgrades only after
measured need"*), and `local-first-runtime.md` stays a **preserved, non-superseded reference**.

The compute/web boundary is introduced **deliberately, to demonstrate distributed-boundary design
capability** — drawing a clean network seam at the right granularity, measuring its cost honestly
with the app's existing observability, and reasoning about the real hazards (serialization fidelity,
interface granularity, single-writer storage, streaming cancellation). Framing it this way is what
makes the added complexity defensible: it is a portfolio/architecture exercise with measured
results, not a product feature justified by demand that doesn't exist. Every "public web tier"
reference below is therefore **the demonstrated target topology**, not a claim that MoneyView ships
as a hosted service today.

## Context and goal

MoneyView today runs as a single `uvicorn` process containing two logical tiers:

- **Web-facing tier** — `apps/web` (Next.js) → `apps/api/routes/*` + middleware
  (`StructuralMiddleware`, `TransportProgressMiddleware`, `dev_monitor`). The browser reaches it
  through one configurable base URL (`NEXT_PUBLIC_API_BASE_URL`, `apps/web/lib/api.ts`).
- **Compute tier** — `apps/api/services/*` → `packages/core_finance` (DCF, beta, risk, expected
  return, hurdle rate, corporate metrics) + ingestion (`services/webscrap`, `market_data`) +
  SQLite (`services/db`). Routes call services **in-process**.

The design introduces a clean **network boundary** at the **routes ↔ services** seam so the compute
tier can physically move to a different machine/network from the web tier. The *motivation* for
doing so is a portfolio/architecture demonstration, not a product requirement (§E, resolved); the
technical design is independent of that framing.

**Key finding from code review (2026-07-24):** the observability the user wanted ("monitor traffic,
find bottlenecks") is already substantially built — `StructuralMiddleware` does request-ID
correlation, per-endpoint latency, and slow-detection (>1s); `TransportProgressMiddleware` does
byte-level payload/transport measurement; `dev_monitor` exposes `/performance/{recent,slow,errors,
summary}` + SSE + client-side event ingestion. It does **not** measure a web→compute network hop,
because that hop does not exist yet. Phase 1's real work is therefore the **tier split**, and the
existing monitoring is the instrument that proves its cost.

## Non-goals (Phase 1)

- No AWS, VPC, subnets, or **Tailscale** yet. (Phase-2 note: a NAT Gateway is *outbound-only*; it
  cannot restrict inbound to "just me". The compute tier needs outbound internet for
  yfinance/webscrap ingestion, so the precise Phase-2 statement is **"no inbound path; outbound
  egresses via NAT"**, and inbound access is over a Tailscale private address, not a public route.)
- No Wazuh / monitoring-server placement decision.
- No job-queue / async-worker model for Monte Carlo (deferred; see "Deferred").
- No change to the Next.js web tier beyond it continuing to call one API base URL.
- No rewrite of `packages/core_finance` math.

## Chosen approach

Split the single process into two FastAPI apps at the routes↔services seam, run locally as two
processes for Phase 1:

1. **compute-service** (new, private tier) — owns `services/*` + `core_finance` + SQLite +
   ingestion. Exposes **coarse-grained** compute operations over internal HTTP. Binds to
   **loopback only** (`127.0.0.1`) in Phase 1 — a security property (see §E-security), not a
   placeholder for "a private endpoint".
2. **BFF/gateway** (`apps/api` refactored, public-*facing* tier) — keeps `routes/*` + middleware +
   dev-monitor + the browser contract, but routes call compute-service through one `ComputeClient`
   instead of importing services. Serves the browser as today.
3. **web** (`apps/web`) — unchanged; calls one API base URL (the BFF).

### Migration mechanism (revived Option 2 — not an end state)

`ComputeClient` is an interface with **two implementations behind a config switch**:
`InProcessComputeClient` (calls services directly, == today's behavior) and `HttpComputeClient`
(the real network split). Rationale: this is **insufficient as an end state** (it doesn't prove the
network architecture on its own), but it is adopted as (a) a **gradual migration path** away from a
big-bang cutover and (b) a **baseline-control harness for free** — the same `pytest` suite runs in
both modes, so any behavioral divergence introduced by the network hop is caught by diffing in-proc
vs http results.

Rejected as end states (recorded for the interview narrative):
- **Job-queue/worker split** (Redis/Celery, web polls/SSE) — correct for genuinely long jobs but a
  much larger change; overkill for the many fast endpoints. Kept as a Phase-2+ option *only if*
  Phase 1 measurements show the synchronous hop is too slow for Monte Carlo / bulk DCF.
- **Swappable client with no real split** — this is exactly `InProcessComputeClient`, retained
  above as the migration control, not as the destination.

## Blocking design requirements (from review v2, §A) — must be satisfied by the plan

### A-1. Coarse-grained interface — 1 route = 1 compute call (highest priority)
A 1:1 mirror of fine-grained service functions produces a distributed monolith: any route that
calls services in a loop becomes N HTTP round trips. Loopback hides this (1 ms × N); Tailscale
exposes it (20 ms × 50 ≈ **1 s**).

**Confirmed offender:** `GET /portfolio/watchlist` (`apps/api/routes/portfolio.py:55-61`) loops
`for row in rows:` calling `_mkt.get_stock_ohlcv(ticker, …)` per holding → one compute call *per
row* if mirrored naively. Bulk DCF (`corporate.py:325`) is already coarse at the route
(`build_bulk_dcf_reports(request.tickers, …)`) but fans out to per-ticker loaders *inside* the
service — acceptable **only because the fan-out stays server-side**.

**Requirement:** the plan must begin with a **route audit** listing every handler that calls
services ≥2 times or within a loop, and define compute-service operations so that **each browser
request maps to exactly one compute call**, with all per-item fan-out living inside compute-service.
The BFF must never be the thing looping over compute calls. Fixing this in Phase 2 means rewriting
route handlers twice — it is cheaper to draw the boundary coarse now.

### A-2. Telemetry buckets = serialization / wire / compute (not "network hop")
`network = RTT − internal_compute` is wrong: on loopback wire-time ≈ 0, so that residual is almost
entirely **JSON serialization on both ends**, which persists on Tailscale with real RTT added on
top. Labeling it "network" makes Phase-2 predictions miss.

**Requirement:** three buckets — **serialization** (encode+decode, measured directly, alongside
payload bytes), **wire** (modeled from measured payload size + an assumed RTT, **not** taken from
loopback), and **compute** (time inside compute-service before it begins responding). Record
**"loopback measured / Tailscale estimated" side by side** so the numbers are honest about what was
observed vs projected.

### A-3. Serialization fidelity — guard the silent-corruption classes
The hazard is silent success, not failure. **Current-code reality (verified 2026-07-24):**
- **Decimal:** NOT used anywhere (`rg "from decimal|Decimal\("` → empty; only a docstring mentions
  the word). The "Decimal → float/str" corruption is therefore *not present today*; the guard is to
  **keep it absent** — a contract test asserts no Decimal crosses the boundary, so a future
  introduction can't silently degrade precision.
- **NaN / Inf:** the live risk. NumPy computations (risk, DCF) produce `nan`/`inf` on missing data
  or division-by-zero. Python's stdlib `json` emits non-standard `NaN`/`Infinity` literals; a
  stricter decoder (or `allow_nan=False`, or `orjson`) turns them to `null` or errors. **Different
  encoders across the two hops would silently alter these values.**
- **datetime naive/aware** flattening across the round trip.

**Verified invariant to lock:** the repo uses **stdlib `json` only** (no `orjson` anywhere). The
plan must **pin a single serializer across both processes** and add explicit round-trip contract
tests for **NaN, Inf, and naive/aware datetime** (and the Decimal-absence assertion above).

**Decision (2026-07-24, implementation):** the fidelity test caught a concrete failure — pydantic
2.12.5 `model_dump_json()` coerces `NaN`/`±Inf` to JSON `null`, and `model_validate_json()` then
**rejects `null` for a float field** with a `ValidationError`, so raw pydantic is *not* round-trip
stable for non-finite floats. Resolution (option A, portfolio owner): the single pinned serializer
(`apps/api/compute/serialization.py::dumps_model`/`loads_model`, used identically on both ends)
maps non-finite floats to a shared JSON sentinel `{"__nonfinite__": "nan"|"inf"|"-inf"}`. This is
**one shared serialization policy, not a per-endpoint encoder** — it is the *only* serializer on
either side of the hop, which is exactly what §A-3 asks for. compute-service therefore
hand-serializes its response with `dumps_model` rather than using FastAPI's default serializer.

### A-4. Retry policy — idempotent AND cheap
"Retry idempotent reads" is insufficient: DCF/Monte Carlo are idempotent but expensive; retrying a
30 s Monte Carlo on timeout doubles load and times out again.

**Requirement:** the retry criterion is **idempotent AND cheap**. Each compute operation declares
its retryability in the contract. Expensive operations return an **error envelope on timeout without
retrying**; only cheap idempotent reads are retried (bounded, with backoff).

## Components and boundaries

### compute-service (private tier)
- **Responsibility:** all heavy computation and data ownership; owns the SQLite DB and all
  ingestion. **Owns SQLite specifically** — because it uses a **single SQLite writer (WAL:
  concurrent readers, one writer)**, compute-service **cannot be horizontally scaled / replicated in
  Phase 1**. This is a load-bearing constraint, stated, not abstracted away.
- **Statefulness (honest form):** compute-service holds **no application-level session state**, but
  it **owns local SQLite files and ingestion cache/file state**, so replication is impossible in
  Phase 1 and horizontal scaling would require replacing the storage backend first. It is *not*
  "stateless".
- **Interface:** coarse compute operations (per §A-1), grouped from the service modules that move in:
  `corporate_comparison`, `corporate_dcf`, `corporate_metrics_service`,
  `corporate_statement_metrics`, `db`, `market_data`, `news_service`, `portfolio_service`,
  `watchlist_seed`.
- **Contract:** **domain models only** — never the web envelope. `APIResponse`/`APIMeta` stay in the
  BFF (verified: services do not use them today). Symmetry: the BFF owns no finance math; the
  compute tier owns no web envelope.
- **Binding:** `127.0.0.1:<compute-port>` in Phase 1.

### BFF/gateway (public-facing tier — `apps/api`)
- **Responsibility:** browser-facing HTTP surface, auth/rate-limit/transport concerns, orchestration,
  and **wrapping domain models in `APIResponse`/`APIMeta`**. Holds no finance math.
- **Invariant: the BFF never accesses the DB.** **Currently violated** — `portfolio.py` routes call
  `get_db()` and `ensure_watchlist_bootstrapped()` directly at the route layer. The plan must move
  every such DB touch into compute-service; any residual `get_db()` in a route means the split is
  broken.
- **External interface (unchanged):** routers `market, portfolio, detail, news, corporate,
  diagnostic, dev_monitor, report, monte_carlo, stock` stay identical to the browser.
- **Internal change:** each route calls `ComputeClient.<operation>(...)`, returning the same domain
  model, then wraps it in the envelope.

### ComputeClient (the seam)
- One typed client that **localizes the transport choice to a single place** (timeouts, retries,
  error mapping, base URL). *Not* a claim that the boundary is transport-independent — SSE
  pass-through and serialization fidelity are HTTP-shaped; a later move to gRPC/queue would change
  the streaming design. Localizing the choice is the true, useful statement.
- **Settings (explicit):** `COMPUTE_SERVICE_BASE_URL`, `COMPUTE_CONNECT_TIMEOUT`,
  `COMPUTE_TIMEOUT` (unary), and a **separate long `COMPUTE_STREAM_READ_TIMEOUT`** for SSE — a
  default unary timeout would kill long-running streams.

### Streaming endpoints (first-class, not discovered)
`corporate/dcf/{ticker}/stream` (see `docs/architecture/dcf-streaming.md`) and the `dev_monitor` SSE
stream are `text/event-stream`. The BFF **proxies** the stream from compute-service without
whole-response buffering. Requirements: **backpressure preserved**; **client disconnect cancels the
upstream compute stream immediately** (no zombie jobs) — a test must assert `httpx.stream()` closes
the upstream on `CancelledError`; **`X-Request-ID` consistent** across the proxy.
`TransportProgressMiddleware` already distinguishes `sse`, so its measurements survive the proxy.

## Data flow (Phase 1, local)

```
Browser ──HTTP──► BFF/gateway (apps/api, public-facing, :8000)
                     │  routes/* + middleware (request-id, rate-limit, transport, dev-monitor)
                     │  wraps domain models -> APIResponse
                     └─ ComputeClient ──HTTP (loopback)──► compute-service (private, :<cport>)
                                                             services/* + core_finance + SQLite + ingestion
```

The same `X-Request-ID` propagates across both hops so one browser action correlates end to end.
**dev_monitor aggregation direction: the BFF PULLS** from compute-service (or compute-service is
scraped by the BFF). It must **not** push private→public, which would invert the trust boundary in
Phase 2.

## Error handling

- `ComputeClient` maps compute-service failures to the existing API error envelope, tagged with the
  correlating `request_id`, and emits a `dev_monitor` error event. **Failures are classified**, not
  flattened to one shape: **retryable** (cheap idempotent read, transient) vs **non-retryable**
  (expensive op timeout per §A-4; client/validation error) vs the **silent-corruption classes** of
  §A-3 (caught by contract tests, not runtime).
- Rate limiting stays in the **BFF** (public-edge concern); compute-service trusts the BFF in
  Phase 1 (loopback only).

## Instrumentation — "find where bottlenecks occur"

Extend existing observability: propagate `X-Request-ID` into every `ComputeClient` call and echo it
from compute-service; attribute time to the **serialization / wire / compute** buckets of §A-2 in
`PerformanceEvent`/`PerformanceSummary` (`apps/api/models/schema_parts/dev_monitor.py`, surfaced by
`/performance/summary`); keep `TransportProgressMiddleware` on both processes so payload bytes are
measured per hop.

## Baseline / verification harness & success criteria

- Run `scripts/benchmark_finance.py` (+ `benchmark_sqlite.py`) in **both** `InProcessComputeClient`
  and `HttpComputeClient` modes across: one fast read (`portfolio/watchlist`), `portfolio/attribution`,
  `corporate/dcf/*`, `monte-carlo/analyze`.
- **Correctness:** `pytest -q` passes in both modes; browser-facing endpoints are **semantically
  equivalent excluding known variable fields** (timestamps, `request_id`, `duration_ms`) between
  modes — **not** byte-identical (those fields are dynamic by definition).
- **Observability:** `/performance/summary` reports the three-bucket attribution; one browser action
  traces across both processes by one `X-Request-ID`.
- **Quantified go/no-go (numeric, not just "quantify"):** **P95 added latency for fast-read
  endpoints from the http-mode hop < 15 ms on loopback**; if exceeded, the interface granularity
  (§A-1) is wrong and must be re-coarsened before proceeding. Record per-endpoint added latency and
  payload bytes so the Phase-2 (and Monte-Carlo job-queue) decision is data-driven.

## Environment caveat (WSL2)

"Loopback ⇒ not externally reachable" assumes standard NAT networking. Under **WSL2
`networkingMode=mirrored`**, `localhost` inside WSL is shared with the Windows host, which can
weaken that assumption. The plan must **verify the actual WSL networking mode** before relying on
loopback as a security boundary in any WSL-hosted run.

## Testing strategy

- **Unit:** `ComputeClient` request/response + error mapping (mock compute-service); both client
  impls.
- **Contract:** each moved operation deserializes to the same domain model in-proc vs http; plus the
  **§A-3 fidelity tests** — NaN, Inf, naive/aware datetime round-trips, and Decimal-absence assertion.
- **Integration (two-process):** boot both; run `pytest -q` against the BFF; assert semantic
  equivalence (excluding variable fields) vs the in-proc baseline for a golden request set.
- **Streaming:** `dcf/{ticker}/stream` proxies SSE end to end without whole-response buffering, and
  **client disconnect cancels the upstream** (`CancelledError` closes `httpx.stream()`).
- **Observability:** one request → correlated events in both processes + a three-bucket summary.
- **Retry:** cheap idempotent read retries on transient failure; expensive op returns error envelope
  on timeout **without** retry.

## Deferred (explicit)

- Monte Carlo / bulk DCF **job-queue model** — decided from the benchmark harness, not now.
- **Transport evaluation** (gRPC / message queue vs HTTP) — recorded as a future evaluation only;
  Phase 1 commits to HTTP because SSE pass-through and serialization fidelity are HTTP-shaped.
- Cloud topology (VPC, subnets, Tailscale subnet router, security groups) — Phase 2.
- Wazuh / SOC monitoring placement — separate project.

## §E. RESOLVED — motivation is portfolio/architecture demonstration

**Decision (2026-07-24):** option 3. The contradiction between the "public web" premise and the
repo's documented local-first direction is resolved by naming the motivation honestly: this is a
**portfolio/architecture demonstration**, not a product pivot. See the **Motivation** section at the
top. `local-first-runtime.md` is a **preserved reference** (not superseded); MoneyView stays
local-first, and the "public web tier" is the demonstrated target topology. The technical design is
unchanged by this decision.

## References (existing repo docs)

- `docs/architecture/api-transport-observability.md` — transport middleware being extended.
- `docs/architecture/dev-monitor-backend-foundation.md` — dev-monitor sink/summary being extended.
- `docs/architecture/cqrs-read-write-separation.md` — existing read/write separation to stay
  consistent with when moving services.
- `docs/architecture/dcf-streaming.md` — the streaming endpoint the BFF must proxy.
- `docs/architecture/local-first-runtime.md` — **preserved reference** (§E resolved; not superseded).
- `docs/architecture/data-flow.md`, `storage-model.md` — current tier/storage assumptions to preserve.
