import sys
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import CorporateMetrics
from apps.api.services import db as db_service
from apps.api.services.corporate_comparison import build_corporate_comparison_response


def _seed_watchlist() -> None:
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "core", 0.4),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("MSFT", "Microsoft", "Technology", "core", 0.2),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("GOOGL", "Alphabet", "Communication Services", "watch", 0.0),
        )


def _patch_comparison_sources(monkeypatch):
    from apps.api.routes import corporate as corporate_route

    def fake_metrics(ticker: str, **_: object) -> CorporateMetrics:
        base = {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "GOOGL": CorporateMetrics(ticker="GOOGL", growth=8, roic=20, wacc=9.5, debt_ratio=8, unlevered_beta=1.0, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "NVDA": CorporateMetrics(ticker="NVDA", growth=16, roic=32, wacc=12, debt_ratio=10, unlevered_beta=1.55, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "TSLA": CorporateMetrics(ticker="TSLA", growth=12, roic=13, wacc=13, debt_ratio=22, unlevered_beta=1.7, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
            "^IXIC": CorporateMetrics(ticker="^IXIC", growth=6, roic=11, wacc=8.5, debt_ratio=0, unlevered_beta=1.05, crp=0.0, reinvestment=20, fcff=92, innovation=45, market_share=100, governance=70, esg_penalty=10),
        }
        return base[ticker]

    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", fake_metrics)
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 100.0 if ticker else 0.0)


def test_corporate_comparison_defaults_to_portfolio_plus_benchmark_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    # Reads never write (Task 8): a snapshot must be created explicitly before a
    # snapshot-mode read has anything to return.
    from apps.api.services import corporate_comparison as comparison_service

    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **_: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["market_expected_return"] == 9.7
    assert payload["risk_free_rate"] == 4.2
    assert payload["equity_risk_premium"] == 5.5
    assert payload["stock_expected_return_method"] == "dcf_implied_upside"
    assert payload["comparison_reference_return_method"] == "capm_beta_reference"
    assert payload["snapshot"]["mode"] == "snapshot"
    assert payload["snapshot"]["snapshot_source"] == "scheduled_kst_daily"
    assert payload["snapshot"]["snapshot_versions_for_day"] == 1
    assert payload["snapshot"]["snapshot_available"] is True
    assert payload["snapshot"]["snapshot_cadence"] == "daily_kst_0000"
    assert payload["snapshot"]["snapshot_retention_days"] == 365
    assert payload["snapshot"]["comparison_universe"] == "portfolio_plus_benchmark"
    assert payload["snapshot"]["benchmark_ticker"] == "^GSPC"
    assert payload["snapshot"]["custom_tickers"] == []
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT"]

    benchmark = payload["rows"][0]
    assert benchmark["group_name"] == "benchmark"
    assert benchmark["weight"] == 0.0

    aapl = next(row for row in payload["rows"] if row["ticker"] == "AAPL")
    assert aapl["weight"] == 0.4
    assert aapl["roic_minus_wacc"] == 8.0
    assert aapl["market_expected_return"] == 9.7
    assert aapl["stock_expected_return_source"] == "dcf_implied_upside"
    assert aapl["dcf_value"] > 0
    assert aapl["dcf_implied_return"] == aapl["stock_expected_return"]
    assert aapl["capm_expected_return"] > 0
    assert aapl["stock_expected_return"] == pytest.approx(
        aapl["expected_return_spread"] + aapl["market_expected_return"],
        abs=1e-6,
    )

    with db_service.get_db() as conn:
        snapshot_rows = conn.execute(
            """SELECT snapshot_source, comparison_universe, benchmark_ticker, ticker
               FROM corporate_comparison_snapshots_v3
               ORDER BY ticker"""
        ).fetchall()
    assert set((row["snapshot_source"], row["comparison_universe"], row["benchmark_ticker"], row["ticker"]) for row in snapshot_rows) == {
        ("scheduled_kst_daily", "portfolio_plus_benchmark", "^GSPC", "^GSPC"),
        ("scheduled_kst_daily", "portfolio_plus_benchmark", "^GSPC", "AAPL"),
        ("scheduled_kst_daily", "portfolio_plus_benchmark", "^GSPC", "MSFT"),
    }


def test_corporate_comparison_watchlist_plus_benchmark_includes_zero_weight_watchlist_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    client = TestClient(app)
    # Reads never write (Task 8): a snapshot must be created explicitly before a
    # snapshot-mode read has anything to return.
    refresh = client.post("/api/v1/corporate/comparison/snapshot?comparison_universe=watchlist_plus_benchmark")
    assert refresh.status_code == 200

    response = client.get("/api/v1/corporate/comparison?comparison_universe=watchlist_plus_benchmark")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["comparison_universe"] == "watchlist_plus_benchmark"
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT", "GOOGL"]
    googl = next(row for row in payload["rows"] if row["ticker"] == "GOOGL")
    assert googl["weight"] == 0.0


def test_corporate_comparison_custom_universe_persists_snapshot_metadata(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    client = TestClient(app)
    response = client.post(
        "/api/v1/corporate/comparison/snapshot"
        "?comparison_universe=custom&benchmark_ticker=%5EIXIC&custom_tickers=NVDA,TSLA"
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["mode"] == "snapshot"
    assert payload["snapshot"]["snapshot_source"] == "manual_refresh"
    assert payload["snapshot"]["comparison_universe"] == "custom"
    assert payload["snapshot"]["benchmark_ticker"] == "^IXIC"
    assert payload["snapshot"]["custom_tickers"] == ["NVDA", "TSLA"]
    assert [row["ticker"] for row in payload["rows"]] == ["^IXIC", "NVDA", "TSLA"]

    with db_service.get_db() as conn:
        snapshot_rows = conn.execute(
            """SELECT DISTINCT comparison_universe, benchmark_ticker, custom_tickers
               FROM corporate_comparison_snapshots_v3"""
        ).fetchall()
    assert len(snapshot_rows) == 1
    row = snapshot_rows[0]
    assert row["comparison_universe"] == "custom"
    assert row["benchmark_ticker"] == "^IXIC"
    assert row["custom_tickers"] == "NVDA,TSLA"


def test_corporate_comparison_live_mode_returns_live_rows_without_overwriting_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    client = TestClient(app)
    refresh = client.post("/api/v1/corporate/comparison/snapshot")
    assert refresh.status_code == 200

    response = client.get("/api/v1/corporate/comparison?mode=live")
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["mode"] == "live"
    assert payload["snapshot"]["snapshot_available"] is True
    assert payload["snapshot"]["snapshot_source"] == "manual_refresh"
    assert payload["snapshot"]["comparison_universe"] == "portfolio_plus_benchmark"
    assert payload["snapshot"]["snapshot_versions_for_day"] == 1
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT"]


def test_corporate_comparison_history_returns_timeline_points(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 9, 15, 1, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison/history?comparison_universe=portfolio_plus_benchmark&limit=10")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["comparison_universe"] == "portfolio_plus_benchmark"
    assert payload["benchmark_ticker"] == "^GSPC"
    assert len(payload["points"]) == 2
    assert payload["points"][0]["as_of_date"] == "2026-04-11"
    assert payload["points"][0]["snapshot_source"] == "manual_refresh"
    assert payload["points"][0]["snapshot_versions_for_day"] == 1
    assert payload["points"][0]["stock_count"] == 2
    assert payload["points"][0]["market_expected_return"] == 9.7


def test_corporate_comparison_snapshot_version_returns_selected_saved_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 9, 15, 1, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    first = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/corporate/comparison/snapshot-version?snapshot_version={first.snapshot.snapshot_version}")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["snapshot_version"] == first.snapshot.snapshot_version
    assert payload["snapshot"]["as_of_date"] == "2026-04-10"
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT"]


def test_corporate_comparison_snapshot_version_can_be_deleted(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    saved = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.delete(
        f"/api/v1/corporate/comparison/snapshot-version?snapshot_version={saved.snapshot.snapshot_version}"
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot_version"] == saved.snapshot.snapshot_version
    assert payload["deleted_rows"] == 3

    with db_service.get_db() as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) AS count FROM corporate_comparison_snapshots_v3"
        ).fetchone()
    assert remaining["count"] == 0


def test_corporate_comparison_stock_history_returns_saved_metric_timeline(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 9, 15, 1, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison/stock-history?ticker=AAPL&comparison_universe=portfolio_plus_benchmark&limit=10")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["ticker"] == "AAPL"
    assert len(payload["points"]) == 2
    assert payload["points"][0]["as_of_date"] == "2026-04-11"
    assert payload["points"][0]["snapshot_source"] == "manual_refresh"
    assert payload["points"][0]["roic_minus_wacc"] == 8.0


def test_corporate_bulk_dcf_reports_returns_full_reports_for_requested_tickers(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.routes import corporate as corporate_route

    def fake_full_report(
        ticker: str,
        params,
        *,
        current_price_loader,
        metrics_loader,
        risk_free_rate,
        equity_risk_premium,
        country_risk_premium,
    ):
        metrics = metrics_loader(ticker)
        current_price = current_price_loader(ticker)
        assumptions = params
        report_id = f"bulk-{ticker.lower()}"
        return {
            "summary": {
                "report_id": report_id,
                "ticker": ticker,
                "estimated_value": current_price + 25.0,
                "intrinsic_value_per_share": current_price + 25.0,
                "enterprise_value": 1462.4,
                "equity_value": 1250.0,
                "valuation_method": "intrinsic_equity_per_share",
                "bridge_quality": "ok",
                "current_price": current_price,
                "upside_pct": 25.0,
                "status": "Undervalued",
                "generated_at": "2026-04-11T12:00:00Z",
            },
            "assumptions": {
                "report_id": report_id,
                "ticker": ticker,
                "generated_at": "2026-04-11T12:00:00Z",
                "wacc_used": assumptions.wacc,
                "margin_used": 0.18,
                "growth_used": assumptions.revenue_growth_rate,
                "fcff_used": assumptions.fcff,
                "esg_penalty_used": assumptions.esg_penalty,
                "terminal_growth_used": assumptions.terminal_growth_rate,
                "enterprise_value_index": 250.0,
            },
            "projection_rows": [
                {"year": 1, "projected_fcff": 97.5, "discount_factor": 1.1, "present_value": 88.6},
            ],
            "wacc_breakdown": {
                "risk_free_rate": risk_free_rate,
                "unlevered_beta": metrics.unlevered_beta,
                "debt_ratio": metrics.debt_ratio,
                "tax_rate": 0.25,
                "equity_risk_premium": equity_risk_premium,
                "country_risk_premium": country_risk_premium,
            },
            "terminal_cash_flow": 133.2,
            "terminal_value": 1665.0,
            "present_value_of_terminal": 1034.1,
            "present_value_of_fcff": 428.3,
            "enterprise_value": 1462.4,
            "equity_value": 1250.0,
            "intrinsic_value_per_share": 125.0,
            "net_debt": 250.0,
            "non_operating_assets": 37.6,
            "diluted_shares_outstanding": 10.0,
            "valuation_method": "intrinsic_equity_per_share",
            "bridge_quality": "ok",
            "agency_discount": 0.945,
            "dcf_multiple": 15.9,
            "baseline_multiple": 12.5,
            "fcff_scale": 1.0,
        }

    monkeypatch.setattr(corporate_route, "build_dcf_full_report", fake_full_report)

    client = TestClient(app)
    response = client.post("/api/v1/corporate/dcf/reports/bulk", json={"tickers": ["AAPL", "MSFT"]})

    assert response.status_code == 200
    payload = response.json()["data"]
    assert [report["summary"]["ticker"] for report in payload] == ["AAPL", "MSFT"]
    assert payload[0]["summary"]["report_id"] == "bulk-aapl"
    assert payload[1]["summary"]["report_id"] == "bulk-msft"
    assert payload[0]["summary"]["estimated_value"] == 125.0


def test_corporate_comparison_snapshot_uses_kst_business_date_and_365_day_retention(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 11, 14, 59, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 11, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    first = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    assert first.snapshot.as_of_date == "2026-04-11"
    assert first.snapshot.snapshot_retention_days == 365
    assert first.snapshot.snapshot_cadence == "daily_kst_0000"
    assert first.snapshot.snapshot_versions_for_day == 1

    with db_service.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_comparison_snapshots_v3
               (snapshot_version, snapshot_date, universe_key, comparison_universe, benchmark_ticker,
                custom_tickers, snapshot_taken_at, snapshot_source, risk_free_rate, equity_risk_premium,
                stock_expected_return_method, ticker, name, sector, group_name, weight, roic, wacc,
                roic_minus_wacc, dcf_value, current_price, dcf_implied_return, capm_expected_return,
                stock_expected_return, market_expected_return, expected_return_spread,
                stock_expected_return_source, has_price_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "2025-04-11|portfolio_plus_benchmark|^GSPC||2026-04-11T14:59:00+00:00",
                "2025-04-11",
                "portfolio_plus_benchmark|^GSPC|",
                "portfolio_plus_benchmark",
                "^GSPC",
                "",
                first_now.isoformat(),
                "scheduled_kst_daily",
                4.2,
                5.5,
                "dcf_implied_upside",
                "OLD",
                "Old",
                "Legacy",
                "legacy",
                0.0,
                1.0,
                1.0,
                0.0,
                1.0,
                1.0,
                0.0,
                0.0,
                9.7,
                9.7,
                -9.7,
                "dcf_implied_upside",
                1,
            ),
        )

    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    second = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    assert second.snapshot.as_of_date == "2026-04-12"
    assert second.snapshot.snapshot_versions_for_day == 1

    with db_service.get_db() as conn:
        remaining_dates = [
            row["snapshot_date"]
            for row in conn.execute(
                "SELECT DISTINCT snapshot_date FROM corporate_comparison_snapshots_v3 ORDER BY snapshot_date"
            ).fetchall()
        ]
    assert "2025-04-11" not in remaining_dates
    assert "2026-04-11" in remaining_dates
    assert "2026-04-12" in remaining_dates


def test_manual_refresh_keeps_multiple_intraday_versions_for_same_kst_day(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 11, 0, 30, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 11, 1, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    first = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    second = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert first.snapshot.as_of_date == second.snapshot.as_of_date == "2026-04-11"
    assert first.snapshot.snapshot_versions_for_day == 1
    assert second.snapshot.snapshot_versions_for_day == 2
    assert first.snapshot.snapshot_version != second.snapshot.snapshot_version

    with db_service.get_db() as conn:
        version_count = conn.execute(
            """SELECT COUNT(DISTINCT snapshot_version) AS version_count
               FROM corporate_comparison_snapshots_v3
               WHERE snapshot_date = ? AND universe_key = ?""",
            ("2026-04-11", "portfolio_plus_benchmark|^GSPC|"),
        ).fetchone()
    assert int(version_count["version_count"]) == 2


@pytest.mark.virgin_db
def test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)

    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE corporate_comparison_snapshots (
                snapshot_date TEXT NOT NULL,
                snapshot_taken_at TEXT NOT NULL,
                snapshot_source TEXT DEFAULT 'auto_daily',
                risk_free_rate REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom',
                weight REAL DEFAULT 0.0,
                roic REAL NOT NULL DEFAULT 0.0,
                wacc REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc REAL NOT NULL DEFAULT 0.0,
                dcf_value REAL NOT NULL DEFAULT 0.0,
                current_price REAL NOT NULL DEFAULT 0.0,
                stock_expected_return REAL NOT NULL DEFAULT 0.0,
                market_expected_return REAL NOT NULL DEFAULT 0.0,
                expected_return_spread REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_date, ticker)
            );

            CREATE TABLE corporate_comparison_snapshots_v2 (
                snapshot_date TEXT NOT NULL,
                universe_key TEXT NOT NULL,
                snapshot_taken_at TEXT NOT NULL,
                snapshot_source TEXT DEFAULT 'auto_daily',
                risk_free_rate REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom',
                weight REAL DEFAULT 0.0,
                roic REAL NOT NULL DEFAULT 0.0,
                wacc REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc REAL NOT NULL DEFAULT 0.0,
                dcf_value REAL NOT NULL DEFAULT 0.0,
                current_price REAL NOT NULL DEFAULT 0.0,
                stock_expected_return REAL NOT NULL DEFAULT 0.0,
                market_expected_return REAL NOT NULL DEFAULT 0.0,
                expected_return_spread REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_date, universe_key, ticker)
            );

            CREATE TABLE corporate_comparison_snapshots_v3 (
                snapshot_version TEXT NOT NULL,
                snapshot_date TEXT NOT NULL,
                universe_key TEXT NOT NULL,
                snapshot_taken_at TEXT NOT NULL,
                snapshot_source TEXT DEFAULT 'auto_daily',
                risk_free_rate REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom',
                weight REAL DEFAULT 0.0,
                roic REAL NOT NULL DEFAULT 0.0,
                wacc REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc REAL NOT NULL DEFAULT 0.0,
                dcf_value REAL NOT NULL DEFAULT 0.0,
                current_price REAL NOT NULL DEFAULT 0.0,
                dcf_implied_return REAL NOT NULL DEFAULT 0.0,
                capm_expected_return REAL NOT NULL DEFAULT 0.0,
                stock_expected_return REAL NOT NULL DEFAULT 0.0,
                market_expected_return REAL NOT NULL DEFAULT 0.0,
                expected_return_spread REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_version, ticker)
            );
            """
        )

    db_service.init_db()

    with db_service.get_db() as conn:
        legacy_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots)")}
        v2_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v2)")}
        v3_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v3)")}
        v3_indexes = {row["name"] for row in conn.execute("PRAGMA index_list(corporate_comparison_snapshots_v3)")}

    assert "comparison_universe" in legacy_columns
    assert {"universe_key", "comparison_universe", "benchmark_ticker", "custom_tickers"}.issubset(v2_columns)
    assert {"universe_key", "comparison_universe", "benchmark_ticker", "custom_tickers"}.issubset(v3_columns)
    assert {
        "idx_corporate_comparison_snapshots_v3_universe_date",
        "idx_corporate_comparison_snapshots_v3_ticker_universe_date",
    }.issubset(v3_indexes)


def test_reading_a_comparison_never_writes_a_snapshot():
    """The deleted fallback: a read used to compute and persist a snapshot when today's
    was missing -- a multi-minute sweep inside a request the user never asked for."""
    with db_service.get_db() as conn:
        before = conn.execute("SELECT COUNT(*) AS n FROM corporate_comparison_snapshots_v3").fetchone()["n"]

    build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        after = conn.execute("SELECT COUNT(*) AS n FROM corporate_comparison_snapshots_v3").fetchone()["n"]
    assert after == before


def test_reading_with_no_snapshot_returns_an_empty_state():
    response = build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert response.rows == []
    assert response.snapshot.snapshot_available is False


def test_the_lifespan_starts_no_snapshot_cycle():
    import apps.api.main as api_main

    assert not hasattr(api_main, "corporate_snapshot_cycle")


def test_a_snapshot_from_an_earlier_date_is_returned_and_is_not_marked_stale():
    """Manual-only snapshots have no cadence to be late for. Under the old daily cadence a
    snapshot not taken today meant a missed refresh; now it means the user last asked then,
    which is exactly what a snapshot is for."""
    from apps.api.services import corporate_comparison as comparison_service

    # Build one via save_corporate_comparison_snapshot, then age it by moving its
    # snapshot_date to an earlier day directly in SQLite -- the same seeding style the
    # other snapshot tests in this file already use.
    saved = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: CorporateMetrics(
            ticker=ticker, growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0,
            crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100,
            governance=70, esg_penalty=10,
        ),
        price_loader=lambda _ticker: 100.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        conn.execute(
            "UPDATE corporate_comparison_snapshots_v3 SET snapshot_date = ? WHERE snapshot_version = ?",
            ("2020-01-01", saved.snapshot.snapshot_version),
        )

    response = build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert response.rows != []
    assert response.snapshot.snapshot_is_stale is False
