"""
Corporate analysis routes.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from apps.api.core.logger import setup_logger
from apps.api.core.transport_progress import log_transport_phase
from apps.api.models.schemas import (
    APIResponse,
    APIMeta,
    DCFFullReport,
    CorporateComparisonSnapshotDeleteResult,
    CorporateCompany,
    CorporateDerivedMetricMeta,
    CorporateComparisonHistoryResponse,
    CorporateComparisonResponse,
    CorporateComparisonStockHistoryResponse,
    CorporateDcfBatchRequest,
    CorporateMetricAudit,
    CorporateMetrics,
    ValuationAssumptions,
)
from apps.api.services.corporate_comparison import (
    DEFAULT_BENCHMARK_TICKER,
    DEFAULT_COMPARISON_UNIVERSE,
    DEFAULT_SNAPSHOT_MODE,
    build_corporate_comparison_response,
    delete_corporate_comparison_snapshot_version,
    ensure_daily_snapshot_current,
    load_corporate_comparison_history,
    load_corporate_comparison_snapshot_version,
    load_corporate_comparison_stock_history,
    save_corporate_comparison_snapshot,
)
from apps.api.services.corporate_dcf import build_dcf_full_report, build_dcf_summary
from apps.api.services.corporate_statement_metrics import (
    DEFAULT_EQUITY_RISK_PREMIUM,
    DEFAULT_RISK_FREE_RATE,
    DEFAULT_TAX_RATE,
    KOREA_COUNTRY_RISK_PREMIUM,
    YAHOO_STATEMENT_START_YEAR,
    get_yahoo_statement_bundle,
    metric_audit_for_ticker,
    quarterly_statement_rows,
    yahoo_metric_history,
    yahoo_statement_metrics,
)
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
from apps.api.services.watchlist_seed import ensure_watchlist_bootstrapped, load_watchlist_seed

router = APIRouter()
logger = setup_logger(__name__)
_API_ROOT = Path(__file__).resolve().parents[1]
_WATCHLIST_JSON = _API_ROOT / "services" / "webscrap" / "stock_targets.json"
_mkt = MarketDataService()

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

def _sse_event(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _default_metrics(ticker: str) -> CorporateMetrics:
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
    except Exception:
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


def _is_generic_default(row) -> bool:
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


def _load_fallback_metrics(ticker: str) -> tuple[CorporateMetrics, bool]:
    ticker = ticker.upper()
    fallback = _default_metrics(ticker)
    with get_db() as conn:
        row = conn.execute(
            """SELECT * FROM corporate_metrics WHERE ticker = ?""",
            (ticker,),
        ).fetchone()
    if row and not _is_generic_default(row):
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
    if row and _is_generic_default(row):
        preset = DEFAULT_METRICS.get(ticker)
        if ticker not in DEFAULT_METRICS or any(
            float(preset.get(key, row[key])) != float(row[key])
            for key in ("growth", "roic", "wacc", "debt_ratio", "unlevered_beta")
        ):
            return _default_metrics(ticker), False
    return fallback.model_copy(
        update={
            "growth_avg_legacy": fallback.growth,
            "growth_cagr_v2": fallback.growth,
            "roic_legacy": fallback.roic,
            "roic_stable_v2": fallback.roic,
        }
    ), False


def _get_yahoo_statement_bundle(ticker: str, endpoint: str) -> Optional[dict[str, object]]:
    return get_yahoo_statement_bundle(ticker, endpoint)


def _metrics_for_ticker(
    ticker: str,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
) -> CorporateMetrics:
    ticker = ticker.upper()
    fallback, _ = _load_fallback_metrics(ticker)
    return yahoo_statement_metrics(
        ticker,
        fallback,
        growth_basis=growth_basis,
        roic_basis=roic_basis,
        growth_year=growth_year,
        roic_year=roic_year,
        bundle_loader=_get_yahoo_statement_bundle,
    ) or fallback.model_copy(
        update={
            "crp": KOREA_COUNTRY_RISK_PREMIUM,
            "growth_avg_legacy": fallback.growth,
            "growth_cagr_v2": fallback.growth,
            "roic_legacy": fallback.roic,
            "roic_stable_v2": fallback.roic,
        }
    )


def _latest_market_price(ticker: str) -> float:
    bars = _mkt.get_stock_ohlcv(ticker, period="1mo")
    if not bars:
        return 0.0
    return float(bars[-1].close)


def _seed_watchlist_from_json_if_empty() -> None:
    """Populate watchlist-backed companies without requiring Portfolio tab first."""
    ensure_watchlist_bootstrapped(_WATCHLIST_JSON)


def ensure_corporate_comparison_daily_snapshot() -> CorporateComparisonResponse | None:
    """Ensure the current KST business-date snapshot exists."""
    _seed_watchlist_from_json_if_empty()
    return ensure_daily_snapshot_current(
        comparison_universe=DEFAULT_COMPARISON_UNIVERSE,
        benchmark_ticker=DEFAULT_BENCHMARK_TICKER,
        custom_tickers=[],
        metrics_loader=_metrics_for_ticker,
        price_loader=_latest_market_price,
        default_companies=DEFAULT_COMPANIES,
        risk_free_rate=DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
    )


def _metric_percent_for_valuation(
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


def _valuation_params_from_metrics(metrics: CorporateMetrics) -> ValuationAssumptions:
    growth_rate = _metric_percent_for_valuation(
        "growth",
        metrics.growth,
        metrics.growth_meta,
        minimum=-0.99,
        maximum=2.0,
    )
    operating_margin = _metric_percent_for_valuation(
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


@router.get("/companies", response_model=list[CorporateCompany])
async def get_corporate_companies():
    """Return company-name-first corporate analysis universe."""
    _seed_watchlist_from_json_if_empty()
    companies: dict[str, CorporateCompany] = {
        ticker: CorporateCompany(
            ticker=ticker,
            name=payload["name"],
            sector=payload["sector"],
            source="default",
        )
        for ticker, payload in DEFAULT_COMPANIES.items()
    }
    seeded_items, _ = load_watchlist_seed(_WATCHLIST_JSON)
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


@router.post("/companies", response_model=CorporateCompany)
async def add_corporate_company(company: CorporateCompany = Body(...)):
    """Persist a manually added company for on-demand corporate analysis."""
    payload = company.model_copy(
        update={
            "ticker": company.ticker.upper().strip(),
            "name": company.name.strip(),
            "sector": company.sector.strip(),
            "source": company.source or "manual",
        }
    )
    with get_db() as conn:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT OR REPLACE INTO corporate_companies
               (ticker, name, sector, source, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (payload.ticker, payload.name or payload.ticker, payload.sector, payload.source, now),
        )
    default_metrics = _default_metrics(payload.ticker)
    with get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance,
                esg_penalty, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload.ticker,
                default_metrics.growth,
                default_metrics.roic,
                default_metrics.wacc,
                default_metrics.debt_ratio,
                default_metrics.unlevered_beta,
                default_metrics.crp,
                default_metrics.reinvestment,
                default_metrics.fcff,
                default_metrics.innovation,
                default_metrics.market_share,
                default_metrics.governance,
                default_metrics.esg_penalty,
                now,
            ),
        )
    return payload


@router.get("/comparison", response_model=APIResponse[CorporateComparisonResponse])
async def get_corporate_comparison(
    mode: Literal["snapshot", "live"] = Query(default=DEFAULT_SNAPSHOT_MODE),
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
):
    """Return cross-stock comparison rows for the current target-stock universe."""
    _seed_watchlist_from_json_if_empty()
    response = build_corporate_comparison_response(
        mode=mode,
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[ticker for ticker in custom_tickers.split(",") if ticker.strip()],
        metrics_loader=_metrics_for_ticker,
        price_loader=_latest_market_price,
        default_companies=DEFAULT_COMPANIES,
        risk_free_rate=DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/comparison/snapshot", response_model=APIResponse[CorporateComparisonResponse])
async def refresh_corporate_comparison_snapshot(
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
):
    """Recompute and persist today's comparison snapshot."""
    _seed_watchlist_from_json_if_empty()
    response = save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[ticker for ticker in custom_tickers.split(",") if ticker.strip()],
        metrics_loader=_metrics_for_ticker,
        price_loader=_latest_market_price,
        default_companies=DEFAULT_COMPANIES,
        risk_free_rate=DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/comparison/history", response_model=APIResponse[CorporateComparisonHistoryResponse])
async def get_corporate_comparison_history(
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
    limit: int = Query(default=30, ge=1, le=365),
):
    """Return persisted snapshot-history summaries for the selected comparison universe."""
    _seed_watchlist_from_json_if_empty()
    response = load_corporate_comparison_history(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[ticker for ticker in custom_tickers.split(",") if ticker.strip()],
        limit=limit,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/comparison/snapshot-version", response_model=APIResponse[CorporateComparisonResponse])
async def get_corporate_comparison_snapshot_version(snapshot_version: str = Query(..., min_length=1)):
    """Return one persisted comparison snapshot version by id."""
    normalized_snapshot_version = snapshot_version.strip().replace(" ", "+")
    response = load_corporate_comparison_snapshot_version(snapshot_version=normalized_snapshot_version)
    if response is None:
        raise HTTPException(status_code=404, detail="Snapshot version not found")
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.delete("/comparison/snapshot-version", response_model=APIResponse[CorporateComparisonSnapshotDeleteResult])
async def delete_corporate_comparison_snapshot(snapshot_version: str = Query(..., min_length=1)):
    """Delete one persisted comparison snapshot version by id."""
    normalized_snapshot_version = snapshot_version.strip().replace(" ", "+")
    deleted_rows = delete_corporate_comparison_snapshot_version(snapshot_version=normalized_snapshot_version)
    if deleted_rows == 0:
        raise HTTPException(status_code=404, detail="Snapshot version not found")
    return APIResponse(
        data=CorporateComparisonSnapshotDeleteResult(
            snapshot_version=normalized_snapshot_version,
            deleted_rows=deleted_rows,
        ),
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/comparison/stock-history", response_model=APIResponse[CorporateComparisonStockHistoryResponse])
async def get_corporate_comparison_stock_history(
    ticker: str = Query(..., min_length=1),
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
    limit: int = Query(default=30, ge=1, le=365),
):
    """Return per-stock saved snapshot metrics across the selected snapshot timeline."""
    _seed_watchlist_from_json_if_empty()
    response = load_corporate_comparison_stock_history(
        ticker=ticker,
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[raw_ticker for raw_ticker in custom_tickers.split(",") if raw_ticker.strip()],
        limit=limit,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/{ticker}")
async def dynamic_dcf_model(ticker: str, params: ValuationAssumptions):
    """
    Lightweight non-streaming DCF summary response kept for compatibility paths.
    """
    summary, assumption_summary = build_dcf_summary(
        ticker=ticker,
        params=params,
        current_price_loader=_latest_market_price,
        metrics_loader=_metrics_for_ticker,
        risk_free_rate=DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
        country_risk_premium=KOREA_COUNTRY_RISK_PREMIUM,
    )
    return APIResponse(
        status="ok",
        data={**summary.model_dump(), **assumption_summary.model_dump(exclude={"report_id", "ticker", "generated_at"})},
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/{ticker}/report", response_model=APIResponse[DCFFullReport])
async def get_dcf_full_report(ticker: str, params: ValuationAssumptions):
    """Return the full DCF report only on explicit request."""
    report = build_dcf_full_report(
        ticker=ticker,
        params=params,
        current_price_loader=_latest_market_price,
        metrics_loader=_metrics_for_ticker,
        risk_free_rate=DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
        country_risk_premium=KOREA_COUNTRY_RISK_PREMIUM,
    )
    return APIResponse(
        status="ok",
        data=report,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/reports/bulk", response_model=APIResponse[list[DCFFullReport]])
async def get_bulk_dcf_reports(request: CorporateDcfBatchRequest):
    """Calculate full DCF reports for a list of comparison tickers."""
    tickers = []
    for raw_ticker in request.tickers:
        ticker = raw_ticker.upper().strip()
        if ticker and ticker not in tickers:
            tickers.append(ticker)

    reports: list[DCFFullReport] = []
    for ticker in tickers:
        metrics = _metrics_for_ticker(ticker)
        report = build_dcf_full_report(
            ticker=ticker,
            params=_valuation_params_from_metrics(metrics),
            current_price_loader=_latest_market_price,
            metrics_loader=_metrics_for_ticker,
            risk_free_rate=DEFAULT_RISK_FREE_RATE,
            equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
            country_risk_premium=KOREA_COUNTRY_RISK_PREMIUM,
        )
        reports.append(report)

    return APIResponse(
        status="ok",
        data=reports,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/{ticker}/stream")
async def stream_dcf_summary(request: Request, ticker: str, params: ValuationAssumptions = Body(...)):
    """Stream the phase 1 and phase 2 DCF payloads without shipping the full report."""

    async def event_stream():
        started_at = time.perf_counter()
        request_id = getattr(request.state, "request_id", "")
        bytes_sent = 0
        chunk_count = 0
        summary, assumption_summary = build_dcf_summary(
            ticker=ticker,
            params=params,
            current_price_loader=_latest_market_price,
            metrics_loader=_metrics_for_ticker,
            risk_free_rate=DEFAULT_RISK_FREE_RATE,
            equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
            country_risk_premium=KOREA_COUNTRY_RISK_PREMIUM,
        )
        phase1_event = _sse_event("phase1", {"phase": "phase1", "summary": summary.model_dump()})
        bytes_sent += len(phase1_event.encode("utf-8"))
        chunk_count += 1
        log_transport_phase(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            phase="phase1",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            bytes_sent=bytes_sent,
            chunk_count=chunk_count,
        )
        yield phase1_event
        phase2_event = _sse_event("phase2", {"phase": "phase2", "assumptions": assumption_summary.model_dump()})
        bytes_sent += len(phase2_event.encode("utf-8"))
        chunk_count += 1
        log_transport_phase(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            phase="phase2",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            bytes_sent=bytes_sent,
            chunk_count=chunk_count,
        )
        yield phase2_event
        complete_event = _sse_event(
            "complete",
            {
                "phase": "complete",
                "report_id": summary.report_id,
                "generated_at": summary.generated_at,
            },
        )
        bytes_sent += len(complete_event.encode("utf-8"))
        chunk_count += 1
        log_transport_phase(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            phase="complete",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            bytes_sent=bytes_sent,
            chunk_count=chunk_count,
            completed=True,
        )
        yield complete_event

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/metrics/{ticker}", response_model=CorporateMetrics)
async def get_corporate_metrics(
    ticker: str,
    growth_basis: Literal["cagr", "recent_average", "annual"] = Query(default="cagr"),
    roic_basis: Literal["recent_average", "all_year_average", "annual"] = Query(default="recent_average"),
    growth_year: Optional[int] = Query(default=None, ge=YAHOO_STATEMENT_START_YEAR),
    roic_year: Optional[int] = Query(default=None, ge=YAHOO_STATEMENT_START_YEAR),
):
    ticker = ticker.upper()
    logger.info(
        "corporate.metrics_request ticker=%s growth_basis=%s growth_year=%s roic_basis=%s roic_year=%s",
        ticker,
        growth_basis,
        growth_year,
        roic_basis,
        roic_year,
    )
    return _metrics_for_ticker(
        ticker,
        growth_basis=growth_basis,
        roic_basis=roic_basis,
        growth_year=growth_year,
        roic_year=roic_year,
    )


@router.get("/metrics/{ticker}/audit", response_model=CorporateMetricAudit)
async def get_corporate_metric_audit(
    ticker: str,
    roic_basis: Literal["recent_average", "all_year_average", "annual"] = Query(default="recent_average"),
    roic_year: Optional[int] = Query(default=None, ge=YAHOO_STATEMENT_START_YEAR),
):
    ticker = ticker.upper()
    logger.info(
        "corporate.metric_audit_request ticker=%s roic_basis=%s roic_year=%s",
        ticker,
        roic_basis,
        roic_year,
    )
    fallback, has_saved_metrics = _load_fallback_metrics(ticker)
    return metric_audit_for_ticker(
        ticker,
        fallback,
        has_saved_metrics=has_saved_metrics,
        roic_basis=roic_basis,
        roic_year=roic_year,
        bundle_loader=_get_yahoo_statement_bundle,
    )


@router.get("/metrics/{ticker}/history")
async def get_corporate_metric_history(ticker: str):
    ticker = ticker.upper()
    logger.info("corporate.metrics_history_request ticker=%s", ticker)
    return yahoo_metric_history(ticker, bundle_loader=_get_yahoo_statement_bundle) or {
        "ticker": ticker,
        "start_year": YAHOO_STATEMENT_START_YEAR,
        "country_risk_premium": KOREA_COUNTRY_RISK_PREMIUM,
        "growth_cagr": None,
        "growth_recent_average": None,
        "annual_growth_rates": [],
        "roic_recent_average": None,
        "roic_all_year_average": None,
        "annual_roic": [],
    }


@router.get("/metrics/{ticker}/quarterly-statements")
async def get_corporate_quarterly_statements(ticker: str):
    ticker = ticker.upper()
    logger.info("corporate.quarterly_statements_request ticker=%s", ticker)
    bundle = get_yahoo_statement_bundle(ticker, "quarterly-statements")
    if bundle is not None:
        quarterly_income = bundle["quarterly_income"]
        quarterly_balance = bundle["quarterly_balance"]
        quarterly_cashflow = bundle["quarterly_cashflow"]
        rows = [
            *quarterly_statement_rows(quarterly_income, "Income Statement", ticker),
            *quarterly_statement_rows(quarterly_balance, "Balance Sheet", ticker),
            *quarterly_statement_rows(quarterly_cashflow, "Cash Flow", ticker),
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


@router.put("/metrics/{ticker}", response_model=CorporateMetrics)
async def save_corporate_metrics(ticker: str, metrics: CorporateMetrics):
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


@router.get("/diagnostic/{ticker}/radar")
async def get_corporate_radar(ticker: str):
    """
    Native Recharts Radar mappings resolving overlapping qualitative bounds.
    Requires: [{subject: string, score: number, peer: number, max: number}]
    """
    return APIResponse(
        data=[
            {"subject": "Scale", "score": 85, "peer": 70, "max": 100},
            {"subject": "Growth", "score": 45, "peer": 60, "max": 100},
            {"subject": "Profitability", "score": 92, "peer": 65, "max": 100},
            {"subject": "Risk", "score": 55, "peer": 50, "max": 100},
            {"subject": "Valuation", "score": 30, "peer": 60, "max": 100},
        ]
    )


@router.get("/diagnostic/{ticker}/tornado")
async def get_monte_carlo_tornado(ticker: str):
    """
    Native Recharts Bar mapping for Monte Carlo sensitivity.
    Requires: [{name: string, target: number}]
    """
    return APIResponse(
        data=[
            {"name": "Bear (5%)", "target": 75.50},
            {"name": "Base (50%)", "target": 115.00},
            {"name": "Bull (95%)", "target": 145.20},
        ]
    )
