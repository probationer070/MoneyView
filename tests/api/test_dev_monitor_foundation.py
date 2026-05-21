import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.core.dev_monitor import (
    emit_performance_event,
    get_dev_monitor_log_path,
    get_dev_monitor_retention_days,
    get_dev_monitor_sink,
    is_dev_monitor_enabled,
    perf_timer,
    reset_dev_monitor_sink,
    reset_current_request_id,
    set_current_request_id,
)
from apps.api.main import app
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.models.schemas import StockOHLCV
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_performance_event_normalizes_fields():
    event = PerformanceEvent(
        level="info",
        scope="api",
        operation="api.request_complete",
        status="success",
        ticker=" aapl ",
        method=" get ",
        request_id=" req-123 ",
        metadata={"rows": 3},
    )

    assert event.ticker == "AAPL"
    assert event.method == "GET"
    assert event.request_id == "req-123"
    assert isinstance(event.timestamp, datetime)
    assert event.timestamp.tzinfo is not None
    assert event.metadata == {"rows": 3}


def test_feature_flag_requires_literal_true(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR", raising=False)
    assert is_dev_monitor_enabled() is False

    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "TRUE")
    assert is_dev_monitor_enabled() is True

    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "1")
    assert is_dev_monitor_enabled() is False


def test_default_log_path_rotates_daily_under_performance_directory(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", raising=False)
    log_path = get_dev_monitor_log_path()

    assert log_path.parent.as_posix().endswith("data/cache/logs/performance")
    assert log_path.name == f"{datetime.utcnow().date().isoformat()}.jsonl"


def test_configured_log_directory_rotates_and_retention_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(tmp_path))
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR_RETENTION_DAYS", raising=False)

    log_path = get_dev_monitor_log_path()

    assert log_path.parent == tmp_path
    assert log_path.name == f"{datetime.utcnow().date().isoformat()}.jsonl"
    assert get_dev_monitor_retention_days() == 7


def test_dev_monitor_sink_noops_when_disabled(monkeypatch, tmp_path):
    log_path = tmp_path / "disabled.jsonl"
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR", raising=False)
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    event = PerformanceEvent(
        level="info",
        scope="system",
        operation="system.disabled_test",
        status="success",
    )
    emit_performance_event(event)

    sink = get_dev_monitor_sink()
    assert sink.recent() == []
    assert not log_path.exists()


def test_dev_monitor_sink_writes_jsonl_and_recent_events_when_enabled(monkeypatch, tmp_path):
    log_path = tmp_path / "enabled.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    event = PerformanceEvent(
        level="info",
        scope="cache",
        operation="cache.lookup",
        status="cache_hit",
        metadata={"rows": 1, "authorization": "blocked"},
    )
    stored_event = emit_performance_event(event)

    recent = get_dev_monitor_sink().recent()
    lines = _read_jsonl(log_path)

    assert len(recent) == 1
    assert recent[0].id == stored_event.id
    assert recent[0].metadata == {"rows": 1}
    assert len(lines) == 1
    assert lines[0]["operation"] == "cache.lookup"
    assert lines[0]["metadata"] == {"rows": 1}


def test_dev_monitor_sink_prunes_old_daily_logs(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(tmp_path))
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_RETENTION_DAYS", "3")
    reset_dev_monitor_sink()

    today = datetime.utcnow().date()
    recent_file = tmp_path / f"{today.isoformat()}.jsonl"
    keep_file = tmp_path / f"{(today - timedelta(days=2)).isoformat()}.jsonl"
    old_file = tmp_path / f"{(today - timedelta(days=5)).isoformat()}.jsonl"
    tmp_path.mkdir(parents=True, exist_ok=True)
    recent_file.write_text("", encoding="utf-8")
    keep_file.write_text("", encoding="utf-8")
    old_file.write_text("", encoding="utf-8")

    emit_performance_event(
        PerformanceEvent(
            level="info",
            scope="system",
            operation="system.rotation_test",
            status="success",
        )
    )

    assert recent_file.exists()
    assert keep_file.exists()
    assert not old_file.exists()


def test_perf_timer_classifies_slow_and_error(monkeypatch, tmp_path):
    log_path = tmp_path / "timer.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    with perf_timer(scope="db", operation="db.select_watchlist", slow_threshold_ms=0.0, metadata={"rows": 2}):
        pass

    try:
        with perf_timer(scope="external", operation="external.fetch_quote", slow_threshold_ms=1000.0):
            raise RuntimeError("boom")
    except RuntimeError:
        pass

    lines = _read_jsonl(log_path)

    assert len(lines) == 2
    assert lines[0]["status"] == "slow"
    assert lines[0]["duration_ms"] is not None
    assert lines[1]["status"] == "error"
    assert lines[1]["level"] == "error"
    assert lines[1]["metadata"]["exception_type"] == "RuntimeError"


def test_request_middleware_emits_monitor_events_with_existing_request_id(monkeypatch, tmp_path):
    log_path = tmp_path / "middleware.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    client = TestClient(app)
    response = client.get("/api/v1/health", headers={"X-Request-ID": "dev-monitor-request"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "dev-monitor-request"

    lines = _read_jsonl(log_path)
    operations = [line["operation"] for line in lines]

    assert "api.request_start" in operations
    assert "api.request_complete" in operations
    assert all(line["request_id"] == "dev-monitor-request" for line in lines)
    complete_event = next(line for line in lines if line["operation"] == "api.request_complete")
    assert complete_event["route"] == "/api/v1/health"
    assert complete_event["method"] == "GET"


def test_db_instrumentation_emits_select_and_write_events(monkeypatch, tmp_path):
    log_path = tmp_path / "db-events.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    request_token = set_current_request_id("db-request-1")
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO portfolio_preferences
                   (singleton_id, total_investment_amount, transaction_fee_rate, updated_at)
                   VALUES (1, ?, ?, CURRENT_TIMESTAMP)""",
                (12345.0, 0.002),
            )
            row = conn.execute(
                """SELECT total_investment_amount
                   FROM portfolio_preferences
                   WHERE singleton_id = 1"""
            ).fetchone()
    finally:
        reset_current_request_id(request_token)

    assert row is not None
    lines = _read_jsonl(log_path)
    insert_event = next(line for line in lines if line["table"] == "portfolio_preferences" and line["metadata"]["operation_type"] in {"insert", "replace"})
    select_event = next(line for line in lines if line["operation"] == "db.select_portfolio_preferences")

    assert insert_event["request_id"] == "db-request-1"
    assert insert_event["metadata"]["rows"] >= 1
    assert select_event["request_id"] == "db-request-1"
    assert select_event["metadata"]["rows"] == 1
    assert select_event["status"] in {"success", "slow"}


def test_request_path_db_events_reuse_existing_request_id(monkeypatch, tmp_path):
    log_path = tmp_path / "db-request-events.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    client = TestClient(app)
    response = client.get("/api/v1/portfolio/preferences", headers={"X-Request-ID": "portfolio-pref-request"})

    assert response.status_code == 200
    lines = _read_jsonl(log_path)
    db_events = [line for line in lines if line["scope"] == "db" and line["table"] == "portfolio_preferences"]

    assert db_events
    assert all(event["request_id"] == "portfolio-pref-request" for event in db_events)


def test_page_load_group_events_emit_for_portfolio_routes(monkeypatch, tmp_path):
    log_path = tmp_path / "page-load.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    client = TestClient(app)
    response = client.get("/api/v1/portfolio/preferences", headers={"X-Request-ID": "page-load-request"})

    assert response.status_code == 200
    lines = _read_jsonl(log_path)
    page_events = [line for line in lines if line["scope"] == "page_load" and line["component"] == "portfolio"]
    assert any(event["status"] == "start" for event in page_events)
    assert any(event["status"] in {"success", "slow"} for event in page_events)


def test_market_data_emits_cache_and_provider_events(monkeypatch, tmp_path):
    log_path = tmp_path / "market-data-events.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()
    MarketDataService._provider_fetch_cache.clear()

    service = MarketDataService()
    monkeypatch.setattr(
        service,
        "_fetch_live_ohlcv",
        lambda ticker, period="1mo": [
            StockOHLCV(date="2026-05-01", open=100.0, high=101.0, low=99.0, close=100.5, volume=1000)
        ],
    )
    bars, quality = service._get_stock_ohlcv_with_metadata("AAPL", period="1mo", table="stocks")

    assert bars
    assert quality.source in {"live_fetch", "live_refresh"}
    lines = _read_jsonl(log_path)
    operations = {(line["scope"], line["operation"], line["status"]) for line in lines}
    assert ("cache", "cache.lookup", "success") in operations
    assert ("cache", "cache.miss", "cache_miss") in operations
    assert ("cache", "cache.write", "success") in operations
    assert ("external", "external.fetch_history", "success") in operations or ("external", "external.fetch_history", "slow") in operations


def test_metric_audit_emits_data_quality_and_metric_events(monkeypatch, tmp_path):
    log_path = tmp_path / "metric-audit-events.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    from apps.api.services.corporate_statement_metrics import metric_audit_for_ticker
    from apps.api.models.schemas import CorporateMetrics

    fallback = CorporateMetrics(
        ticker="AAPL",
        growth=6.0,
        roic=18.0,
        wacc=10.0,
        debt_ratio=18.0,
        unlevered_beta=1.05,
        crp=0.8,
        reinvestment=34.0,
        fcff=92.0,
        innovation=82.0,
        market_share=64.0,
        governance=74.0,
        esg_penalty=22.0,
        growth_avg_legacy=5.0,
        growth_cagr_v2=6.0,
        roic_legacy=17.0,
        roic_stable_v2=18.0,
    )

    audit = metric_audit_for_ticker("AAPL", fallback, has_saved_metrics=False, bundle_loader=lambda ticker, endpoint: None)

    assert audit.source_mode == "default_model"
    lines = _read_jsonl(log_path)
    assert any(line["scope"] == "metric" and line["operation"] == "metric.metric_audit" for line in lines)
    assert any(line["scope"] == "data_quality" and line["operation"] == "data_quality.roic" for line in lines)
    assert any(line["scope"] == "data_quality" and line["operation"] == "data_quality.wacc" for line in lines)


def test_monte_carlo_emits_backend_and_risk_metric_events(monkeypatch, tmp_path):
    log_path = tmp_path / "monte-carlo-events.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    client = TestClient(app)
    response = client.post(
        "/api/v1/monte-carlo/analyze",
        json={"ticker": "AAPL", "path_count": 120, "steps_per_year": 24, "horizon_years": 1, "seed": 7},
        headers={"X-Request-ID": "monte-carlo-request"},
    )

    assert response.status_code == 200
    lines = _read_jsonl(log_path)
    assert any(line["scope"] == "calculation" and line["operation"] == "calculation.monte_carlo_backend" for line in lines)
    assert any(line["scope"] == "metric" and line["operation"] == "metric.volatility_var_cvar" for line in lines)


def test_dev_endpoints_return_404_when_monitor_disabled(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR", raising=False)
    reset_dev_monitor_sink()

    client = TestClient(app)
    for path in (
        "/api/v1/dev/log-stream",
        "/api/v1/dev/performance/recent",
        "/api/v1/dev/performance/slow",
        "/api/v1/dev/performance/errors",
        "/api/v1/dev/performance/summary",
    ):
        response = client.get(path)
        assert response.status_code == 404

    post_response = client.post(
        "/api/v1/dev/performance/client-event",
        json={"scope": "chart", "operation": "chart.render", "status": "success"},
    )
    assert post_response.status_code == 404


def test_dev_endpoints_return_data_when_monitor_enabled(monkeypatch, tmp_path):
    log_path = tmp_path / "dev-api-events.jsonl"
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(log_path))
    reset_dev_monitor_sink()

    client = TestClient(app)
    health_response = client.get("/api/v1/health", headers={"X-Request-ID": "dev-api-request"})
    assert health_response.status_code == 200

    client_event_response = client.post(
        "/api/v1/dev/performance/client-event",
        json={
            "scope": "chart",
            "operation": "chart.render",
            "status": "success",
            "duration_ms": 12.3,
            "component": "diagnostic_radar",
            "metadata": {"series_count": 4},
        },
        headers={"X-Request-ID": "dev-api-request"},
    )
    assert client_event_response.status_code == 200
    client_event = client_event_response.json()["data"]
    assert client_event["scope"] == "chart"
    assert client_event["operation"] == "chart.render"

    recent_response = client.get("/api/v1/dev/performance/recent?limit=10", headers={"X-Request-ID": "dev-api-request"})
    slow_response = client.get("/api/v1/dev/performance/slow?limit=10", headers={"X-Request-ID": "dev-api-request"})
    errors_response = client.get("/api/v1/dev/performance/errors?limit=10", headers={"X-Request-ID": "dev-api-request"})
    summary_response = client.get("/api/v1/dev/performance/summary", headers={"X-Request-ID": "dev-api-request"})
    assert recent_response.status_code == 200
    recent_payload = recent_response.json()["data"]
    assert recent_payload["limit"] == 10
    assert any(event["operation"] == "chart.render" for event in recent_payload["events"])

    assert slow_response.status_code == 200
    assert "events" in slow_response.json()["data"]

    assert errors_response.status_code == 200
    assert "events" in errors_response.json()["data"]

    assert summary_response.status_code == 200
    summary_payload = summary_response.json()["data"]
    assert "active_requests" in summary_payload
    assert "cache_hit_rate" in summary_payload

    with client.stream("GET", "/api/v1/dev/log-stream?once=true", headers={"X-Request-ID": "dev-api-request"}) as stream_response:
        assert stream_response.status_code == 200
        assert stream_response.headers["content-type"].startswith("text/event-stream")
