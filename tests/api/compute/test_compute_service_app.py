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
