# Compute / Web Tier Split — Implementation Plan (Slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the compute/web boundary end-to-end on ONE coarse endpoint (`POST /api/v1/portfolio/attribution`) by introducing a `ComputeClient` seam with two interchangeable implementations (in-process and HTTP), a pinned serializer with fidelity guards, and three-bucket telemetry — before fanning the pattern out to every route.

**Architecture:** Split the routes↔services seam behind a typed `ComputeClient`. `InProcessComputeClient` calls `PortfolioAnalyticsService` directly (== today's behaviour); `HttpComputeClient` calls a new `compute-service` FastAPI app over HTTP. A config switch (`MONEYVIEW_COMPUTE_CLIENT_MODE`) selects which. The same pydantic serializer is used on both ends so the network hop cannot silently alter values. The BFF `/attribution` route stops importing the service and calls the client instead.

**Tech Stack:** Python 3.12, FastAPI, pydantic v2, httpx (`ASGITransport` for in-memory two-app tests), pytest, numpy. Config via `os.getenv` (matching the repo's existing `MONEYVIEW_*` convention — **no** `pydantic-settings`/`BaseSettings`).

## Global Constraints

- **Serializer invariant:** exactly ONE serializer crosses the boundary — `dumps_model()` / `loads_model()` in `apps/api/compute/serialization.py`, used identically on BOTH ends (BFF encodes the request / decodes the response; compute-service decodes the request / encodes the response). It is **one shared serialization policy, not a per-endpoint encoder**. It builds on pydantic (`model_dump(mode="python")` / `model_validate`) plus stdlib `json`, and maps non-finite floats (`NaN`/`+Inf`/`-Inf`) to a shared JSON sentinel `{"__nonfinite__": "nan"|"inf"|"-inf"}` so the round-trip is stable — because raw pydantic `model_dump_json()` coerces those to `null` and `model_validate_json()` then rejects `null` for a float field (verified on pydantic 2.12.5). No `orjson`. Compute-service must NOT fall back to FastAPI's default response serializer for this operation — it hand-serializes with `dumps_model`. (Spec §A-3; decision 2026-07-24.)
- **No Decimal across the boundary:** a contract test must assert the operation's request/response models declare no `Decimal` field. Decimal is not used in the repo today; the guard keeps it absent. (Spec §A-3.)
- **Coarse interface:** `/attribution` is already 1 route = 1 service call (`_portfolio_analytics.build_attribution(payload)`); Slice 1 must preserve that 1:1 mapping. The BFF must never loop over compute calls. (Spec §A-1.)
- **Config keys (exact names):** `MONEYVIEW_COMPUTE_CLIENT_MODE` (`inprocess`|`http`, default `inprocess`), `MONEYVIEW_COMPUTE_SERVICE_BASE_URL` (default `http://127.0.0.1:8600`), `MONEYVIEW_COMPUTE_CONNECT_TIMEOUT` (default `2.0`), `MONEYVIEW_COMPUTE_TIMEOUT` (default `30.0`), `MONEYVIEW_COMPUTE_STREAM_READ_TIMEOUT` (default `300.0`). The stream timeout is defined now for the seam even though Slice 1 has no streaming operation. (Spec §ComputeClient settings.)
- **Retry policy:** `build_attribution` is idempotent but NOT cheap (it runs risk/attribution math) → it is **non-retryable** on timeout; return an error, do not retry. Only cheap idempotent reads retry. Slice 1 ships no retry logic beyond this classification. (Spec §A-4.)
- **Telemetry buckets:** serialization (measured) / wire (modeled from payload bytes + assumed RTT, NOT loopback residual) / compute (measured on the server, returned via header). Record measured-vs-estimated side by side. (Spec §A-2.)
- **Request correlation:** the BFF's `X-Request-ID` must propagate to compute-service and back so one browser action correlates across both processes. (Spec §Data flow.)
- **Default mode is `inprocess`:** every existing test in `tests/api/test_portfolio_attribution.py` must still pass unchanged after the route is rewired. That is the parity guarantee.
- **Backward compatibility:** the browser-facing contract of `POST /api/v1/portfolio/attribution` (request shape, `APIResponse[AttributionResult]` envelope, 422 on `ValueError`) is unchanged.

## Scope (Slice 1 only)

**In scope:** the `ComputeClient` seam, the serializer + fidelity guards, the `compute-service` app exposing exactly one operation (`build_attribution`), the config switch, rewiring the `/attribution` route, three-bucket telemetry on the seam, and a benchmark that reports added-hop latency in both modes.

**Out of scope (later slices / phases):** the `GET /portfolio/watchlist` per-row `get_stock_ohlcv` loop and its route-level `get_db()` calls (Slice 2 — the deliberate coarsening exercise); moving every other service into compute-service; SSE streaming proxy for `corporate/dcf/*/stream`; connection pooling / a shared `AsyncClient`; any cloud/VPC/Tailscale/Wazuh work (Phase 2). The full route audit (Task 1) is produced now but only `/attribution` is migrated in Slice 1.

## File Structure

- `apps/api/compute/__init__.py` — package marker.
- `apps/api/compute/serialization.py` — the single pinned serializer + Decimal guard helper.
- `apps/api/compute/errors.py` — `ComputeError` (uniform error type both clients raise).
- `apps/api/compute/config.py` — `os.getenv`-based settings getters (the config keys above).
- `apps/api/compute/client.py` — `ComputeClient` Protocol, `InProcessComputeClient`, `HttpComputeClient`, `get_compute_client()` factory.
- `apps/api/compute_service/__init__.py` — package marker.
- `apps/api/compute_service/main.py` — new FastAPI app `compute_app` (private tier) + request-id middleware + lifespan.
- `apps/api/compute_service/routes/__init__.py`, `apps/api/compute_service/routes/portfolio.py` — the `POST /compute/portfolio/attribution` operation.
- `apps/api/routes/portfolio.py` — **modify** the `/attribution` handler (lines 203-214) to call the client.
- `tests/api/compute/__init__.py`, plus one test module per task under `tests/api/compute/`.

---

### Task 1: Route audit (Spec §A-1 — must come first)

**Files:**
- Create: `docs/architecture/compute-route-audit.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a documented list of every route handler that calls services ≥2 times or inside a loop, with the coarse compute operation each should map to. Later slices consume this to know what to migrate and in what order.

- [ ] **Step 1: Enumerate service-calling routes**

Run from repo root (`e:\MoneyView`):

```bash
rg -n "get_db\(|_mkt\.|_news\.|_portfolio_analytics\.|Service\(\)|\.build_|\.get_stock_ohlcv|for .* in .*:" apps/api/routes
```

- [ ] **Step 2: Write the audit doc**

For each router file, record: route, whether it makes 0/1/≥2 service calls, whether any call is inside a loop, and the target coarse operation. It must at minimum capture these confirmed facts (verified 2026-07-24):

```markdown
# Compute Route Audit (Spec §A-1)

Rule: each browser request must map to exactly ONE compute call. Fan-out lives
inside compute-service, never in a BFF route loop.

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| POST /portfolio/attribution (portfolio.py:203-214) | 1 (`build_attribution`) | no | COARSE — OK as-is | `build_attribution` (Slice 1) |
| GET /portfolio/watchlist (portfolio.py:43-83) | N (`get_stock_ohlcv` per row, line 57) + `get_db` | YES (line 55 `for row in rows`) | OFFENDER — must coarsen | new `list_watchlist_with_quotes` (Slice 2) |
| GET/PUT /portfolio/preferences (portfolio.py:86-127) | direct `get_db()` at route | no | BFF-DB violation | `get/set_preferences` (Slice 2) |
| POST /portfolio/watchlist, DELETE, resync, sync, sync-status | direct `get_db()` / seed helpers at route | no | BFF-DB violation | watchlist mutation ops (Slice 2) |
| corporate bulk DCF (corporate.py:325 `build_bulk_dcf_reports`) | 1 at route, fan-out inside service | no | COARSE — OK (server-side fan-out) | `build_bulk_dcf_reports` (later) |

Slice 1 migrates ONLY `/portfolio/attribution`. Everything else is listed here
so the boundary is drawn coarse before those routes are touched.
```

Then run `rg` across the other routers (`corporate.py`, `market.py`, `detail.py`, `news.py`, `monte_carlo.py`, `report.py`, `stock.py`, `diagnostic.py`) and add a row for each handler, using the same COARSE / OFFENDER / BFF-DB-violation verdicts.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/compute-route-audit.md
git commit -m "docs: compute route audit (spec A-1) — attribution is slice-1 coarse op"
```

---

### Task 2: Pinned serializer + fidelity guards (Spec §A-3)

**Files:**
- Create: `apps/api/compute/__init__.py` (empty)
- Create: `apps/api/compute/serialization.py`
- Create: `tests/api/compute/__init__.py` (empty)
- Test: `tests/api/compute/test_serialization_fidelity.py`

**Interfaces:**
- Produces:
  - `dumps_model(model: BaseModel) -> str`
  - `loads_model(model_type: type[T], raw: str) -> T` where `T = TypeVar("T", bound=BaseModel)`
  - `assert_no_decimal_fields(model_type: type[BaseModel]) -> None` (raises `AssertionError` if any field, recursively, is annotated `Decimal`)

- [ ] **Step 1: Write the failing test**

```python
# tests/api/compute/test_serialization_fidelity.py
import enum
import math
from datetime import datetime, timezone

import pytest
from pydantic import BaseModel

from apps.api.compute.serialization import (
    assert_no_decimal_fields,
    dumps_model,
    loads_model,
)
from apps.api.models.schemas import AttributionRequest, AttributionResult


class _Flavor(str, enum.Enum):
    RED = "red"


class _FidelityProbe(BaseModel):
    nan_value: float
    pos_inf: float
    neg_inf: float
    aware_dt: datetime
    naive_dt: datetime
    flavor: _Flavor
    ratios: list[float]


def test_nan_inf_datetime_enum_round_trip_is_stable():
    probe = _FidelityProbe(
        nan_value=float("nan"),
        pos_inf=float("inf"),
        neg_inf=float("-inf"),
        aware_dt=datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc),
        naive_dt=datetime(2026, 7, 24, 12, 0),
        flavor=_Flavor.RED,
        ratios=[1.5, float("nan"), float("inf")],
    )
    restored = loads_model(_FidelityProbe, dumps_model(probe))

    assert math.isnan(restored.nan_value)
    assert restored.pos_inf == float("inf")
    assert restored.neg_inf == float("-inf")
    assert restored.aware_dt == probe.aware_dt
    assert restored.aware_dt.tzinfo is not None
    assert restored.naive_dt == probe.naive_dt
    assert restored.naive_dt.tzinfo is None
    assert restored.flavor is _Flavor.RED
    # non-finite floats survive inside a nested list too
    assert restored.ratios[0] == 1.5
    assert math.isnan(restored.ratios[1])
    assert restored.ratios[2] == float("inf")


def test_dumps_model_output_is_strict_json_no_bare_nan():
    # The wire payload must be strict JSON — NO bare NaN/Infinity tokens, which a
    # strict decoder on the other hop would reject. Non-finite values live in the
    # sentinel object instead.
    probe = _FidelityProbe(
        nan_value=float("nan"), pos_inf=float("inf"), neg_inf=float("-inf"),
        aware_dt=datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc),
        naive_dt=datetime(2026, 7, 24, 12, 0), flavor=_Flavor.RED, ratios=[1.0],
    )
    raw = dumps_model(probe)
    assert "NaN" not in raw
    assert "Infinity" not in raw
    assert "__nonfinite__" in raw


def test_decimal_absence_guard_passes_on_boundary_models():
    # These are the models that cross the boundary in Slice 1.
    assert_no_decimal_fields(AttributionRequest)
    assert_no_decimal_fields(AttributionResult)


def test_decimal_absence_guard_catches_a_decimal_field():
    from decimal import Decimal

    class _Bad(BaseModel):
        price: Decimal

    with pytest.raises(AssertionError):
        assert_no_decimal_fields(_Bad)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/compute/test_serialization_fidelity.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.compute.serialization'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/compute/serialization.py
"""The single serializer that crosses the compute boundary (spec §A-3).

One shared serialization policy is used on BOTH ends so a value encoded by one
process is decoded identically by the other. It builds on pydantic
(`model_dump(mode="python")` / `model_validate`) plus stdlib `json`.

JSON has no NaN/Inf: raw pydantic `model_dump_json()` coerces non-finite floats
to `null`, and `model_validate_json()` then rejects `null` for a float field
(verified pydantic 2.12.5). So non-finite floats are mapped to a shared sentinel
object `{"__nonfinite__": "nan"|"inf"|"-inf"}` on the way out and restored on the
way in. This is one shared policy, NOT a per-endpoint encoder — the same two
functions are the only serializer on either side of the hop. No orjson.
"""
from __future__ import annotations

import enum
import json
import math
from datetime import date, datetime
from decimal import Decimal
from typing import TypeVar, get_args, get_origin

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

_NONFINITE_KEY = "__nonfinite__"


def _encode(obj: object) -> object:
    """Make a pydantic `mode="python"` dump strictly JSON-safe.

    pydantic's python dump preserves float('nan')/inf and leaves datetime/enum as
    Python objects; convert each leaf to a JSON-native form. Non-finite floats
    become the shared sentinel so they survive the round trip.
    """
    if isinstance(obj, float):
        if math.isnan(obj):
            return {_NONFINITE_KEY: "nan"}
        if math.isinf(obj):
            return {_NONFINITE_KEY: "inf" if obj > 0 else "-inf"}
        return obj
    if isinstance(obj, enum.Enum):
        return _encode(obj.value)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, (list, tuple)):
        return [_encode(item) for item in obj]
    if isinstance(obj, dict):
        return {key: _encode(value) for key, value in obj.items()}
    return obj


def _decode(obj: object) -> object:
    if isinstance(obj, dict):
        if len(obj) == 1 and _NONFINITE_KEY in obj:
            token = obj[_NONFINITE_KEY]
            mapping = {"nan": float("nan"), "inf": float("inf"), "-inf": float("-inf")}
            if token not in mapping:
                raise ValueError(f"unknown non-finite sentinel token: {token!r}")
            return mapping[token]
        return {key: _decode(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_decode(item) for item in obj]
    return obj


def dumps_model(model: BaseModel) -> str:
    # allow_nan=False: every non-finite float was already sentinel-encoded, so if
    # one slips through json.dumps raises instead of emitting a bare NaN token.
    return json.dumps(_encode(model.model_dump(mode="python")), allow_nan=False)


def loads_model(model_type: type[T], raw: str) -> T:
    return model_type.model_validate(_decode(json.loads(raw)))


def _annotation_mentions_decimal(annotation: object) -> bool:
    if annotation is Decimal:
        return True
    return any(_annotation_mentions_decimal(arg) for arg in get_args(annotation))


def assert_no_decimal_fields(model_type: type[BaseModel], _seen: set | None = None) -> None:
    """Recursively assert no field on model_type (or nested BaseModels) is Decimal."""
    seen = _seen if _seen is not None else set()
    if model_type in seen:
        return
    seen.add(model_type)
    for name, field in model_type.model_fields.items():
        annotation = field.annotation
        assert not _annotation_mentions_decimal(annotation), (
            f"{model_type.__name__}.{name} uses Decimal — not allowed across the compute boundary"
        )
        for arg in (annotation, *get_args(annotation)):
            origin = get_origin(arg) or arg
            if isinstance(origin, type) and issubclass(origin, BaseModel):
                assert_no_decimal_fields(origin, seen)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/compute/test_serialization_fidelity.py -v`
Expected: PASS (5 tests). The sentinel scheme makes the round-trip stable: `test_nan_inf_datetime_enum_round_trip_is_stable` proves NaN/Inf/datetime/enum (incl. non-finite inside a nested list) survive; `test_dumps_model_output_is_strict_json_no_bare_nan` proves the wire payload is strict JSON (no bare `NaN`/`Infinity` tokens). If the round-trip test still fails, do NOT weaken it — report DONE_WITH_CONCERNS/BLOCKED with the exact observed encode/decode behavior; the whole serializer invariant depends on this.

- [ ] **Step 5: Commit**

```bash
git add apps/api/compute/__init__.py apps/api/compute/serialization.py tests/api/compute/__init__.py tests/api/compute/test_serialization_fidelity.py
git commit -m "feat: pinned compute-boundary serializer + NaN/Inf/datetime/Decimal fidelity guards (spec A-3)"
```

---

### Task 3: `ComputeError` + config getters

**Files:**
- Create: `apps/api/compute/errors.py`
- Create: `apps/api/compute/config.py`
- Test: `tests/api/compute/test_compute_config.py`

**Interfaces:**
- Produces:
  - `ComputeError(status_code: int, detail: str)` — exception with `.status_code: int` and `.detail: str`.
  - `compute_client_mode() -> str`, `compute_service_base_url() -> str`, `compute_connect_timeout() -> float`, `compute_timeout() -> float`, `compute_stream_read_timeout() -> float`.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/compute/test_compute_config.py
from apps.api.compute.config import (
    compute_client_mode,
    compute_connect_timeout,
    compute_service_base_url,
    compute_stream_read_timeout,
    compute_timeout,
)
from apps.api.compute.errors import ComputeError


def test_defaults_when_env_unset(monkeypatch):
    for key in (
        "MONEYVIEW_COMPUTE_CLIENT_MODE",
        "MONEYVIEW_COMPUTE_SERVICE_BASE_URL",
        "MONEYVIEW_COMPUTE_CONNECT_TIMEOUT",
        "MONEYVIEW_COMPUTE_TIMEOUT",
        "MONEYVIEW_COMPUTE_STREAM_READ_TIMEOUT",
    ):
        monkeypatch.delenv(key, raising=False)
    assert compute_client_mode() == "inprocess"
    assert compute_service_base_url() == "http://127.0.0.1:8600"
    assert compute_connect_timeout() == 2.0
    assert compute_timeout() == 30.0
    assert compute_stream_read_timeout() == 300.0


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("MONEYVIEW_COMPUTE_CLIENT_MODE", "HTTP")
    monkeypatch.setenv("MONEYVIEW_COMPUTE_TIMEOUT", "12.5")
    assert compute_client_mode() == "http"
    assert compute_timeout() == 12.5


def test_compute_error_carries_status_and_detail():
    err = ComputeError(status_code=422, detail="bad input")
    assert err.status_code == 422
    assert err.detail == "bad input"
    assert "bad input" in str(err)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/compute/test_compute_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.compute.config'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/compute/errors.py
from __future__ import annotations


class ComputeError(Exception):
    """Uniform error raised by every ComputeClient implementation.

    Both the in-process and HTTP clients raise this so the BFF route handles one
    error type regardless of transport. status_code maps to the browser-facing
    HTTP status; detail is the human-readable message.
    """

    def __init__(self, status_code: int, detail: str):
        super().__init__(f"[{status_code}] {detail}")
        self.status_code = status_code
        self.detail = detail
```

```python
# apps/api/compute/config.py
"""Compute-seam settings. Matches the repo's os.getenv convention (no BaseSettings)."""
from __future__ import annotations

import os


def compute_client_mode() -> str:
    return os.getenv("MONEYVIEW_COMPUTE_CLIENT_MODE", "inprocess").strip().lower()


def compute_service_base_url() -> str:
    return os.getenv("MONEYVIEW_COMPUTE_SERVICE_BASE_URL", "http://127.0.0.1:8600").strip()


def compute_connect_timeout() -> float:
    return float(os.getenv("MONEYVIEW_COMPUTE_CONNECT_TIMEOUT", "2.0"))


def compute_timeout() -> float:
    return float(os.getenv("MONEYVIEW_COMPUTE_TIMEOUT", "30.0"))


def compute_stream_read_timeout() -> float:
    return float(os.getenv("MONEYVIEW_COMPUTE_STREAM_READ_TIMEOUT", "300.0"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/compute/test_compute_config.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/compute/errors.py apps/api/compute/config.py tests/api/compute/test_compute_config.py
git commit -m "feat: compute-seam config getters and uniform ComputeError"
```

---

### Task 4: compute-service app exposing `build_attribution`

**Files:**
- Create: `apps/api/compute_service/__init__.py` (empty)
- Create: `apps/api/compute_service/routes/__init__.py` (empty)
- Create: `apps/api/compute_service/routes/portfolio.py`
- Create: `apps/api/compute_service/main.py`
- Test: `tests/api/compute/test_compute_service_app.py`

**Interfaces:**
- Consumes: `PortfolioAnalyticsService.build_attribution` (existing), `dumps_model`/`loads_model` (Task 2), `set_current_request_id`/`reset_current_request_id` (existing in `apps.api.core.dev_monitor`).
- Produces: ASGI app `compute_app` serving `POST /compute/portfolio/attribution`. Request body = a `dumps_model`-encoded `AttributionRequest` (domain model, NOT the web envelope), decoded with `loads_model`. Response body = a `dumps_model`-encoded `AttributionResult` (domain model), hand-serialized — NOT via FastAPI's default serializer. On `ValueError` from the service → HTTP 422 with `{"detail": "<msg>"}`. Sets response header `X-Compute-Duration-Ms` (server compute time) and echoes `X-Request-ID`.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/compute/test_compute_service_app.py
from fastapi.testclient import TestClient

from apps.api.compute_service.main import compute_app


def _valid_request_json():
    return {
        "tickers": ["AAPL", "MSFT", "TSLA"],
        "weights": [0.4, 0.4, 0.2],
        "benchmark": "^GSPC",
        "period": "1y",
        "currency": "USD",
        "attribution_method": "brinson_fachler_arithmetic",
        "allow_synthetic_fallback": True,
        "allow_benchmark_proxy": True,
    }


def test_compute_attribution_returns_domain_model_not_envelope():
    client = TestClient(compute_app)
    resp = client.post("/compute/portfolio/attribution", json=_valid_request_json())
    assert resp.status_code == 200
    body = resp.json()
    # Domain model directly — NOT wrapped in {"data": ...}
    assert "data" not in body
    assert set(body.keys()) == {
        "totals", "active_return", "effects",
        "sector_breakdowns", "risk_metrics", "metadata",
    }
    assert resp.headers.get("X-Compute-Duration-Ms") is not None


def test_compute_attribution_maps_value_error_to_422():
    client = TestClient(compute_app)
    bad = _valid_request_json()
    bad["allow_synthetic_fallback"] = False
    bad["tickers"] = ["ZZZX", "YYYX"]
    bad["weights"] = [0.5, 0.5]
    resp = client.post("/compute/portfolio/attribution", json=bad)
    assert resp.status_code == 422
    assert "allow_synthetic_fallback=true" in resp.json()["detail"]


def test_compute_attribution_echoes_request_id():
    client = TestClient(compute_app)
    resp = client.post(
        "/compute/portfolio/attribution",
        json=_valid_request_json(),
        headers={"X-Request-ID": "corr-123"},
    )
    assert resp.headers.get("X-Request-ID") == "corr-123"


def test_compute_response_decodes_with_shared_serializer():
    # The server hand-serializes with dumps_model; the client decodes with
    # loads_model. Lock that the response body is exactly what loads_model reads,
    # so the "single serializer, both ends" invariant is exercised here.
    from apps.api.compute.serialization import loads_model
    from apps.api.models.schemas import AttributionResult

    client = TestClient(compute_app)
    resp = client.post("/compute/portfolio/attribution", json=_valid_request_json())
    assert resp.status_code == 200
    restored = loads_model(AttributionResult, resp.text)
    assert restored.metadata.method == "brinson_fachler_arithmetic"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/compute/test_compute_service_app.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.compute_service.main'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/compute_service/routes/portfolio.py
"""compute-service portfolio operations. Domain models only — no web envelope.

Uses the shared serializer (dumps_model/loads_model) on BOTH the request and the
response — NOT FastAPI's default pydantic serializer — so the "single serializer,
both ends" invariant (spec §A-3) holds even for non-finite floats. FastAPI's
default response serializer would coerce NaN/Inf to null and break the round trip.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Request, Response

from apps.api.compute.serialization import dumps_model, loads_model
from apps.api.models.schemas import AttributionRequest, AttributionResult
from apps.api.services.market_data import MarketDataService
from apps.api.services.portfolio_service import PortfolioAnalyticsService

router = APIRouter()
_analytics = PortfolioAnalyticsService(MarketDataService())


@router.post("/portfolio/attribution")
async def compute_attribution(request: Request) -> Response:
    started = time.perf_counter()
    payload = loads_model(AttributionRequest, (await request.body()).decode("utf-8"))
    try:
        result = _analytics.build_attribution(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    return Response(
        content=dumps_model(result),
        media_type="application/json",
        headers={"X-Compute-Duration-Ms": str(duration_ms)},
    )
```

Note: this handler reads the raw body and validates with `loads_model` (rather
than a `payload: AttributionRequest = Body(...)` parameter) because the BFF sends
a `dumps_model`-encoded body whose non-finite sentinels FastAPI's automatic
parsing would not understand. `response_model=` is intentionally omitted — the
handler hand-serializes, so FastAPI must not re-serialize `result`.

```python
# apps/api/compute_service/main.py
"""compute-service (private tier). Owns services + core_finance + SQLite + ingestion.

Phase 1: binds to loopback only. Exposes coarse compute operations over internal
HTTP. Returns domain models; the web envelope stays in the BFF.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from apps.api.compute_service.routes.portfolio import router as portfolio_router
from apps.api.core.dev_monitor import reset_current_request_id, set_current_request_id
from apps.api.core.logger import setup_logger
from apps.api.services.db import init_db

logger = setup_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("compute-service starting; initialising database.")
    init_db()
    yield
    logger.info("compute-service shutting down.")


compute_app = FastAPI(title="MoneyView compute-service", version="1.0.0", lifespan=lifespan)


@compute_app.middleware("http")
async def propagate_request_id(request: Request, call_next):
    """Adopt the BFF's X-Request-ID so perf events correlate across processes."""
    request_id = request.headers.get("X-Request-ID")
    token = set_current_request_id(request_id)
    try:
        response = await call_next(request)
    finally:
        reset_current_request_id(token)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


compute_app.include_router(portfolio_router, prefix="/compute", tags=["Compute"])


@compute_app.get("/compute/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.api.compute_service.main:compute_app", host="127.0.0.1", port=8600, reload=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/compute/test_compute_service_app.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/compute_service tests/api/compute/test_compute_service_app.py
git commit -m "feat: compute-service app exposing coarse build_attribution op (domain models only)"
```

---

### Task 5: `ComputeClient` — protocol, in-process, HTTP, factory

**Files:**
- Create: `apps/api/compute/client.py`
- Test: `tests/api/compute/test_compute_client.py`

**Interfaces:**
- Consumes: `compute_app` (Task 4), `dumps_model`/`loads_model` (Task 2), `ComputeError` (Task 3), config getters (Task 3), `PortfolioAnalyticsService` (existing), `get_current_request_id` (existing).
- Produces:
  - `class ComputeClient(Protocol)` with `async def build_attribution(self, request: AttributionRequest) -> AttributionResult`.
  - `InProcessComputeClient(analytics: PortfolioAnalyticsService | None = None)`.
  - `HttpComputeClient(base_url, connect_timeout, timeout, stream_read_timeout, transport=None)`.
  - `get_compute_client() -> ComputeClient` — returns in-process or HTTP per `compute_client_mode()`.
  - `set_compute_client_for_test(client)` / `reset_compute_client()` — test seam so the BFF can be pointed at an injected client.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/compute/test_compute_client.py
import httpx
import pytest

from apps.api.compute.client import HttpComputeClient, InProcessComputeClient
from apps.api.compute.errors import ComputeError
from apps.api.compute_service.main import compute_app
from apps.api.models.schemas import AttributionRequest, AttributionResult


def _valid_request() -> AttributionRequest:
    return AttributionRequest(
        tickers=["AAPL", "MSFT", "TSLA"],
        weights=[0.4, 0.4, 0.2],
        benchmark="^GSPC",
        period="1y",
        currency="USD",
        attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=True,
        allow_benchmark_proxy=True,
    )


def _http_client_against_app() -> HttpComputeClient:
    return HttpComputeClient(
        base_url="http://compute.test",
        connect_timeout=2.0,
        timeout=30.0,
        stream_read_timeout=300.0,
        transport=httpx.ASGITransport(app=compute_app),
    )


@pytest.mark.anyio
async def test_inprocess_client_returns_attribution_result():
    result = await InProcessComputeClient().build_attribution(_valid_request())
    assert isinstance(result, AttributionResult)
    assert result.metadata.method == "brinson_fachler_arithmetic"


@pytest.mark.anyio
async def test_http_client_returns_attribution_result():
    result = await _http_client_against_app().build_attribution(_valid_request())
    assert isinstance(result, AttributionResult)
    assert result.metadata.method == "brinson_fachler_arithmetic"


@pytest.mark.anyio
async def test_both_clients_agree_excluding_variable_fields():
    req = _valid_request()
    a = (await InProcessComputeClient().build_attribution(req)).model_dump()
    b = (await _http_client_against_app().build_attribution(req)).model_dump()
    for blob in (a, b):
        blob["metadata"].pop("generated_at", None)
        blob["metadata"].pop("cache_key", None)
        blob["metadata"].pop("cache_hit", None)
    assert a == b


@pytest.mark.anyio
async def test_inprocess_client_wraps_value_error_as_compute_error():
    bad = AttributionRequest(
        tickers=["ZZZX", "YYYX"], weights=[0.5, 0.5], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=False, allow_benchmark_proxy=True,
    )
    with pytest.raises(ComputeError) as exc_info:
        await InProcessComputeClient().build_attribution(bad)
    assert exc_info.value.status_code == 422


@pytest.mark.anyio
async def test_http_client_maps_422_to_compute_error():
    bad = AttributionRequest(
        tickers=["ZZZX", "YYYX"], weights=[0.5, 0.5], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=False, allow_benchmark_proxy=True,
    )
    with pytest.raises(ComputeError) as exc_info:
        await _http_client_against_app().build_attribution(bad)
    assert exc_info.value.status_code == 422
    assert "allow_synthetic_fallback=true" in exc_info.value.detail
```

Add the `anyio` backend fixture at the top of the file so `@pytest.mark.anyio` runs on asyncio only:

```python
@pytest.fixture
def anyio_backend():
    return "asyncio"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/compute/test_compute_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.compute.client'`
(If collection errors on `anyio` marker, `pip install anyio` — it ships with httpx/starlette, so it is already present.)

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/compute/client.py
"""The compute seam. One typed client localises the transport choice to one place."""
from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

from apps.api.compute.config import (
    compute_client_mode,
    compute_connect_timeout,
    compute_service_base_url,
    compute_stream_read_timeout,
    compute_timeout,
)
from apps.api.compute.errors import ComputeError
from apps.api.compute.serialization import dumps_model, loads_model
from apps.api.core.dev_monitor import get_current_request_id
from apps.api.models.schemas import AttributionRequest, AttributionResult
from apps.api.services.market_data import MarketDataService
from apps.api.services.portfolio_service import PortfolioAnalyticsService

_ATTRIBUTION_PATH = "/compute/portfolio/attribution"


class ComputeClient(Protocol):
    async def build_attribution(self, request: AttributionRequest) -> AttributionResult: ...


class InProcessComputeClient:
    """Calls services directly — identical behaviour to today. Migration control."""

    def __init__(self, analytics: PortfolioAnalyticsService | None = None):
        self._analytics = analytics or PortfolioAnalyticsService(MarketDataService())

    async def build_attribution(self, request: AttributionRequest) -> AttributionResult:
        try:
            return await asyncio.to_thread(self._analytics.build_attribution, request)
        except ValueError as exc:
            raise ComputeError(status_code=422, detail=str(exc)) from exc


class HttpComputeClient:
    """The real network split. build_attribution is non-retryable (idempotent, not cheap)."""

    def __init__(
        self,
        base_url: str,
        connect_timeout: float,
        timeout: float,
        stream_read_timeout: float,
        transport: httpx.ASGITransport | None = None,
    ):
        self._base_url = base_url
        self._timeout = httpx.Timeout(timeout, connect=connect_timeout)
        self._stream_read_timeout = stream_read_timeout
        self._transport = transport

    def _new_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout, transport=self._transport)

    async def build_attribution(self, request: AttributionRequest) -> AttributionResult:
        headers = {"content-type": "application/json"}
        request_id = get_current_request_id()
        if request_id:
            headers["X-Request-ID"] = request_id
        async with self._new_client() as client:
            resp = await client.post(_ATTRIBUTION_PATH, content=dumps_model(request), headers=headers)
        if resp.status_code == 200:
            return loads_model(AttributionResult, resp.text)
        detail = _extract_detail(resp)
        raise ComputeError(status_code=resp.status_code, detail=detail)


def _extract_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict) and "detail" in body:
            return str(body["detail"])
    except Exception:
        pass
    return resp.text or f"compute-service returned {resp.status_code}"


_test_client_override: ComputeClient | None = None


def set_compute_client_for_test(client: ComputeClient) -> None:
    global _test_client_override
    _test_client_override = client


def reset_compute_client() -> None:
    global _test_client_override
    _test_client_override = None


_inprocess_singleton: InProcessComputeClient | None = None


def get_compute_client() -> ComputeClient:
    if _test_client_override is not None:
        return _test_client_override
    if compute_client_mode() == "http":
        return HttpComputeClient(
            base_url=compute_service_base_url(),
            connect_timeout=compute_connect_timeout(),
            timeout=compute_timeout(),
            stream_read_timeout=compute_stream_read_timeout(),
        )
    # Reuse one in-process client so the underlying PortfolioAnalyticsService and
    # its per-instance attribution cache are preserved across requests — matching
    # today's module-level `_portfolio_analytics` singleton in routes/portfolio.py.
    global _inprocess_singleton
    if _inprocess_singleton is None:
        _inprocess_singleton = InProcessComputeClient()
    return _inprocess_singleton
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/compute/test_compute_client.py -v`
Expected: PASS (5 tests). The `test_both_clients_agree_excluding_variable_fields` test is the parity proof — if it fails, the serializer is not truly identical across the hop.

- [ ] **Step 5: Commit**

```bash
git add apps/api/compute/client.py tests/api/compute/test_compute_client.py
git commit -m "feat: ComputeClient seam (in-process + http impls) with factory and test override"
```

---

### Task 6: Rewire the BFF `/attribution` route to the client

**Files:**
- Modify: `apps/api/routes/portfolio.py:203-214` (the `get_portfolio_attribution` handler) and its imports
- Test: `tests/api/compute/test_attribution_parity.py`

**Interfaces:**
- Consumes: `get_compute_client`, `set_compute_client_for_test`, `reset_compute_client`, `HttpComputeClient` (Task 5), `ComputeError` (Task 3), `compute_app` (Task 4).
- Produces: no new API; the browser contract of `POST /api/v1/portfolio/attribution` is unchanged. `_portfolio_analytics` is no longer used by the `/attribution` handler (but stays — other handlers in this file still use `_mkt`, `_news`; verify whether `_portfolio_analytics` has other users before removing).

- [ ] **Step 1: Write the failing test**

```python
# tests/api/compute/test_attribution_parity.py
import httpx
import pytest
from fastapi.testclient import TestClient

from apps.api.compute.client import (
    HttpComputeClient,
    reset_compute_client,
    set_compute_client_for_test,
)
from apps.api.compute_service.main import compute_app
from apps.api.main import app

_GOLDEN = {
    "tickers": ["AAPL", "MSFT", "TSLA"],
    "weights": [0.4, 0.4, 0.2],
    "benchmark": "^GSPC",
    "period": "1y",
    "currency": "USD",
    "attribution_method": "brinson_fachler_arithmetic",
    "allow_synthetic_fallback": True,
    "allow_benchmark_proxy": True,
}


def _strip_variable(payload: dict) -> dict:
    meta = payload["metadata"]
    for key in ("generated_at", "cache_key", "cache_hit"):
        meta.pop(key, None)
    return payload


@pytest.fixture(autouse=True)
def _reset():
    yield
    reset_compute_client()


def test_attribution_route_parity_inprocess_vs_http():
    client = TestClient(app)

    # default mode (inprocess)
    reset_compute_client()
    inproc = client.post("/api/v1/portfolio/attribution", json=_GOLDEN)
    assert inproc.status_code == 200

    # http mode via injected client pointed at compute_app in-memory
    set_compute_client_for_test(
        HttpComputeClient(
            base_url="http://compute.test",
            connect_timeout=2.0,
            timeout=30.0,
            stream_read_timeout=300.0,
            transport=httpx.ASGITransport(app=compute_app),
        )
    )
    http = client.post("/api/v1/portfolio/attribution", json=_GOLDEN)
    assert http.status_code == 200

    assert _strip_variable(inproc.json()["data"]) == _strip_variable(http.json()["data"])


def test_attribution_route_still_returns_422_in_http_mode():
    client = TestClient(app)
    set_compute_client_for_test(
        HttpComputeClient(
            base_url="http://compute.test",
            connect_timeout=2.0,
            timeout=30.0,
            stream_read_timeout=300.0,
            transport=httpx.ASGITransport(app=compute_app),
        )
    )
    bad = {**_GOLDEN, "allow_synthetic_fallback": False, "tickers": ["ZZZX", "YYYX"], "weights": [0.5, 0.5]}
    resp = client.post("/api/v1/portfolio/attribution", json=bad)
    assert resp.status_code == 422
    assert "allow_synthetic_fallback=true" in resp.json()["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/compute/test_attribution_parity.py -v`
Expected: FAIL — `test_attribution_route_still_returns_422_in_http_mode` fails because the current route calls `_portfolio_analytics.build_attribution` directly (ignoring the injected client), so http mode is never exercised.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/routes/portfolio.py`, add imports near the existing service imports (after line 32):

```python
from apps.api.compute.client import get_compute_client
from apps.api.compute.errors import ComputeError
```

Replace the handler at lines 203-214 with:

```python
@router.post("/attribution", response_model=APIResponse[AttributionResult])
async def get_portfolio_attribution(payload: AttributionRequest = Body(...)):
    """
    Portfolio-level arithmetic Brinson-Fachler attribution.

    Returns domain schemas only and avoids chart-specific shaping in the API layer.
    Compute runs behind the ComputeClient seam (in-process or compute-service).
    """
    try:
        result = await get_compute_client().build_attribution(payload)
    except ComputeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return APIResponse(data=result)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/compute/test_attribution_parity.py tests/api/test_portfolio_attribution.py -v`
Expected: PASS. The existing `test_portfolio_attribution.py` suite (default inprocess mode) must still be green — that is the backward-compat guarantee.

- [ ] **Step 5: Commit**

```bash
git add apps/api/routes/portfolio.py tests/api/compute/test_attribution_parity.py
git commit -m "feat: route /portfolio/attribution through ComputeClient seam (parity preserved)"
```

---

### Task 7: Three-bucket telemetry on the HTTP hop (Spec §A-2)

**Files:**
- Modify: `apps/api/compute/client.py` (`HttpComputeClient.build_attribution` — add measurement + emit)
- Test: `tests/api/compute/test_compute_telemetry.py`

**Interfaces:**
- Consumes: `emit_performance_event`, `PerformanceEvent`, `get_current_request_id` (existing), `X-Compute-Duration-Ms` response header (Task 4).
- Produces: on each `HttpComputeClient.build_attribution`, one `PerformanceEvent(scope="external", operation="compute_client.build_attribution")` whose `metadata` carries `serialization_ms` (measured), `compute_ms` (from server header), `wire_estimated_ms` (modeled), `payload_bytes`, and `mode="http"`. `scope="external"` already exists in the Literal, so no schema change.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/compute/test_compute_telemetry.py
import httpx
import pytest

from apps.api.compute.client import HttpComputeClient
from apps.api.compute_service.main import compute_app
from apps.api.core import dev_monitor
from apps.api.models.schemas import AttributionRequest


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _CapturingSink(dev_monitor.DevMonitorSink):
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)
        return event


@pytest.fixture
def capture(monkeypatch):
    sink = _CapturingSink()
    monkeypatch.setattr(dev_monitor, "_sink", sink)
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    return sink


def _req() -> AttributionRequest:
    return AttributionRequest(
        tickers=["AAPL", "MSFT", "TSLA"], weights=[0.4, 0.4, 0.2], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=True, allow_benchmark_proxy=True,
    )


@pytest.mark.anyio
async def test_http_client_emits_three_bucket_event(capture):
    client = HttpComputeClient(
        base_url="http://compute.test", connect_timeout=2.0, timeout=30.0,
        stream_read_timeout=300.0, transport=httpx.ASGITransport(app=compute_app),
    )
    await client.build_attribution(_req())

    events = [e for e in capture.events if e.operation == "compute_client.build_attribution"]
    assert len(events) == 1
    meta = events[0].metadata
    assert meta["mode"] == "http"
    assert "serialization_ms" in meta
    assert "compute_ms" in meta
    assert "wire_estimated_ms" in meta
    assert meta["payload_bytes"] > 0
    assert events[0].scope == "external"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/compute/test_compute_telemetry.py -v`
Expected: FAIL — no `compute_client.build_attribution` event is emitted yet.

- [ ] **Step 3: Write minimal implementation**

At the top of `apps/api/compute/client.py`, extend the imports:

```python
import time

from apps.api.core.dev_monitor import emit_performance_event, get_current_request_id
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
```

Add a module constant for the modeled-wire assumption (documented, not measured):

```python
# Assumed round-trip for Tailscale wire-time modelling (spec §A-2: wire is MODELED,
# never the loopback residual). ~20ms RTT + ~1 Gbps effective bandwidth.
_ASSUMED_RTT_MS = 20.0
_ASSUMED_BYTES_PER_MS = 125_000.0  # ~1 Gbps
```

Replace `HttpComputeClient.build_attribution` with the measured version:

```python
    async def build_attribution(self, request: AttributionRequest) -> AttributionResult:
        headers = {"content-type": "application/json"}
        request_id = get_current_request_id()
        if request_id:
            headers["X-Request-ID"] = request_id

        enc_start = time.perf_counter()
        body = dumps_model(request)
        serialize_ms = (time.perf_counter() - enc_start) * 1000

        async with self._new_client() as client:
            resp = await client.post(_ATTRIBUTION_PATH, content=body, headers=headers)

        if resp.status_code != 200:
            raise ComputeError(status_code=resp.status_code, detail=_extract_detail(resp))

        dec_start = time.perf_counter()
        result = loads_model(AttributionResult, resp.text)
        serialize_ms += (time.perf_counter() - dec_start) * 1000

        payload_bytes = len(resp.content)
        compute_ms = float(resp.headers.get("X-Compute-Duration-Ms", 0.0) or 0.0)
        wire_estimated_ms = _ASSUMED_RTT_MS + payload_bytes / _ASSUMED_BYTES_PER_MS

        emit_performance_event(
            PerformanceEvent(
                request_id=request_id,
                level="info",
                scope="external",
                operation="compute_client.build_attribution",
                status="success",
                component="compute_client",
                metadata={
                    "mode": "http",
                    "serialization_ms": round(serialize_ms, 3),
                    "compute_ms": round(compute_ms, 3),
                    "wire_estimated_ms": round(wire_estimated_ms, 3),
                    "wire_note": "loopback measured / Tailscale estimated",
                    "payload_bytes": payload_bytes,
                },
            )
        )
        return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/compute/test_compute_telemetry.py -v`
Expected: PASS (1 test)

- [ ] **Step 5: Run the whole compute suite + attribution regression**

Run: `python -m pytest tests/api/compute tests/api/test_portfolio_attribution.py -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/compute/client.py tests/api/compute/test_compute_telemetry.py
git commit -m "feat: three-bucket (serialization/wire/compute) telemetry on the http compute hop (spec A-2)"
```

---

### Task 8: Added-hop latency benchmark + go/no-go record (Spec §success criteria)

**Files:**
- Create: `scripts/benchmark_compute_hop.py`
- Create: `docs/architecture/compute-slice1-results.md`

**Interfaces:**
- Consumes: `InProcessComputeClient`, `HttpComputeClient` (Task 5), `compute_app` (Task 4).
- Produces: a script that times `build_attribution` N times in both modes (http mode over a real loopback port, matching the two-process target) and prints P50/P95 added latency; and a results doc recording the number against the go/no-go threshold (**P95 added latency for this fast-read hop < 15 ms on loopback**).

- [ ] **Step 1: Write the benchmark script**

```python
# scripts/benchmark_compute_hop.py
"""Measure the added latency of the compute hop for POST /portfolio/attribution.

Compares InProcessComputeClient vs HttpComputeClient (over loopback ASGI transport,
which is the closest in-test analogue to the two-process split). For the true
two-process number, run compute-service on :8600 and set BASE_URL below.

Usage: python scripts/benchmark_compute_hop.py [iterations]
"""
from __future__ import annotations

import asyncio
import statistics
import sys
import time

import httpx

from apps.api.compute.client import HttpComputeClient, InProcessComputeClient
from apps.api.compute_service.main import compute_app
from apps.api.models.schemas import AttributionRequest


def _req() -> AttributionRequest:
    return AttributionRequest(
        tickers=["AAPL", "MSFT", "TSLA"], weights=[0.4, 0.4, 0.2], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=True, allow_benchmark_proxy=True,
    )


async def _time_client(client, req, iterations: int) -> list[float]:
    samples = []
    await client.build_attribution(req)  # warm caches
    for _ in range(iterations):
        start = time.perf_counter()
        await client.build_attribution(req)
        samples.append((time.perf_counter() - start) * 1000)
    return samples


def _p95(samples: list[float]) -> float:
    ordered = sorted(samples)
    return ordered[max(0, int(len(ordered) * 0.95) - 1)]


async def main(iterations: int) -> None:
    req = _req()
    inproc = await _time_client(InProcessComputeClient(), req, iterations)
    http = await _time_client(
        HttpComputeClient(
            base_url="http://compute.test", connect_timeout=2.0, timeout=30.0,
            stream_read_timeout=300.0, transport=httpx.ASGITransport(app=compute_app),
        ),
        req,
        iterations,
    )
    added_p50 = statistics.median(http) - statistics.median(inproc)
    added_p95 = _p95(http) - _p95(inproc)
    print(f"iterations={iterations}")
    print(f"inprocess  p50={statistics.median(inproc):.2f}ms  p95={_p95(inproc):.2f}ms")
    print(f"http(loop) p50={statistics.median(http):.2f}ms  p95={_p95(http):.2f}ms")
    print(f"ADDED HOP  p50={added_p50:.2f}ms  p95={added_p95:.2f}ms")
    print(f"go/no-go (<15ms p95 loopback): {'PASS' if added_p95 < 15 else 'FAIL'}")


if __name__ == "__main__":
    iters = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    asyncio.run(main(iters))
```

- [ ] **Step 2: Run the benchmark**

Run: `python scripts/benchmark_compute_hop.py 100`
Expected: prints per-mode P50/P95 and an `ADDED HOP ... p95=<n>ms` line ending in `PASS` or `FAIL`.

- [ ] **Step 3: (Optional) true two-process check**

In one terminal: `python -m uvicorn apps.api.compute_service.main:compute_app --host 127.0.0.1 --port 8600`. Confirm `curl http://127.0.0.1:8600/compute/health` returns `{"status":"ok"}`. This proves the split runs as two OS processes; the automated benchmark uses the in-memory transport for a stable number.

**WSL2 caveat (spec §Environment):** before trusting loopback as a boundary in any WSL-hosted run, check the networking mode — run `wsl -d Ubuntu-26.04 -- bash -c "cat /etc/wsl.conf 2>/dev/null; wslinfo --networking-mode 2>/dev/null"`. If it reports `mirrored`, `127.0.0.1` is shared with the Windows host and loopback is NOT a hard isolation boundary — note that in the results doc.

- [ ] **Step 4: Record the result**

```markdown
# Compute Split — Slice 1 Results

**Date:** <fill in>
**Endpoint:** POST /api/v1/portfolio/attribution
**Serializer:** pydantic model_dump_json / model_validate_json (single, both ends)

## Added-hop latency (loopback, N=100)
- inprocess p95: <n> ms
- http p95: <n> ms
- **added hop p95: <n> ms** — threshold <15ms → <PASS/FAIL>

## Three-bucket attribution (from /performance/summary, http mode)
- serialization_ms (measured): <n>
- compute_ms (measured, server): <n>
- wire_estimated_ms (modeled @20ms RTT): <n>
- payload_bytes: <n>

## Fidelity
- NaN / Inf / naive+aware datetime round-trip: PASS
- Decimal-absence guard on AttributionRequest/Result: PASS

## Parity
- inprocess vs http AttributionResult (excl. generated_at/cache_key/cache_hit): identical

## WSL networking mode
- <NAT | mirrored> — loopback-as-boundary is <valid | weakened>

## Go / no-go
- <PASS: proceed to Slice 2 (watchlist coarsening) | FAIL: re-coarsen interface>
```

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark_compute_hop.py docs/architecture/compute-slice1-results.md
git commit -m "test: added-hop latency benchmark + slice-1 results/go-no-go record"
```

---

## Self-Review

**Spec coverage (§A-1..A-4, components, success criteria):**
- §A-1 coarse interface → Task 1 (audit) + `/attribution` kept 1:1 (Task 6). Watchlist offender explicitly deferred to Slice 2, listed in the audit.
- §A-2 three buckets (serialization/wire/compute, measured vs estimated) → Task 7.
- §A-3 serializer invariant + NaN/Inf/datetime + Decimal-absence → Task 2 (+ used by all http tasks).
- §A-4 retry = idempotent AND cheap → build_attribution classified non-retryable (Global Constraints; enforced by not retrying in `HttpComputeClient`).
- compute-service owns compute + returns **domain models only** (no `APIResponse`) → Task 4.
- BFF wraps domain model in `APIResponse`, never accesses DB for this route → Task 6 (`/attribution` was already DB-free; watchlist DB-at-route violations deferred to Slice 2, recorded in audit).
- ComputeClient localises transport + settings (`COMPUTE_*`, separate stream timeout) → Tasks 3 & 5.
- X-Request-ID propagation across both processes → Task 4 (middleware) + Task 5/7 (client sends header).
- Success criteria: parity excl. variable fields (Task 6), three-bucket summary (Task 7), quantified go/no-go P95 <15ms (Task 8), WSL caveat (Task 8 Step 3).
- Streaming proxy, watchlist coarsening, connection pooling, cloud/Tailscale/Wazuh → explicitly Out of Scope.

**Placeholder scan:** results doc (Task 8 Step 4) intentionally contains `<fill in>` — it is a template the run fills with measured values, not plan-level TBD. No code step contains a placeholder.

**Type consistency:** `build_attribution(request: AttributionRequest) -> AttributionResult` identical across Protocol, both impls, compute-service route, and tests. `ComputeError(status_code, detail)` consistent (Tasks 3/5/6). Config getter names match Global Constraints. `dumps_model`/`loads_model`/`assert_no_decimal_fields` signatures consistent (Task 2 → 5). `set_compute_client_for_test`/`reset_compute_client` consistent (Task 5 → 6).
