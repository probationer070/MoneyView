"""Corporate metric orchestration helpers owned outside HTTP routes."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from apps.api.core.logger import setup_logger
from apps.api.models.schemas import (
    CorporateCompany,
    CorporateDerivedMetricMeta,
    CorporateMetrics,
    ValuationAssumptions,
)
from apps.api.services.corporate_statement_metrics import (
    DEFAULT_TAX_RATE,
    KOREA_COUNTRY_RISK_PREMIUM,
    YAHOO_STATEMENT_START_YEAR,
    get_yahoo_statement_bundle,
    quarterly_statement_rows,
    yahoo_metric_history,
    yahoo_statement_metrics,
)
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
from apps.api.services.watchlist_seed import ensure_watchlist_bootstrapped, load_watchlist_seed

logger = setup_logger(__name__)
_MKT = MarketDataService()
_API_ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_JSON = _API_ROOT / "services" / "webscrap" / "stock_targets.json"

StatementBundleLoader = Callable[[str, str], Optional[dict[str, object]]]

DEFAULT_METRICS = {
    "AAPL": {"growth": 6, "roic": 18, "wacc": 10, "debt_ratio": 18, "unlevered_beta": 1.05},
    "MSFT": {"growth": 7, "roic": 22, "wacc": 9, "debt_ratio": 15, "unlevered_beta": 0.95},
    "NVDA": {"growth": 16, "roic": 32, "wacc": 12, "debt_ratio": 10, "unlevered_beta": 1.55},
    "TSLA": {"growth": 12, "roic": 13, "wacc": 13, "debt_ratio": 22, "unlevered_beta": 1.7},
    "AMZN": {"growth": 9, "roic": 12, "wacc": 10.5, "debt_ratio": 24, "unlevered_beta": 1.15},
    "GOOGL": {"growth": 8, "roic": 20, "wacc": 9.5, "debt_ratio": 8, "unlevered_beta": 1.0},
    "META": {"growth": 10, "roic": 24, "wacc": 10.25, "debt_ratio": 12, "unlevered_beta": 1.2},
    "NFLX": {"growth": 8, "roic": 16, "wacc": 11, "debt_ratio": 26, "unlevered_beta": 1.25},
    "AMD": {"growth": 11, "roic": 11, "wacc": 12, "debt_ratio": 18, "unlevered_beta": 1.45},
    "AVGO": {"growth": 8, "roic": 21, "wacc": 10.75, "debt_ratio": 35, "unlevered_beta": 1.1},
    "JPM": {"growth": 4, "roic": 10, "wacc": 8.75, "debt_ratio": 42, "unlevered_beta": 0.9},
    "V": {"growth": 7, "roic": 28, "wacc": 8.5, "debt_ratio": 16, "unlevered_beta": 0.85},
    "UNH": {"growth": 6, "roic": 15, "wacc": 8.75, "debt_ratio": 28, "unlevered_beta": 0.8},
    "XOM": {"growth": 3, "roic": 12, "wacc": 9.25, "debt_ratio": 20, "unlevered_beta": 0.95},
    "LEU": {"growth": 14, "roic": 14, "wacc": 14, "debt_ratio": 30, "unlevered_beta": 1.8},
}

DEFAULT_COMPANIES = {
    "AAPL": {"name": "Apple", "sector": "Technology"},
    "MSFT": {"name": "Microsoft", "sector": "Technology"},
    "NVDA": {"name": "Nvidia", "sector": "Semiconductors"},
    "TSLA": {"name": "Tesla", "sector": "Automotive"},
    "AMZN": {"name": "Amazon", "sector": "Consumer Discretionary"},
    "GOOGL": {"name": "Alphabet", "sector": "Communication Services"},
    "META": {"name": "Meta Platforms", "sector": "Communication Services"},
    "NFLX": {"name": "Netflix", "sector": "Communication Services"},
    "AMD": {"name": "AMD", "sector": "Semiconductors"},
    "AVGO": {"name": "Broadcom", "sector": "Semiconductors"},
    "JPM": {"name": "JPMorgan Chase", "sector": "Financials"},
    "V": {"name": "Visa", "sector": "Financials"},
    "UNH": {"name": "UnitedHealth", "sector": "Health Care"},
    "XOM": {"name": "Exxon Mobil", "sector": "Energy"},
    "LEU": {"name": "Centrus Energy", "sector": "Energy"},
}


def default_metrics(ticker: str) -> CorporateMetrics:
    ticker = ticker.upper()
    if ticker in DEFAULT_METRICS:
        return CorporateMetrics(
            ticker=ticker,
            **DEFAULT_METRICS[ticker],
            crp=KOREA_COUNTRY_RISK_PREMIUM,
            growth_avg_legacy=DEFAULT_METRICS[ticker]["growth"],
            growth_cagr_v2=DEFAULT_METRICS[ticker]["growth"],
            roic_legacy=DEFAULT_METRICS[ticker]["roic"],
            roic_stable_v2=DEFAULT_METRICS[ticker]["roic"],
        )

    sector = ""
    try:
        with get_db() as conn:
            row = conn.execute(
                """SELECT sector FROM watchlist WHERE ticker = ?
                   UNION ALL
                   SELECT sector FROM corporate_companies WHERE ticker = ?
                   LIMIT 1""",
                (ticker, ticker),
            ).fetchone()
            if row:
                sector = row["sector"] or ""
    except (sqlite3.Error, OSError) as exc:
        logger.warning("corporate.default_metrics_sector_lookup_failed ticker=%s error=%s", ticker, exc)
        sector = ""

    seed = sum(ord(char) for char in f"{ticker}:{sector}")
    sector_lower = sector.lower()

    growth = 5.0 + (seed % 9)
    roic = 10.0 + (seed % 18)
    wacc = 8.0 + (seed % 18) * 0.25
    debt_ratio = 12.0 + (seed % 36)
    unlevered_beta = 0.8 + (seed % 13) * 0.07

    if any(term in sector_lower for term in ("semiconductor", "software", "cloud", "ai", "technology")):
        growth += 2.0
        roic += 3.0
        unlevered_beta += 0.15
    elif any(term in sector_lower for term in ("energy", "oil", "gas", "nuclear")):
        growth -= 1.5
        debt_ratio += 5.0
        wacc += 0.5
    elif any(term in sector_lower for term in ("financial", "bank", "insurance")):
        roic -= 2.0
        debt_ratio += 10.0
        unlevered_beta -= 0.05
    elif any(term in sector_lower for term in ("utility", "water", "electric")):
        growth -= 2.0
        debt_ratio += 14.0
        unlevered_beta -= 0.15

    return CorporateMetrics(
        ticker=ticker,
        growth=round(max(growth, 1.0), 2),
        growth_avg_legacy=round(max(growth, 1.0), 2),
        growth_cagr_v2=round(max(growth, 1.0), 2),
        roic=round(max(roic, 5.0), 2),
        roic_legacy=round(max(roic, 5.0), 2),
        roic_stable_v2=round(max(roic, 5.0), 2),
        wacc=round(max(wacc, 6.0), 2),
        debt_ratio=round(min(max(debt_ratio, 5.0), 70.0), 2),
        unlevered_beta=round(min(max(unlevered_beta, 0.55), 2.4), 2),
        crp=KOREA_COUNTRY_RISK_PREMIUM,
        reinvestment=round(24.0 + (seed % 36), 2),
        fcff=round(45.0 + (seed % 140), 2),
        innovation=round(48.0 + (seed % 45), 2),
        market_share=round(28.0 + (seed % 52), 2),
        governance=round(52.0 + (seed % 38), 2),
        esg_penalty=round(8.0 + (seed % 32), 2),
    )


def is_generic_default(row) -> bool:
    return (
        float(row["growth"]) == 6.0
        and float(row["roic"]) == 18.0
        and float(row["wacc"]) == 10.0
        and float(row["debt_ratio"]) == 18.0
        and float(row["unlevered_beta"]) == 1.05
        and float(row["crp"]) == 1.1
        and float(row["reinvestment"]) == 34.0
        and float(row["fcff"]) == 92.0
        and float(row["innovation"]) == 82.0
        and float(row["market_share"]) == 64.0
        and float(row["governance"]) == 74.0
        and float(row["esg_penalty"]) == 22.0
    )


def load_fallback_metrics(ticker: str) -> tuple[CorporateMetrics, bool]:
    ticker = ticker.upper()
    fallback = default_metrics(ticker)
    with get_db() as conn:
        row = conn.execute(
            """SELECT * FROM corporate_metrics WHERE ticker = ?""",
            (ticker,),
        ).fetchone()
    if row and not is_generic_default(row):
        return CorporateMetrics(
            ticker=row["ticker"],
            growth=row["growth"],
            growth_avg_legacy=row["growth"],
            growth_cagr_v2=row["growth"],
            roic=row["roic"],
            roic_legacy=row["roic"],
            roic_stable_v2=row["roic"],
            wacc=row["wacc"],
            debt_ratio=row["debt_ratio"],
            unlevered_beta=row["unlevered_beta"],
            crp=row["crp"],
            reinvestment=row["reinvestment"],
            fcff=row["fcff"],
            innovation=row["innovation"],
            market_share=row["market_share"],
            governance=row["governance"],
            esg_penalty=row["esg_penalty"],
        ), True
    if row and is_generic_default(row):
        preset = DEFAULT_METRICS.get(ticker)
        if ticker not in DEFAULT_METRICS or any(
            float(preset.get(key, row[key])) != float(row[key])
            for key in ("growth", "roic", "wacc", "debt_ratio", "unlevered_beta")
        ):
            return default_metrics(ticker), False
    return fallback.model_copy(
        update={
            "growth_avg_legacy": fallback.growth,
            "growth_cagr_v2": fallback.growth,
            "roic_legacy": fallback.roic,
            "roic_stable_v2": fallback.roic,
        }
    ), False


def metrics_for_ticker(
    ticker: str,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
    *,
    bundle_loader: StatementBundleLoader = get_yahoo_statement_bundle,
) -> CorporateMetrics:
    ticker = ticker.upper()
    fallback, _ = load_fallback_metrics(ticker)
    return yahoo_statement_metrics(
        ticker,
        fallback,
        growth_basis=growth_basis,
        roic_basis=roic_basis,
        growth_year=growth_year,
        roic_year=roic_year,
        bundle_loader=bundle_loader,
    ) or fallback.model_copy(
        update={
            "crp": KOREA_COUNTRY_RISK_PREMIUM,
            "growth_avg_legacy": fallback.growth,
            "growth_cagr_v2": fallback.growth,
            "roic_legacy": fallback.roic,
            "roic_stable_v2": fallback.roic,
        }
    )


def latest_market_price(ticker: str) -> float:
    """The price the metric layer computes with: the newest locally stored close.

    Deliberately not get_latest_stock_price, which fetches a live quote and refreshes
    stale bars from the provider. Metric computation never acquires -- a comparison or a
    DCF built from a live intraday quote is not reproducible, and a snapshot of it is not
    the evidence it claims to be. Prices refresh when acquisition runs, not when someone
    opens the page.
    """
    return _MKT.get_latest_stored_price(ticker)


def seed_watchlist_from_json_if_empty(watchlist_json: Path = WATCHLIST_JSON) -> None:
    ensure_watchlist_bootstrapped(watchlist_json)


def list_companies(watchlist_json: Path = WATCHLIST_JSON) -> list[CorporateCompany]:
    seed_watchlist_from_json_if_empty(watchlist_json)
    companies: dict[str, CorporateCompany] = {
        ticker: CorporateCompany(
            ticker=ticker,
            name=payload["name"],
            sector=payload["sector"],
            source="default",
        )
        for ticker, payload in DEFAULT_COMPANIES.items()
    }
    seeded_items, _ = load_watchlist_seed(watchlist_json)
    for item in seeded_items:
        ticker = item.ticker.upper()
        companies[ticker] = CorporateCompany(
            ticker=ticker,
            name=item.name or ticker,
            sector=item.sector,
            source="portfolio",
        )

    with get_db() as conn:
        watchlist_rows = conn.execute(
            """SELECT ticker, name, sector FROM watchlist ORDER BY name, ticker"""
        ).fetchall()
        manual_rows = conn.execute(
            """SELECT ticker, name, sector, source FROM corporate_companies ORDER BY name, ticker"""
        ).fetchall()

    for row in watchlist_rows:
        ticker = str(row["ticker"]).upper()
        name = row["name"] or DEFAULT_COMPANIES.get(ticker, {}).get("name") or ticker
        companies[ticker] = CorporateCompany(
            ticker=ticker,
            name=name,
            sector=row["sector"] or DEFAULT_COMPANIES.get(ticker, {}).get("sector", ""),
            source="portfolio",
        )

    for row in manual_rows:
        ticker = str(row["ticker"]).upper()
        companies[ticker] = CorporateCompany(
            ticker=ticker,
            name=row["name"] or ticker,
            sector=row["sector"] or DEFAULT_COMPANIES.get(ticker, {}).get("sector", ""),
            source=row["source"] or "manual",
        )

    return sorted(companies.values(), key=lambda company: company.name.lower())


def add_company(company: CorporateCompany) -> CorporateCompany:
    payload = company.model_copy(
        update={
            "ticker": company.ticker.upper().strip(),
            "name": company.name.strip(),
            "sector": company.sector.strip(),
            "source": company.source or "manual",
        }
    )
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_companies
               (ticker, name, sector, source, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (payload.ticker, payload.name or payload.ticker, payload.sector, payload.source, now),
        )
        fallback = default_metrics(payload.ticker)
        conn.execute(
            """INSERT OR IGNORE INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance,
                esg_penalty, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload.ticker,
                fallback.growth,
                fallback.roic,
                fallback.wacc,
                fallback.debt_ratio,
                fallback.unlevered_beta,
                fallback.crp,
                fallback.reinvestment,
                fallback.fcff,
                fallback.innovation,
                fallback.market_share,
                fallback.governance,
                fallback.esg_penalty,
                now,
            ),
        )
    return payload


def metric_history(ticker: str, *, bundle_loader: StatementBundleLoader = get_yahoo_statement_bundle) -> dict[str, object]:
    ticker = ticker.upper()
    return yahoo_metric_history(ticker, bundle_loader=bundle_loader) or {
        "ticker": ticker,
        "start_year": YAHOO_STATEMENT_START_YEAR,
        "country_risk_premium": KOREA_COUNTRY_RISK_PREMIUM,
        "growth_calculation_version": "growth_v2_stable_cagr",
        "growth_cagr": None,
        "growth_recent_average": None,
        "roic_calculation_version": "roic_v3_stable_invested_capital",
        "annual_growth_rates": [],
        "roic_recent_average": None,
        "roic_all_year_average": None,
        "annual_roic": [],
    }


def quarterly_statement_payload(
    ticker: str,
    *,
    bundle_loader: StatementBundleLoader = get_yahoo_statement_bundle,
) -> dict[str, object]:
    ticker = ticker.upper()
    bundle = bundle_loader(ticker, "quarterly-statements")
    if bundle is not None:
        rows = [
            *quarterly_statement_rows(bundle["quarterly_income"], "Income Statement", ticker),
            *quarterly_statement_rows(bundle["quarterly_balance"], "Balance Sheet", ticker),
            *quarterly_statement_rows(bundle["quarterly_cashflow"], "Cash Flow", ticker),
        ]
    else:
        rows = []
    statement_counts: dict[str, int] = {}
    for row in rows:
        statement = str(row["statement"])
        statement_counts[statement] = statement_counts.get(statement, 0) + 1
    logger.info(
        "corporate.quarterly_statements_result ticker=%s rows=%s statement_counts=%s",
        ticker,
        len(rows),
        statement_counts,
    )
    return {
        "ticker": ticker,
        "source": "Yahoo Finance quarterly financial statements via yfinance",
        "rows": rows,
    }


def save_metrics(ticker: str, metrics: CorporateMetrics) -> CorporateMetrics:
    ticker = ticker.upper()
    payload = metrics.model_copy(update={"ticker": ticker})
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance,
                esg_penalty, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ticker,
                payload.growth,
                payload.roic,
                payload.wacc,
                payload.debt_ratio,
                payload.unlevered_beta,
                payload.crp,
                payload.reinvestment,
                payload.fcff,
                payload.innovation,
                payload.market_share,
                payload.governance,
                payload.esg_penalty,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return payload


def metric_percent_for_valuation(
    metric_name: str,
    value: float,
    meta: CorporateDerivedMetricMeta | None,
    *,
    minimum: float,
    maximum: float,
) -> float:
    normalized = max(min(float(value) / 100, maximum), minimum)
    if meta is not None:
        logger.info(
            "corporate.valuation_metric_input metric=%s quality=%s metric_role=%s as_of=%s calculation_version=%s value=%s",
            metric_name,
            meta.quality,
            meta.metric_role,
            meta.as_of,
            meta.calculation_version,
            round(float(value), 4),
        )
    return normalized


def valuation_params_from_metrics(metrics: CorporateMetrics) -> ValuationAssumptions:
    growth_rate = metric_percent_for_valuation(
        "growth",
        metrics.growth,
        metrics.growth_meta,
        minimum=-0.99,
        maximum=2.0,
    )
    operating_margin = metric_percent_for_valuation(
        "roic",
        metrics.roic,
        metrics.roic_meta,
        minimum=-1.0,
        maximum=1.0,
    )
    wacc = max(float(metrics.wacc) / 100, 0.001)
    terminal_growth_rate = min(growth_rate, wacc - 0.005)
    terminal_growth_rate = max(terminal_growth_rate, -0.1)
    return ValuationAssumptions(
        revenue_growth_rate=growth_rate,
        operating_margin=operating_margin,
        tax_rate=DEFAULT_TAX_RATE,
        wacc=wacc,
        terminal_growth_rate=terminal_growth_rate,
        fcff=max(float(metrics.fcff), 0.0),
        esg_penalty=max(min(float(metrics.esg_penalty), 100.0), 0.0),
        reinvestment=max(min(float(metrics.reinvestment), 100.0), 0.0),
        unlevered_beta=max(min(float(metrics.unlevered_beta), 5.0), 0.0),
        debt_ratio=max(min(float(metrics.debt_ratio), 100.0), 0.0),
    )
