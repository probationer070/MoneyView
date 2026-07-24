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


def test_route_dispatches_through_injected_compute_client():
    """Tripwire: proves the route consults get_compute_client(), not the old
    direct _portfolio_analytics path. A reverted rewire would ignore the injected
    client and return 200 from the normal path, failing this test."""
    from apps.api.compute.errors import ComputeError

    class _SpyComputeClient:
        async def build_attribution(self, request):
            raise ComputeError(status_code=418, detail="spy-marker")

    client = TestClient(app)
    set_compute_client_for_test(_SpyComputeClient())
    resp = client.post("/api/v1/portfolio/attribution", json=_GOLDEN)
    assert resp.status_code == 418
    assert resp.json()["detail"] == "spy-marker"
