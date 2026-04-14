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

    assert "comparison_universe" in legacy_columns
    assert {"universe_key", "comparison_universe", "benchmark_ticker", "custom_tickers"}.issubset(v2_columns)
    assert {"universe_key", "comparison_universe", "benchmark_ticker", "custom_tickers"}.issubset(v3_columns)
