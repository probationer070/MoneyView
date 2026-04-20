import logging
import os
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.core import logger as logger_module
from apps.api.main import app


def _log_path() -> Path:
    temp_root = Path(r"E:\MoneyView\data\processed")
    temp_root.mkdir(parents=True, exist_ok=True)
    return temp_root / f"test-transport-progress-{next(tempfile._get_candidate_names())}.log"


def _reconfigure_logging_to_file(log_path: Path) -> None:
    root_logger = logging.getLogger()
    setattr(root_logger, logger_module._CONFIGURED_SENTINEL, False)
    for handler in list(root_logger.handlers):
        handler.close()
        root_logger.removeHandler(handler)
    os.environ["API_LOG_PATH"] = str(log_path)
    logger_module._DEFAULT_LOG_PATH = log_path
    logger_module.configure_logging()


def test_stock_price_route_emits_known_size_transport_progress(monkeypatch):
    log_path = _log_path()
    _reconfigure_logging_to_file(log_path)

    from apps.api.routes import stock as stock_route

    monkeypatch.setattr(
        stock_route,
        "_mkt",
        type(
            "StubMarketDataService",
            (),
            {
                "get_stock_price_lookup": lambda self, ticker: stock_route.StockPriceLookup(
                    ticker=ticker.upper(),
                    status="ok",
                    price=123.45,
                    as_of_date="2026-04-19",
                    source="cache",
                    freshness_status="fresh_cache",
                    retry_after_seconds=None,
                    detail_note="Latest price served from local cache.",
                )
            },
        )(),
    )

    client = TestClient(app)
    response = client.get("/api/v1/stock/aapl/price", headers={"X-Request-ID": "transport-known-size"})

    assert response.status_code == 200
    log_text = log_path.read_text(encoding="utf-8")
    assert "transport.progress" in log_text
    assert "transport-known-size" in log_text
    assert '"progress_pct": 100.0' in log_text or '"progress_pct":100.0' in log_text
    assert '"completed": true' in log_text or '"completed":true' in log_text


def test_dcf_stream_route_emits_phase_and_stream_progress_logs(monkeypatch):
    log_path = _log_path()
    _reconfigure_logging_to_file(log_path)

    from apps.api.routes import corporate as corporate_route
    from tests.api.test_corporate_dcf_streaming import _mock_metrics, _valuation_payload

    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 210.4)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _mock_metrics)

    client = TestClient(app)
    response = client.post(
        "/api/v1/corporate/dcf/AAPL/stream",
        json=_valuation_payload(),
        headers={"X-Request-ID": "transport-stream"},
    )

    assert response.status_code == 200
    log_text = log_path.read_text(encoding="utf-8")
    assert "transport.phase" in log_text
    assert "transport-stream" in log_text
    assert '"phase": "phase1"' in log_text or '"phase":"phase1"' in log_text
    assert '"phase": "phase2"' in log_text or '"phase":"phase2"' in log_text
    assert '"phase": "complete"' in log_text or '"phase":"complete"' in log_text
    assert '"transport_kind": "sse"' in log_text or '"transport_kind":"sse"' in log_text


def test_api_log_tail_route_returns_recent_plain_text_lines():
    log_path = _log_path()
    _reconfigure_logging_to_file(log_path)
    log_path.write_text("first line\nsecond line\nthird line\n", encoding="utf-8")

    client = TestClient(app)
    response = client.get("/api/v1/diagnostic/logs/api-tail?lines=2")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["log_path"] == str(log_path)
    assert payload["line_count"] == 2
    assert payload["lines"] == ["second line", "third line"]
