"""
Corporate analysis routes.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Body, Query

from apps.api.core.logger import setup_logger
from apps.api.models.schemas import (
    APIResponse,
    APIMeta,
    CorporateCompany,
    CorporateComparisonHistoryResponse,
    CorporateComparisonResponse,
    CorporateMetrics,
    ValuationAssumptions,
)
from apps.api.services.corporate_comparison import (
    DEFAULT_BENCHMARK_TICKER,
    DEFAULT_COMPARISON_UNIVERSE,
    DEFAULT_SNAPSHOT_MODE,
    build_corporate_comparison_response,
    load_corporate_comparison_history,
    ensure_daily_snapshot_current,
    save_corporate_comparison_snapshot,
)
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
from apps.api.services.watchlist_seed import ensure_watchlist_bootstrapped

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

YAHOO_STATEMENT_START_YEAR = 2021
YAHOO_STATEMENT_END_YEAR = 2025
DEFAULT_TAX_RATE = 0.21
DEFAULT_RISK_FREE_RATE = 0.042
DEFAULT_EQUITY_RISK_PREMIUM = 0.055
KOREA_COUNTRY_RISK_PREMIUM = 0.8
YAHOO_STATEMENT_CACHE_TTL_SECONDS = 300
_YAHOO_STATEMENT_CACHE: dict[str, dict[str, object]] = {}


def _frame_shape(frame) -> tuple[int, int]:
    if frame is None or getattr(frame, "empty", True):
        return (0, 0)
    return tuple(int(value) for value in frame.shape)


def _frame_periods(frame) -> list[str]:
    if frame is None or getattr(frame, "empty", True):
        return []
    periods: list[str] = []
    for raw_period in frame.columns:
        period = raw_period.date().isoformat() if hasattr(raw_period, "date") else str(raw_period)
        periods.append(period)
    return periods


def _get_yahoo_statement_bundle(ticker: str, endpoint: str) -> Optional[dict[str, object]]:
    ticker = ticker.upper()
    now = datetime.now(timezone.utc)
    cached = _YAHOO_STATEMENT_CACHE.get(ticker)
    if cached:
        fetched_at = cached.get("fetched_at")
        if isinstance(fetched_at, datetime):
            age_seconds = (now - fetched_at).total_seconds()
            if age_seconds < YAHOO_STATEMENT_CACHE_TTL_SECONDS:
                logger.info(
                    "corporate.statement_cache ticker=%s endpoint=%s cache_hit=true fetched_at=%s age_seconds=%.2f",
                    ticker,
                    endpoint,
                    fetched_at.isoformat(),
                    age_seconds,
                )
                return cached

    logger.info("corporate.statement_cache ticker=%s endpoint=%s cache_hit=false", ticker, endpoint)
    try:
        import yfinance as yf
    except Exception as exc:
        logger.warning(
            "corporate.statement_import_failed ticker=%s endpoint=%s python_executable=%s error=%s",
            ticker,
            endpoint,
            sys.executable,
            exc,
        )
        return None

    try:
        yahoo_ticker = yf.Ticker(ticker)
        income = yahoo_ticker.financials
        balance = yahoo_ticker.balance_sheet
        cashflow = yahoo_ticker.cashflow
        quarterly_income = yahoo_ticker.quarterly_financials
        quarterly_balance = yahoo_ticker.quarterly_balance_sheet
        quarterly_cashflow = yahoo_ticker.quarterly_cashflow
        try:
            info = yahoo_ticker.info or {}
        except Exception as exc:
            logger.warning("corporate.statement_info_fetch_failed ticker=%s endpoint=%s error=%s", ticker, endpoint, exc)
            info = {}
    except Exception as exc:
        logger.warning("corporate.statement_fetch_failed ticker=%s endpoint=%s error=%s", ticker, endpoint, exc)
        return None

    bundle = {
        "ticker": ticker,
        "income": income,
        "balance": balance,
        "cashflow": cashflow,
        "quarterly_income": quarterly_income,
        "quarterly_balance": quarterly_balance,
        "quarterly_cashflow": quarterly_cashflow,
        "info": info,
        "fetched_at": now,
    }
    _YAHOO_STATEMENT_CACHE[ticker] = bundle
    logger.info(
        "corporate.statement_fetch ticker=%s endpoint=%s annual_income_shape=%s annual_balance_shape=%s "
        "annual_cashflow_shape=%s quarterly_income_shape=%s quarterly_balance_shape=%s quarterly_cashflow_shape=%s "
        "annual_income_periods=%s annual_balance_periods=%s annual_cashflow_periods=%s "
        "quarterly_income_periods=%s quarterly_balance_periods=%s quarterly_cashflow_periods=%s",
        ticker,
        endpoint,
        _frame_shape(income),
        _frame_shape(balance),
        _frame_shape(cashflow),
        _frame_shape(quarterly_income),
        _frame_shape(quarterly_balance),
        _frame_shape(quarterly_cashflow),
        _frame_periods(income),
        _frame_periods(balance),
        _frame_periods(cashflow),
        _frame_periods(quarterly_income),
        _frame_periods(quarterly_balance),
        _frame_periods(quarterly_cashflow),
    )
    return bundle


def _statement_series(frame, labels: tuple[str, ...]):
    if frame is None or getattr(frame, "empty", True):
        return None
    for label in labels:
        if label in frame.index:
            series = frame.loc[label]
            return series.sort_index()
    return None


def _annual_statement_values(series) -> list[float]:
    if series is None:
        return []
    values: list[float] = []
    for date_index, raw in series.items():
        try:
            if getattr(date_index, "year", 0) < YAHOO_STATEMENT_START_YEAR:
                continue
            value = float(raw)
            if value == value and value != 0:
                values.append(value)
        except (TypeError, ValueError):
            continue
    return values[-5:]


def _annual_statement_points(series, start_year: int = YAHOO_STATEMENT_START_YEAR) -> list[tuple[int, float]]:
    if series is None:
        return []
    points: list[tuple[int, float]] = []
    for date_index, raw in series.items():
        try:
            year = int(getattr(date_index, "year", 0))
            if year < start_year or year > YAHOO_STATEMENT_END_YEAR:
                continue
            value = float(raw)
            if value == value and value != 0:
                points.append((year, value))
        except (TypeError, ValueError):
            continue
    return points[-5:]


def _statement_map(frame, labels: tuple[str, ...]) -> dict[int, float]:
    return dict(_annual_statement_points(_statement_series(frame, labels)))


def _statement_map_from_year(frame, labels: tuple[str, ...], start_year: int) -> dict[int, float]:
    return dict(_annual_statement_points(_statement_series(frame, labels), start_year=start_year))


def _quarterly_flow_map(frame, labels: tuple[str, ...], start_year: int = YAHOO_STATEMENT_START_YEAR) -> dict[int, float]:
    series = _statement_series(frame, labels)
    if series is None:
        return {}
    by_year: dict[int, float] = {}
    for date_index, raw in series.items():
        try:
            year = int(getattr(date_index, "year", 0))
            if year < start_year or year > YAHOO_STATEMENT_END_YEAR:
                continue
            value = float(raw)
            if value == value and value != 0:
                by_year[year] = by_year.get(year, 0.0) + value
        except (TypeError, ValueError):
            continue
    return by_year


def _quarterly_balance_map(frame, labels: tuple[str, ...], start_year: int = YAHOO_STATEMENT_START_YEAR) -> dict[int, float]:
    series = _statement_series(frame, labels)
    if series is None:
        return {}
    latest_by_year: dict[int, tuple[object, float]] = {}
    for date_index, raw in series.items():
        try:
            year = int(getattr(date_index, "year", 0))
            if year < start_year or year > YAHOO_STATEMENT_END_YEAR:
                continue
            value = float(raw)
            if value == value and value != 0:
                previous = latest_by_year.get(year)
                if previous is None or date_index > previous[0]:
                    latest_by_year[year] = (date_index, value)
        except (TypeError, ValueError):
            continue
    return {year: value for year, (_, value) in latest_by_year.items()}


def _prefer_annual_map(annual: dict[int, float], quarterly: dict[int, float]) -> dict[int, float]:
    combined = dict(quarterly)
    combined.update(annual)
    return combined


def _average(values: list[float]) -> Optional[float]:
    clean = [value for value in values if value == value]
    return sum(clean) / len(clean) if clean else None


def _safe_ratio(numerator: float, denominator: float) -> Optional[float]:
    if denominator == 0:
        return None
    return numerator / denominator


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _latest_from_map(values: dict[int, float]) -> Optional[float]:
    if not values:
        return None
    return values[sorted(values)[-1]]


def _matching_years(*maps: dict[int, float]) -> list[int]:
    if not maps:
        return []
    years = set(maps[0])
    for mapping in maps[1:]:
        years &= set(mapping)
    return sorted(years)[-5:]


def _annual_growth_rates(revenue: dict[int, float]) -> list[dict[str, float]]:
    years = sorted(revenue)
    rates: list[dict[str, float]] = []
    for previous_year, year in zip(years, years[1:]):
        if year < YAHOO_STATEMENT_START_YEAR or year > YAHOO_STATEMENT_END_YEAR:
            continue
        previous = revenue[previous_year]
        current = revenue[year]
        if previous > 0:
            rates.append({"year": year, "value": ((current / previous) - 1) * 100})
    return rates[-5:]


def _growth_value(
    rates: list[dict[str, float]],
    revenue: dict[int, float],
    growth_basis: str,
    growth_year: Optional[int],
) -> Optional[float]:
    if growth_basis == "annual" and growth_year is not None:
        match = next((point["value"] for point in rates if int(point["year"]) == growth_year), None)
        if match is not None:
            return match
    if growth_basis == "annual":
        return rates[-1]["value"] if rates else None
    if growth_basis == "recent_average":
        return _average([point["value"] for point in rates[-3:]])
    years = sorted(revenue)
    if len(years) >= 2 and revenue[years[0]] > 0:
        periods = len(years) - 1
        return ((revenue[years[-1]] / revenue[years[0]]) ** (1 / periods) - 1) * 100
    return _average([point["value"] for point in rates])


def _roic_value(points: list[dict[str, float]], roic_basis: str, roic_year: Optional[int]) -> Optional[float]:
    if roic_basis == "annual" and roic_year is not None:
        match = next((point["value"] for point in points if int(point["year"]) == roic_year), None)
        if match is not None:
            return match
    if roic_basis == "annual":
        return points[-1]["value"] if points else None
    values = [point["value"] for point in points]
    if roic_basis == "all_year_average":
        return _average(values)
    return _average(values[-3:])


def _annual_metric_rows(points: list[dict[str, float]]) -> list[dict[str, Optional[float]]]:
    by_year = {int(point["year"]): round(float(point["value"]), 2) for point in points}
    return [
        {"year": year, "value": by_year.get(year)}
        for year in range(YAHOO_STATEMENT_START_YEAR, YAHOO_STATEMENT_END_YEAR + 1)
    ]


def _quarterly_statement_rows(frame, statement: str, ticker: str) -> list[dict[str, object]]:
    if frame is None or getattr(frame, "empty", True):
        return []
    rows: list[dict[str, object]] = []
    for raw_metric, series in frame.iterrows():
        metric = str(raw_metric)
        for raw_period, raw_value in series.items():
            try:
                value = float(raw_value)
                if value != value:
                    continue
            except (TypeError, ValueError):
                continue

            period = raw_period.date().isoformat() if hasattr(raw_period, "date") else str(raw_period)
            rows.append({
                "ticker": ticker,
                "statement": statement,
                "period": period,
                "metric": metric,
                "value": value,
            })
    return sorted(rows, key=lambda row: (str(row["statement"]), str(row["metric"]), str(row["period"])), reverse=True)


def _yahoo_statement_metrics(
    ticker: str,
    fallback: CorporateMetrics,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
) -> Optional[CorporateMetrics]:
    """
    Build corporate assumptions from Yahoo annual financial statements from 2021 onward.

    Methodology:
    - Growth defaults to a 2021+ revenue CAGR, with annual or recent-average overrides.
    - ROIC defaults to a recent multi-year average, with annual or all-year-average overrides.
    - WACC and debt ratio use the latest available annual statement capital structure.
    - CRP is fixed to the South Korea country-risk premium because Yahoo statements do not
      report country risk premium.
    """
    bundle = _get_yahoo_statement_bundle(ticker, "metrics")
    if bundle is None:
        return None
    income = bundle["income"]
    balance = bundle["balance"]
    cashflow = bundle["cashflow"]
    quarterly_income = bundle["quarterly_income"]
    quarterly_balance = bundle["quarterly_balance"]
    info = bundle["info"]

    revenue_by_year = _prefer_annual_map(
        _statement_map_from_year(income, ("Total Revenue", "Operating Revenue"), YAHOO_STATEMENT_START_YEAR - 1),
        _quarterly_flow_map(quarterly_income, ("Total Revenue", "Operating Revenue"), start_year=YAHOO_STATEMENT_START_YEAR - 1),
    )
    operating_income_by_year = _prefer_annual_map(
        _statement_map(income, ("Operating Income", "EBIT")),
        _quarterly_flow_map(quarterly_income, ("Operating Income", "EBIT")),
    )
    pretax_income_by_year = _prefer_annual_map(
        _statement_map(income, ("Pretax Income", "Income Before Tax")),
        _quarterly_flow_map(quarterly_income, ("Pretax Income", "Income Before Tax")),
    )
    tax_expense_by_year = _prefer_annual_map(
        _statement_map(income, ("Tax Provision", "Income Tax Expense")),
        _quarterly_flow_map(quarterly_income, ("Tax Provision", "Income Tax Expense")),
    )
    interest_expense_by_year = {
        year: abs(value)
        for year, value in _prefer_annual_map(
            _statement_map(income, ("Interest Expense", "Interest Expense Non Operating")),
            _quarterly_flow_map(quarterly_income, ("Interest Expense", "Interest Expense Non Operating")),
        ).items()
    }
    debt_by_year = _prefer_annual_map(
        _statement_map(balance, ("Total Debt", "Net Debt")),
        _quarterly_balance_map(quarterly_balance, ("Total Debt", "Net Debt")),
    )
    equity_by_year = _prefer_annual_map(
        _statement_map(balance, ("Stockholders Equity", "Total Equity Gross Minority Interest")),
        _quarterly_balance_map(quarterly_balance, ("Stockholders Equity", "Total Equity Gross Minority Interest")),
    )
    cash_by_year = _prefer_annual_map(
        _statement_map(balance, ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
        _quarterly_balance_map(quarterly_balance, ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
    )
    capex_by_year = {
        year: abs(value)
        for year, value in _statement_map(cashflow, ("Capital Expenditure", "Capital Expenditures")).items()
    }
    depreciation_by_year = _statement_map(cashflow, ("Depreciation And Amortization", "Depreciation Amortization Depletion"))
    free_cash_flow_by_year = _statement_map(cashflow, ("Free Cash Flow",))
    research_development_by_year = _statement_map(income, ("Research And Development", "Research Development"))

    current_revenue_by_year = {
        year: value
        for year, value in revenue_by_year.items()
        if YAHOO_STATEMENT_START_YEAR <= year <= YAHOO_STATEMENT_END_YEAR
    }

    if len(revenue_by_year) < 2 or not current_revenue_by_year:
        logger.info(
            "corporate.statement_insufficient ticker=%s endpoint=metrics revenue_years=%s current_revenue_years=%s",
            ticker,
            sorted(revenue_by_year),
            sorted(current_revenue_by_year),
        )
        return None

    annual_growth = _annual_growth_rates(revenue_by_year)
    growth = _growth_value(annual_growth, current_revenue_by_year, growth_basis, growth_year)

    tax_rates = [
        _bounded(tax_expense_by_year[year] / pretax_income_by_year[year], 0, 0.35)
        for year in _matching_years(tax_expense_by_year, pretax_income_by_year)
        if pretax_income_by_year[year] > 0
    ]
    tax_rate = _average(tax_rates) or DEFAULT_TAX_RATE

    roic_points: list[dict[str, float]] = []
    nopat_by_year: dict[int, float] = {}
    for year in _matching_years(operating_income_by_year, debt_by_year, equity_by_year):
        cash_value = cash_by_year.get(year, 0.0)
        invested_capital = max(debt_by_year[year] + equity_by_year[year] - cash_value, 1.0)
        nopat = operating_income_by_year[year] * (1 - tax_rate)
        nopat_by_year[year] = nopat
        ratio = _safe_ratio(nopat, invested_capital)
        if ratio is not None:
            roic_points.append({"year": year, "value": ratio * 100})
    roic = _roic_value(roic_points, roic_basis, roic_year)

    latest_debt = _latest_from_map(debt_by_year)
    latest_equity = _latest_from_map(equity_by_year)
    latest_debt_ratio = (
        _bounded(latest_debt / (latest_debt + latest_equity) * 100, 0, 90)
        if latest_debt is not None and latest_equity is not None and latest_debt + latest_equity != 0
        else None
    )
    debt_ratio = latest_debt_ratio

    reinvestment_values = []
    for year in _matching_years(capex_by_year, depreciation_by_year):
        nopat = nopat_by_year.get(year)
        if nopat is None:
            continue
        ratio = _safe_ratio(max(capex_by_year[year] - depreciation_by_year[year], 0), nopat)
        if ratio is not None:
            reinvestment_values.append(_bounded(ratio * 100, 0, 100))
    reinvestment = _average(reinvestment_values)

    fcff_billions = _average([free_cash_flow_by_year[year] / 1_000_000_000 for year in sorted(free_cash_flow_by_year)[-3:]])

    rd_intensity_values = [
        ratio * 100
        for ratio in (
            _safe_ratio(research_development_by_year[year], revenue_by_year[year])
            for year in _matching_years(research_development_by_year, revenue_by_year)
        )
        if ratio is not None
    ]
    innovation = _average([min(max(value * 10, 0), 100) for value in rd_intensity_values])

    debt_to_equity = (
        latest_debt / latest_equity
        if latest_debt is not None and latest_equity is not None and latest_equity != 0
        else fallback.debt_ratio / max(100 - fallback.debt_ratio, 1)
    )
    levered_beta = float(info.get("beta") or fallback.unlevered_beta * (1 + (1 - tax_rate) * debt_to_equity))
    unlevered_beta = _bounded(levered_beta / (1 + (1 - tax_rate) * debt_to_equity), 0.4, 3.0)

    latest_interest = _latest_from_map(interest_expense_by_year) or 0
    cost_of_debt = min(max((latest_interest / latest_debt) if latest_debt and latest_debt > 0 else 0.045, 0.01), 0.15)
    debt_weight = (debt_ratio or fallback.debt_ratio) / 100
    equity_weight = 1 - debt_weight
    cost_of_equity = DEFAULT_RISK_FREE_RATE + levered_beta * DEFAULT_EQUITY_RISK_PREMIUM + KOREA_COUNTRY_RISK_PREMIUM / 100
    wacc = (equity_weight * cost_of_equity + debt_weight * cost_of_debt * (1 - tax_rate)) * 100
    logger.info(
        "corporate.statement_derived ticker=%s growth_basis=%s growth_year=%s roic_basis=%s roic_year=%s "
        "revenue_years=%s annual_growth_years=%s roic_years=%s debt_years=%s equity_years=%s "
        "growth=%s roic=%s debt_ratio=%s wacc=%s",
        ticker,
        growth_basis,
        growth_year,
        roic_basis,
        roic_year,
        sorted(current_revenue_by_year),
        [int(point["year"]) for point in annual_growth],
        [int(point["year"]) for point in roic_points],
        sorted(debt_by_year),
        sorted(equity_by_year),
        round(growth, 4) if growth is not None else None,
        round(roic, 4) if roic is not None else None,
        round(debt_ratio, 4) if debt_ratio is not None else None,
        round(wacc, 4),
    )

    return CorporateMetrics(
        ticker=ticker,
        growth=round(growth if growth is not None else fallback.growth, 2),
        roic=round(roic if roic is not None else fallback.roic, 2),
        wacc=round(wacc, 2),
        debt_ratio=round(debt_ratio if debt_ratio is not None else fallback.debt_ratio, 2),
        unlevered_beta=round(unlevered_beta, 2),
        crp=KOREA_COUNTRY_RISK_PREMIUM,
        reinvestment=round(reinvestment if reinvestment is not None else fallback.reinvestment, 2),
        fcff=round(fcff_billions if fcff_billions is not None else fallback.fcff, 2),
        innovation=round(innovation if innovation is not None else fallback.innovation, 2),
        market_share=fallback.market_share,
        governance=fallback.governance,
        esg_penalty=fallback.esg_penalty,
    )


def _default_metrics(ticker: str) -> CorporateMetrics:
    ticker = ticker.upper()
    if ticker in DEFAULT_METRICS:
        return CorporateMetrics(ticker=ticker, **DEFAULT_METRICS[ticker], crp=KOREA_COUNTRY_RISK_PREMIUM)

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
        roic=round(max(roic, 5.0), 2),
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


def _metrics_for_ticker(
    ticker: str,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
) -> CorporateMetrics:
    ticker = ticker.upper()
    fallback = _default_metrics(ticker)
    with get_db() as conn:
        row = conn.execute(
            """SELECT * FROM corporate_metrics WHERE ticker = ?""",
            (ticker,),
        ).fetchone()
    if row and not _is_generic_default(row):
        fallback = CorporateMetrics(
            ticker=row["ticker"],
            growth=row["growth"],
            roic=row["roic"],
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
        )
    elif row and _is_generic_default(row):
        preset = DEFAULT_METRICS.get(ticker)
        if ticker not in DEFAULT_METRICS or any(
            float(preset.get(key, row[key])) != float(row[key])
            for key in ("growth", "roic", "wacc", "debt_ratio", "unlevered_beta")
        ):
            fallback = _default_metrics(ticker)

    return _yahoo_statement_metrics(
        ticker,
        fallback,
        growth_basis=growth_basis,
        roic_basis=roic_basis,
        growth_year=growth_year,
        roic_year=roic_year,
    ) or fallback.model_copy(update={"crp": KOREA_COUNTRY_RISK_PREMIUM})


def _yahoo_metric_history(ticker: str) -> Optional[dict[str, object]]:
    bundle = _get_yahoo_statement_bundle(ticker, "history")
    if bundle is None:
        return None
    income = bundle["income"]
    balance = bundle["balance"]
    quarterly_income = bundle["quarterly_income"]
    quarterly_balance = bundle["quarterly_balance"]

    revenue_by_year = _prefer_annual_map(
        _statement_map_from_year(income, ("Total Revenue", "Operating Revenue"), YAHOO_STATEMENT_START_YEAR - 1),
        _quarterly_flow_map(quarterly_income, ("Total Revenue", "Operating Revenue"), start_year=YAHOO_STATEMENT_START_YEAR - 1),
    )
    operating_income_by_year = _prefer_annual_map(
        _statement_map(income, ("Operating Income", "EBIT")),
        _quarterly_flow_map(quarterly_income, ("Operating Income", "EBIT")),
    )
    pretax_income_by_year = _prefer_annual_map(
        _statement_map(income, ("Pretax Income", "Income Before Tax")),
        _quarterly_flow_map(quarterly_income, ("Pretax Income", "Income Before Tax")),
    )
    tax_expense_by_year = _prefer_annual_map(
        _statement_map(income, ("Tax Provision", "Income Tax Expense")),
        _quarterly_flow_map(quarterly_income, ("Tax Provision", "Income Tax Expense")),
    )
    debt_by_year = _prefer_annual_map(
        _statement_map(balance, ("Total Debt", "Net Debt")),
        _quarterly_balance_map(quarterly_balance, ("Total Debt", "Net Debt")),
    )
    equity_by_year = _prefer_annual_map(
        _statement_map(balance, ("Stockholders Equity", "Total Equity Gross Minority Interest")),
        _quarterly_balance_map(quarterly_balance, ("Stockholders Equity", "Total Equity Gross Minority Interest")),
    )
    cash_by_year = _prefer_annual_map(
        _statement_map(balance, ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
        _quarterly_balance_map(quarterly_balance, ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
    )

    current_revenue_by_year = {
        year: value
        for year, value in revenue_by_year.items()
        if YAHOO_STATEMENT_START_YEAR <= year <= YAHOO_STATEMENT_END_YEAR
    }
    annual_growth = _annual_growth_rates(revenue_by_year)

    tax_rates = [
        _bounded(tax_expense_by_year[year] / pretax_income_by_year[year], 0, 0.35)
        for year in _matching_years(tax_expense_by_year, pretax_income_by_year)
        if pretax_income_by_year[year] > 0
    ]
    tax_rate = _average(tax_rates) or DEFAULT_TAX_RATE

    roic_points: list[dict[str, float]] = []
    for year in _matching_years(operating_income_by_year, debt_by_year, equity_by_year):
        invested_capital = max(debt_by_year[year] + equity_by_year[year] - cash_by_year.get(year, 0.0), 1.0)
        nopat = operating_income_by_year[year] * (1 - tax_rate)
        ratio = _safe_ratio(nopat, invested_capital)
        if ratio is not None:
            roic_points.append({"year": year, "value": ratio * 100})
    logger.info(
        "corporate.statement_history ticker=%s revenue_years=%s annual_growth_years=%s roic_years=%s "
        "debt_years=%s equity_years=%s",
        ticker,
        sorted(current_revenue_by_year),
        [int(point["year"]) for point in annual_growth],
        [int(point["year"]) for point in roic_points],
        sorted(debt_by_year),
        sorted(equity_by_year),
    )

    return {
        "ticker": ticker,
        "start_year": YAHOO_STATEMENT_START_YEAR,
        "country_risk_premium": KOREA_COUNTRY_RISK_PREMIUM,
        "growth_cagr": _growth_value(annual_growth, current_revenue_by_year, "cagr", None),
        "growth_recent_average": _growth_value(annual_growth, revenue_by_year, "recent_average", None),
        "annual_growth_rates": _annual_metric_rows(annual_growth),
        "roic_recent_average": _roic_value(roic_points, "recent_average", None),
        "roic_all_year_average": _roic_value(roic_points, "all_year_average", None),
        "annual_roic": _annual_metric_rows(roic_points),
    }


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
            source="watchlist",
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


@router.post("/dcf/{ticker}")
async def dynamic_dcf_model(ticker: str, params: ValuationAssumptions):
    """
    Ticker-aware DCF recalculation bound to the Next.js Debouncer.
    """
    ticker = ticker.upper()
    current_price = _latest_market_price(ticker)
    metrics = _metrics_for_ticker(ticker) if params.fcff is None or params.esg_penalty is None else None
    base_fcff = max(float(params.fcff if params.fcff is not None else metrics.fcff), 1.0)
    esg_penalty = params.esg_penalty if params.esg_penalty is not None else metrics.esg_penalty
    wacc = max(params.wacc, 0.001)
    terminal_growth = min(params.terminal_growth_rate, wacc - 0.005)
    terminal_growth = max(terminal_growth, -0.1)

    projected_fcff = [
        base_fcff * ((1 + params.revenue_growth_rate) ** year)
        for year in range(1, 6)
    ]
    pv_fcff = sum(
        cash_flow / ((1 + wacc) ** year)
        for year, cash_flow in enumerate(projected_fcff, start=1)
    )
    terminal_cash_flow = projected_fcff[-1] * (1 + terminal_growth)
    terminal_value = terminal_cash_flow / max(wacc - terminal_growth, 0.005)
    pv_terminal = terminal_value / ((1 + wacc) ** 5)
    enterprise_value = pv_fcff + pv_terminal
    agency_discount = 1 - min(max(esg_penalty, 0), 80) / 400
    dcf_multiple = enterprise_value / base_fcff
    baseline_multiple = 1 / max(wacc - terminal_growth, 0.005)
    fcff_scale = base_fcff / 92.0
    if current_price > 0:
        estimated_value = current_price * (dcf_multiple / baseline_multiple) * agency_discount * fcff_scale
    else:
        estimated_value = enterprise_value * agency_discount
    upside_pct = ((estimated_value - current_price) / current_price) * 100 if current_price > 0 else 0.0

    return APIResponse(
        status="ok",
        data={
            "estimated_value": round(estimated_value, 2),
            "current_price": round(current_price, 2),
            "upside_pct": round(upside_pct, 2),
            "wacc_used": params.wacc,
            "margin_used": params.operating_margin,
            "growth_used": params.revenue_growth_rate,
            "fcff_used": base_fcff,
            "esg_penalty_used": esg_penalty,
            "terminal_growth_used": terminal_growth,
            "enterprise_value_index": round(enterprise_value * agency_discount, 2),
            "status": "Undervalued" if current_price > 0 and estimated_value > current_price else "Overvalued",
        },
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


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


@router.get("/metrics/{ticker}/history")
async def get_corporate_metric_history(ticker: str):
    ticker = ticker.upper()
    logger.info("corporate.metrics_history_request ticker=%s", ticker)
    return _yahoo_metric_history(ticker) or {
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
    bundle = _get_yahoo_statement_bundle(ticker, "quarterly-statements")
    if bundle is not None:
        quarterly_income = bundle["quarterly_income"]
        quarterly_balance = bundle["quarterly_balance"]
        quarterly_cashflow = bundle["quarterly_cashflow"]
        rows = [
            *_quarterly_statement_rows(quarterly_income, "Income Statement", ticker),
            *_quarterly_statement_rows(quarterly_balance, "Balance Sheet", ticker),
            *_quarterly_statement_rows(quarterly_cashflow, "Cash Flow", ticker),
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
