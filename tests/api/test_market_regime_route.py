"""GET /api/v1/market/regime: the Market Overview header's regime line (market one-screen plan, Task 2).

Every test stubs get_stock_ohlcv on the route's own service instance, so no test reads a real
database or the network. tests/conftest.py also isolates the database and blocks sockets.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import StockOHLCV
from apps.api.routes import market as market_routes
from apps.api.services.market_data import EQUITY_INDEX_TICKERS, MARKET_INDICES

URL = "/api/v1/market/regime"
FIELDS = {
    "regime_label": str,
    "regime_summary": str,
    "equity_advancers": int,
    "equity_decliners": int,
    "breadth_ratio": (float, type(None)),
    "equity_index_count": int,
    "risk_on_signals": int,
    "risk_off_signals": int,
    "signal_count": int,
}
LABELS = {"risk_on", "mixed", "risk_off", "unknown"}

# The deltas of test_market_index_detail.py's builder test: risk_on, 3 of 4 equity indices up, 5 signals on.
RISK_ON = {"^GSPC": 0.8, "^DJI": -0.2, "^IXIC": 1.1, "^KS200": 0.4, "GC=F": -0.5, "CL=F": 0.3, "NG=F": -0.1, "KRW=X": -0.3, "BTC-USD": 2.0}


def _two_closes(delta_pct: float) -> list[StockOHLCV]:
    latest = date(2026, 4, 11)
    prev, last = 100.0, 100.0 * (1 + delta_pct / 100)
    return [
        StockOHLCV(date=(latest - timedelta(days=1)).isoformat(), open=prev, high=prev, low=prev, close=prev, volume=1),
        StockOHLCV(date=latest.isoformat(), open=prev, high=last, low=prev, close=last, volume=1),
    ]


def _stub_bars(monkeypatch, deltas: dict[str, float]) -> list[tuple[str, str, str]]:
    """Answers get_stock_ohlcv on the route's service from `deltas`; any other ticker gets no bars."""
    requested: list[tuple[str, str, str]] = []

    def fake(ticker, period="5y", table="stocks", refresh="inline"):
        requested.append((ticker, period, table))
        return _two_closes(deltas[ticker]) if ticker in deltas else []

    monkeypatch.setattr(market_routes._svc, "get_stock_ohlcv", fake)
    return requested


def test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch):
    requested = _stub_bars(monkeypatch, RISK_ON)

    response = TestClient(app).get(URL)

    assert response.status_code == 200, f"status {response.status_code}: {response.text}"
    body = response.json()
    assert set(body) == set(FIELDS), f"fields {sorted(body)}"
    for name, kind in FIELDS.items():
        assert isinstance(body[name], kind), f"{name} is {body[name]!r}"
    assert body["regime_label"] in LABELS, f"regime_label {body['regime_label']!r}"
    assert (body["regime_label"], body["equity_advancers"], body["equity_decliners"], body["equity_index_count"]) == ("risk_on", 3, 1, 4), body
    assert (body["risk_on_signals"], body["risk_off_signals"], body["signal_count"], body["breadth_ratio"]) == (5, 0, 5, 0.75), body
    # The side effect the contract names: one 1mo read of the indices table per registered instrument.
    assert sorted(requested) == sorted((ticker, "1mo", "indices") for ticker in MARKET_INDICES.values()), requested


def test_no_bars_is_an_unknown_regime_with_200_not_an_error(monkeypatch):
    _stub_bars(monkeypatch, {})

    response = TestClient(app).get(URL)

    assert response.status_code == 200, f"status {response.status_code}: {response.text}"
    body = response.json()
    assert body["regime_label"] == "unknown", f"regime_label {body['regime_label']!r}"
    assert (body["equity_index_count"], body["signal_count"], body["breadth_ratio"]) == (0, 0, None), body


def test_vix_bars_are_not_counted_as_an_equity_index(monkeypatch):
    # The precondition that makes the case meaningful: VIX is fetched with the indices but is not an equity index.
    assert "^VIX" in MARKET_INDICES.values() and "^VIX" not in EQUITY_INDEX_TICKERS
    _stub_bars(monkeypatch, {"^VIX": 5.0, "^GSPC": 0.8})

    body = TestClient(app).get(URL).json()

    assert body["equity_index_count"] == 1, f"equity_index_count {body['equity_index_count']}: ^VIX was counted"
    assert (body["equity_advancers"], body["equity_decliners"]) == (1, 0), body
