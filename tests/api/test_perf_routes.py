from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from apps.api.core import dev_monitor
from apps.api.main import app
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent

ENDPOINTS = [
    "/api/v1/dev/performance/requests",
    "/api/v1/dev/performance/waterfall/req-1",
    "/api/v1/dev/performance/by-ticker",
    "/api/v1/dev/performance/breakdown",
    "/api/v1/dev/performance/cache",
]


def _enable(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(tmp_path))
    dev_monitor.reset_dev_monitor_sink()
    return dev_monitor.get_dev_monitor_sink()


def test_all_endpoints_404_when_disabled(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR", raising=False)
    dev_monitor.reset_dev_monitor_sink()
    client = TestClient(app)
    for endpoint in ENDPOINTS:
        response = client.get(endpoint)
        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"


def test_empty_buffer_returns_200_with_empty_dto(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    client = TestClient(app)
    response = client.get("/api/v1/dev/performance/by-ticker")
    assert response.status_code == 200
    assert response.json()["data"]["rows"] == []


def test_unknown_request_id_returns_404(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    client = TestClient(app)
    assert client.get("/api/v1/dev/performance/waterfall/no-such-id").status_code == 404


def test_parameter_bounds_are_enforced(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    client = TestClient(app)
    assert client.get("/api/v1/dev/performance/requests?limit=0").status_code == 422
    assert client.get("/api/v1/dev/performance/requests?limit=201").status_code == 422
    assert client.get("/api/v1/dev/performance/by-ticker?window=0").status_code == 422
    assert client.get("/api/v1/dev/performance/by-ticker?window=3601").status_code == 422


def test_requests_endpoint_reports_buffer_occupancy(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "1234")
    sink = _enable(monkeypatch, tmp_path)
    sink.emit(
        PerformanceEvent(
            request_id="req-1", level="info", scope="api",
            operation="api.request_complete", status="success", duration_ms=5.0,
        )
    )
    client = TestClient(app)
    payload = client.get("/api/v1/dev/performance/requests").json()["data"]
    assert payload["buffer_limit"] == 1234
    assert payload["buffer_used"] >= 1


def test_filter_order_window_excludes_named_old_request():
    """window is applied after request_id, so an old named request is excluded."""
    from apps.api.routes.dev_monitor import _filter_events

    old = PerformanceEvent(
        request_id="req-old", level="info", scope="api", operation="api.request_complete",
        status="success", duration_ms=5.0,
        timestamp=datetime.now(timezone.utc) - timedelta(seconds=600),
    )
    assert _filter_events([old], request_id="req-old", route=None, window=None) == [old]
    assert _filter_events([old], request_id="req-old", route=None, window=60) == []


def test_waterfall_ignores_age(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    sink.emit(
        PerformanceEvent(
            request_id="req-old", level="info", scope="api",
            operation="api.request_complete", status="success", duration_ms=5.0,
            timestamp=datetime.now(timezone.utc) - timedelta(seconds=6000),
        )
    )
    client = TestClient(app)
    assert client.get("/api/v1/dev/performance/waterfall/req-old").status_code == 200


def test_existing_endpoints_unchanged(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    client = TestClient(app)
    for endpoint in ["recent", "slow", "errors", "summary"]:
        assert client.get(f"/api/v1/dev/performance/{endpoint}").status_code == 200
