from __future__ import annotations

import sys
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional

from cachetools import TTLCache

from apps.api.core.logger import setup_logger
from apps.api.models.schemas import (
    CorporateDerivedMetricMeta,
    CorporateMetricAudit,
    CorporateMetricAuditEntry,
    CorporateMetricAuditInput,
    CorporateMetrics,
)
from packages.core_finance.corporate_statement_metrics import NumericRule

logger = setup_logger(__name__)

YAHOO_STATEMENT_START_YEAR = 2021
YAHOO_STATEMENT_END_YEAR = 2025
DEFAULT_RISK_FREE_RATE = 0.042
DEFAULT_EQUITY_RISK_PREMIUM = 0.055
KOREA_COUNTRY_RISK_PREMIUM = 0.8
YAHOO_STATEMENT_CACHE_TTL_SECONDS = int(os.getenv("MONEYVIEW_YAHOO_STATEMENT_CACHE_TTL_SECONDS", "300"))
YAHOO_STATEMENT_CACHE_MAXSIZE = int(os.getenv("MONEYVIEW_YAHOO_STATEMENT_CACHE_MAXSIZE", "48"))
_YAHOO_STATEMENT_CACHE = TTLCache(maxsize=YAHOO_STATEMENT_CACHE_MAXSIZE, ttl=YAHOO_STATEMENT_CACHE_TTL_SECONDS)


@dataclass(frozen=True)
class WaccAuditContext:
    market_cap: Optional[float]
    latest_debt: Optional[float]
    latest_equity: Optional[float]
    wacc_value: float


@dataclass(frozen=True)
class WaccAuditRule:
    name: str
    quality: str
    predicate: Callable[[WaccAuditContext], bool]
    message: str


WACC_SANITY_RULE = NumericRule("wacc_percent", 0.0, 40.0)


def _is_missing_market_cap(context: WaccAuditContext) -> bool:
    return context.market_cap is None


def _has_missing_capital_structure_inputs(context: WaccAuditContext) -> bool:
    return context.latest_debt is None or context.latest_equity is None


def _is_wacc_outside_sanity_range(context: WaccAuditContext) -> bool:
    return context.wacc_value <= WACC_SANITY_RULE.minimum or context.wacc_value > WACC_SANITY_RULE.maximum


WACC_WARNING_RULES = (
    WaccAuditRule(
        name="missing_market_cap",
        quality="estimated",
        predicate=_is_missing_market_cap,
        message="Market capitalization was unavailable, so debt and equity weights fall back to statement debt ratio.",
    ),
)

WACC_QUALITY_RULES = (
    WaccAuditRule(
        name="missing_capital_structure_inputs",
        quality="invalid",
        predicate=_has_missing_capital_structure_inputs,
        message="Debt or equity inputs are missing, so capital structure cannot be audited reliably.",
    ),
    WaccAuditRule(
        name="wacc_outside_sanity_range",
        quality="suspicious",
        predicate=_is_wacc_outside_sanity_range,
        message="WACC falls outside the expected sanity range.",
    ),
)


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


def get_yahoo_statement_bundle(ticker: str, endpoint: str) -> Optional[dict[str, object]]:
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
    except ImportError as exc:
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
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            logger.warning("corporate.statement_info_fetch_failed ticker=%s endpoint=%s error=%s", ticker, endpoint, exc)
            info = {}
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
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


def _statement_year_value_items(series, start_year: int = YAHOO_STATEMENT_START_YEAR):
    if series is None:
        return
    for date_index, raw in series.items():
        year = _safe_statement_year(date_index)
        value = _safe_number(raw)
        if year is None or year < start_year or year > YAHOO_STATEMENT_END_YEAR:
            continue
        if value is None or value == 0:
            continue
        yield date_index, year, value


def _safe_statement_year(date_index: object) -> Optional[int]:
    try:
        return int(getattr(date_index, "year", 0))
    except (TypeError, ValueError):
        return None


def _annual_statement_points(series, start_year: int = YAHOO_STATEMENT_START_YEAR) -> list[tuple[int, float]]:
    return [(year, value) for _, year, value in _statement_year_value_items(series, start_year)][-5:]


def _statement_map(frame, labels: tuple[str, ...]) -> dict[int, float]:
    return dict(_annual_statement_points(_statement_series(frame, labels)))


def _statement_map_from_year(frame, labels: tuple[str, ...], start_year: int) -> dict[int, float]:
    return dict(_annual_statement_points(_statement_series(frame, labels), start_year=start_year))


def _quarterly_flow_map(frame, labels: tuple[str, ...], start_year: int = YAHOO_STATEMENT_START_YEAR) -> dict[int, float]:
    series = _statement_series(frame, labels)
    by_year: dict[int, float] = {}
    for _, year, value in _statement_year_value_items(series, start_year):
        by_year[year] = by_year.get(year, 0.0) + value
    return by_year


def _quarterly_balance_map(frame, labels: tuple[str, ...], start_year: int = YAHOO_STATEMENT_START_YEAR) -> dict[int, float]:
    series = _statement_series(frame, labels)
    latest_by_year: dict[int, tuple[object, float]] = {}
    for date_index, year, value in _statement_year_value_items(series, start_year):
        previous = latest_by_year.get(year)
        if previous is None or date_index > previous[0]:
            latest_by_year[year] = (date_index, value)
    return {year: value for year, (_, value) in latest_by_year.items()}


def _prefer_annual_map(annual: dict[int, float], quarterly: dict[int, float]) -> dict[int, float]:
    combined = dict(quarterly)
    combined.update(annual)
    return combined


def _current_statement_years(values: dict[int, float]) -> dict[int, float]:
    return {
        year: value
        for year, value in values.items()
        if YAHOO_STATEMENT_START_YEAR <= year <= YAHOO_STATEMENT_END_YEAR
    }


def _average(values: list[float]) -> Optional[float]:
    clean = [value for value in values if value == value]
    return sum(clean) / len(clean) if clean else None


def _safe_number(value: object) -> Optional[float]:
    try:
        if value is None:
            return None
        numeric = float(value)
        if numeric != numeric or numeric in (float("inf"), float("-inf")):
            return None
        return numeric
    except (TypeError, ValueError):
        return None


def _safe_ratio(numerator: float, denominator: float) -> Optional[float]:
    if denominator == 0:
        return None
    return numerator / denominator


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _median(values: list[float]) -> Optional[float]:
    clean = sorted(value for value in values if value == value)
    if not clean:
        return None
    mid = len(clean) // 2
    if len(clean) % 2 == 1:
        return clean[mid]
    return (clean[mid - 1] + clean[mid]) / 2


def _latest_from_map(values: dict[int, float]) -> Optional[float]:
    if not values:
        return None
    return values[sorted(values)[-1]]


def _matching_years(*maps: dict[int, float]) -> list[int]:
    if not maps:
        return []
    return sorted(set.intersection(*(set(mapping) for mapping in maps)))[-5:]


def _stable_tax_result(pretax_income_by_year: dict[int, float], tax_expense_by_year: dict[int, float]) -> dict[str, object]:
    valid_rates: list[float] = []
    for year in _matching_years(pretax_income_by_year, tax_expense_by_year):
        pretax = _safe_number(pretax_income_by_year.get(year))
        tax = _safe_number(tax_expense_by_year.get(year))
        if pretax is None or tax is None or pretax <= 0:
            continue
        raw_rate = tax / pretax
        if raw_rate <= 0 or raw_rate > 0.50:
            continue
        valid_rates.append(raw_rate)
    median_rate = _median(valid_rates)
    if median_rate is None:
        return {
            "tax_rate": DEFAULT_TAX_RATE,
            "tax_rate_source": "fallback_default",
            "tax_rate_note": "No valid positive statement tax rate found.",
        }
    return {
        "tax_rate": _bounded(median_rate, MIN_TAX_RATE, MAX_TAX_RATE),
        "tax_rate_source": "median_valid_statement_tax_rate",
        "tax_rate_note": "Used median of positive valid tax rates, clamped to realistic range.",
    }


def _calculate_nopat(operating_income: Optional[float], tax_rate: float) -> dict[str, object]:
    op_income = _safe_number(operating_income)
    if op_income is None:
        return {"nopat": None, "nopat_note": "Missing operating income."}
    return {
        "nopat": op_income * (1 - tax_rate),
        "nopat_note": "NOPAT calculated from operating income after normalized tax.",
    }


def _calculate_invested_capital(equity: Optional[float], debt: Optional[float]) -> dict[str, object]:
    normalized_equity = _safe_number(equity)
    normalized_debt = _safe_number(debt) or 0.0
    if normalized_equity is None:
        return {
            "invested_capital": None,
            "invested_capital_note": "Missing total stockholder equity.",
        }
    invested_capital = normalized_equity + normalized_debt
    if invested_capital <= 0:
        return {
            "invested_capital": None,
            "invested_capital_note": "Invested capital is zero or negative.",
        }
    if invested_capital < MIN_INVESTED_CAPITAL:
        return {
            "invested_capital": None,
            "invested_capital_note": "Invested capital is too small; ROIC denominator unstable.",
        }
    return {
        "invested_capital": invested_capital,
        "invested_capital_note": "Invested capital calculated as equity plus interest-bearing debt.",
    }


def _average_invested_capital_result(
    current_equity: Optional[float],
    current_debt: Optional[float],
    previous_equity: Optional[float],
    previous_debt: Optional[float],
) -> dict[str, object]:
    current = _calculate_invested_capital(current_equity, current_debt)
    current_ic = current["invested_capital"]
    if current_ic is None:
        return {
            "invested_capital_ending": None,
            "invested_capital_beginning": None,
            "average_invested_capital": None,
            "average_ic_note": current["invested_capital_note"],
            "used_previous": False,
        }
    previous = _calculate_invested_capital(previous_equity, previous_debt)
    previous_ic = previous["invested_capital"]
    if previous_ic is None:
        return {
            "invested_capital_ending": current_ic,
            "invested_capital_beginning": None,
            "average_invested_capital": current_ic,
            "average_ic_note": "Previous invested capital unavailable; used current invested capital.",
            "used_previous": False,
        }
    return {
        "invested_capital_ending": current_ic,
        "invested_capital_beginning": previous_ic,
        "average_invested_capital": (current_ic + previous_ic) / 2,
        "average_ic_note": "Used average invested capital from current and previous year.",
        "used_previous": True,
    }


def _build_roic_records(
    *,
    operating_income_by_year: dict[int, float],
    pretax_income_by_year: dict[int, float],
    tax_expense_by_year: dict[int, float],
    debt_by_year: dict[int, float],
    equity_by_year: dict[int, float],
) -> dict[str, object]:
    tax_result = _stable_tax_result(pretax_income_by_year, tax_expense_by_year)
    tax_rate = float(tax_result["tax_rate"])
    roic_years = _matching_years(operating_income_by_year, debt_by_year, equity_by_year)
    roic_records: list[dict[str, float | int | None | str | bool]] = []
    roic_points: list[dict[str, float]] = []
    for year in roic_years:
        average_capital = _average_invested_capital_result(
            current_equity=equity_by_year.get(year),
            current_debt=debt_by_year.get(year),
            previous_equity=equity_by_year.get(year - 1),
            previous_debt=debt_by_year.get(year - 1),
        )
        nopat_result = _calculate_nopat(operating_income_by_year.get(year), tax_rate)
        nopat = nopat_result["nopat"]
        average_invested_capital = average_capital["average_invested_capital"]
        roic_decimal = _safe_ratio(nopat, average_invested_capital) if nopat is not None and average_invested_capital not in (None, 0) else None
        roic_percent = (roic_decimal * 100) if roic_decimal is not None else None
        if roic_percent is not None:
            roic_points.append({"year": year, "value": roic_percent})
        roic_records.append({
            "year": year,
            "operating_income": operating_income_by_year.get(year),
            "debt": debt_by_year.get(year),
            "equity": equity_by_year.get(year),
            "cash": None,
            "invested_capital_beginning": average_capital["invested_capital_beginning"],
            "invested_capital_ending": average_capital["invested_capital_ending"],
            "average_invested_capital": average_invested_capital,
            "average_invested_capital_note": average_capital["average_ic_note"],
            "used_previous_capital": bool(average_capital["used_previous"]),
            "nopat": nopat,
            "nopat_note": nopat_result["nopat_note"],
            "roic": roic_percent,
            "roic_decimal": roic_decimal,
        })
    return {
        "tax_result": tax_result,
        "roic_years": roic_years,
        "roic_records": roic_records,
        "roic_points": roic_points,
    }


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


def _valid_revenue_points(revenue_by_year: dict[int, float]) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    for year in sorted(revenue_by_year):
        if year < YAHOO_STATEMENT_START_YEAR or year > YAHOO_STATEMENT_END_YEAR:
            continue
        revenue = _safe_number(revenue_by_year.get(year))
        if revenue is None or revenue < MIN_REVENUE:
            continue
        rows.append({"year": year, "revenue": revenue})
    return rows


def _stable_growth_payload(revenue_by_year: dict[int, float]) -> dict[str, object]:
    revenue_points = _valid_revenue_points(revenue_by_year)
    sanitized_revenue = {int(row["year"]): float(row["revenue"]) for row in revenue_points}
    annual_growth = _annual_growth_rates(sanitized_revenue)
    first = revenue_points[0] if revenue_points else None
    last = revenue_points[-1] if revenue_points else None
    if first is None or last is None or len(revenue_points) < 2:
        return {
            "revenue_points": revenue_points,
            "annual_growth": annual_growth,
            "growth_cagr": None,
            "growth_recent_average": _average([point["value"] for point in annual_growth[-3:]]) if annual_growth else None,
            "growth_note": "Need at least two valid revenue years.",
        }
    periods = int(last["year"]) - int(first["year"])
    if periods <= 0:
        return {
            "revenue_points": revenue_points,
            "annual_growth": annual_growth,
            "growth_cagr": None,
            "growth_recent_average": _average([point["value"] for point in annual_growth[-3:]]) if annual_growth else None,
            "growth_note": "Invalid year range for CAGR.",
        }
    revenue_first = float(first["revenue"])
    revenue_last = float(last["revenue"])
    if revenue_first <= 0 or revenue_last <= 0:
        return {
            "revenue_points": revenue_points,
            "annual_growth": annual_growth,
            "growth_cagr": None,
            "growth_recent_average": _average([point["value"] for point in annual_growth[-3:]]) if annual_growth else None,
            "growth_note": "Revenue base must be positive.",
        }
    cagr = ((revenue_last / revenue_first) ** (1 / periods) - 1) * 100
    if cagr > MAX_GROWTH_CAGR * 100 or cagr < MIN_GROWTH_CAGR * 100:
        return {
            "revenue_points": revenue_points,
            "annual_growth": annual_growth,
            "growth_cagr": None,
            "growth_recent_average": _average([point["value"] for point in annual_growth[-3:]]) if annual_growth else None,
            "growth_note": "Growth CAGR exceeded sanity threshold.",
        }
    return {
        "revenue_points": revenue_points,
        "annual_growth": annual_growth,
        "growth_cagr": cagr,
        "growth_recent_average": _average([point["value"] for point in annual_growth[-3:]]) if annual_growth else None,
        "growth_note": "Growth calculated using revenue CAGR from available annual statements.",
    }


def _growth_value(
    rates: list[dict[str, float]],
    growth_cagr: Optional[float],
    growth_recent_average: Optional[float],
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
        return growth_recent_average
    return growth_cagr


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


def _assess_roic_quality(
    *,
    roic_records: list[dict[str, float | int | None | str | bool]],
    selected_roic_record: dict[str, float | int | None | str | bool] | None,
    roic_basis: str,
    tax_result: dict[str, object],
    derived_roic: Optional[float],
) -> dict[str, object]:
    warnings: list[str] = []
    reason = None
    quality = "ok"
    if not roic_records:
        quality = "missing"
        reason = "No overlapping Yahoo statement years were available to compute ROIC."
    else:
        selected_average_capital = (
            float(selected_roic_record["average_invested_capital"])
            if selected_roic_record and selected_roic_record["average_invested_capital"] is not None
            else None
        )
        if roic_basis != "annual":
            quality = "estimated"
            warnings.append(f"ROIC uses {roic_basis.replace('_', ' ')} rather than a single fiscal year.")
        if tax_result["tax_rate_source"] == "fallback_default":
            quality = "estimated"
            warnings.append(str(tax_result["tax_rate_note"]))
        if selected_roic_record and not bool(selected_roic_record["used_previous_capital"]):
            quality = "estimated" if quality == "ok" else quality
            warnings.append(str(selected_roic_record["average_invested_capital_note"]))
        if selected_average_capital is None:
            quality = "invalid"
            reason = str(selected_roic_record["average_invested_capital_note"]) if selected_roic_record else "Average invested capital is missing or non-positive."
        elif selected_average_capital <= 0:
            quality = "invalid"
            reason = "Average invested capital is missing or non-positive."
        elif selected_roic_record and selected_roic_record["nopat"] is not None:
            nopat_value = abs(float(selected_roic_record["nopat"]))
            if selected_average_capital < max(nopat_value * 0.1, 1.0):
                quality = "suspicious"
                reason = "Average invested capital is unusually small relative to NOPAT."
            elif derived_roic is not None and abs(float(derived_roic)) > MAX_ABS_ROIC * 100:
                quality = "suspicious"
                reason = "ROIC exceeds the configured sanity range."
        elif derived_roic is not None and abs(float(derived_roic)) > MAX_ABS_ROIC * 100:
            quality = "suspicious"
            reason = "ROIC exceeds the configured sanity range."
    if reason:
        warnings.append(reason)
    return {
        "quality": quality,
        "reason": reason,
        "warnings": warnings,
    }


from packages.core_finance.corporate_statement_metrics import (  # noqa: E402
    DEFAULT_TAX_RATE,
    MAX_ABS_ROIC,
    MAX_GROWTH_CAGR,
    MAX_TAX_RATE,
    MIN_GROWTH_CAGR,
    MIN_INVESTED_CAPITAL,
    MIN_REVENUE,
    MIN_TAX_RATE,
    assess_roic_quality as _assess_roic_quality,
    average as _average,
    average_invested_capital_result as _average_invested_capital_result,
    bounded as _bounded,
    build_roic_records as _build_roic_records,
    calculate_invested_capital as _calculate_invested_capital,
    calculate_nopat as _calculate_nopat,
    growth_value as _growth_value,
    matching_years as _matching_years,
    median as _median,
    roic_value as _roic_value,
    safe_number as _safe_number,
    safe_ratio as _safe_ratio,
    stable_growth_payload as _stable_growth_payload,
    stable_tax_result as _stable_tax_result,
)


def _annual_metric_rows(points: list[dict[str, float]]) -> list[dict[str, Optional[float]]]:
    by_year = {int(point["year"]): round(float(point["value"]), 2) for point in points}
    return [
        {"year": year, "value": by_year.get(year)}
        for year in range(YAHOO_STATEMENT_START_YEAR, YAHOO_STATEMENT_END_YEAR + 1)
    ]


def quarterly_statement_rows(frame, statement: str, ticker: str) -> list[dict[str, object]]:
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


def yahoo_statement_metrics(
    ticker: str,
    fallback: CorporateMetrics,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
    bundle_loader=get_yahoo_statement_bundle,
) -> Optional[CorporateMetrics]:
    bundle = bundle_loader(ticker, "metrics")
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
    capex_by_year = {
        year: abs(value)
        for year, value in _statement_map(cashflow, ("Capital Expenditure", "Capital Expenditures")).items()
    }
    depreciation_by_year = _statement_map(cashflow, ("Depreciation And Amortization", "Depreciation Amortization Depletion"))
    free_cash_flow_by_year = _statement_map(cashflow, ("Free Cash Flow",))
    research_development_by_year = _statement_map(income, ("Research And Development", "Research Development"))

    current_revenue_by_year = _current_statement_years(revenue_by_year)

    if len(revenue_by_year) < 2 or not current_revenue_by_year:
        logger.info(
            "corporate.statement_insufficient ticker=%s endpoint=metrics revenue_years=%s current_revenue_years=%s",
            ticker,
            sorted(revenue_by_year),
            sorted(current_revenue_by_year),
        )
        return None

    growth_payload = _stable_growth_payload(current_revenue_by_year)
    annual_growth = growth_payload["annual_growth"]
    derived_growth = _growth_value(
        annual_growth,
        growth_payload["growth_cagr"],
        growth_payload["growth_recent_average"],
        growth_basis,
        growth_year,
    )
    latest_growth_year = int(growth_payload["revenue_points"][-1]["year"]) if growth_payload["revenue_points"] else None
    growth_as_of = f"{latest_growth_year}-12-31" if latest_growth_year is not None else None
    has_stable_growth_cagr = _has_stable_growth_cagr(growth_payload)
    growth_quality = "ok" if has_stable_growth_cagr else "invalid"
    growth_reason = None if has_stable_growth_cagr else str(growth_payload["growth_note"])
    growth_warnings = [str(growth_payload["growth_note"])] if growth_reason else []
    growth_metric_role = "primary" if has_stable_growth_cagr else "fallback"
    growth_source = "Stable CAGR from valid Yahoo annual revenue values"
    growth_output = derived_growth if has_stable_growth_cagr and derived_growth is not None else float(fallback.growth)
    growth_meta = _derived_metric_meta(
        method="stable_cagr",
        quality=growth_quality,
        reason=growth_reason,
        warnings=growth_warnings,
        confidence=_metric_confidence(growth_quality, growth_metric_role),
        source=growth_source if growth_metric_role == "primary" else "Fallback growth assumption because stable CAGR was unavailable or invalid.",
        calculation_version="growth_v2_stable_cagr",
        metric_role=growth_metric_role,
        as_of=growth_as_of,
    )

    roic_payload = _build_roic_records(
        operating_income_by_year=operating_income_by_year,
        pretax_income_by_year=pretax_income_by_year,
        tax_expense_by_year=tax_expense_by_year,
        debt_by_year=debt_by_year,
        equity_by_year=equity_by_year,
    )
    tax_rate = float(roic_payload["tax_result"]["tax_rate"])
    roic_points = roic_payload["roic_points"]
    nopat_by_year = {
        int(record["year"]): float(record["nopat"])
        for record in roic_payload["roic_records"]
        if record["nopat"] is not None
    }
    derived_roic = _roic_value(roic_points, roic_basis, roic_year)
    selected_roic_record = None
    if roic_basis == "annual" and roic_year is not None:
        selected_roic_record = next((record for record in roic_payload["roic_records"] if int(record["year"]) == roic_year), None)
    if selected_roic_record is None and roic_payload["roic_records"]:
        selected_roic_record = roic_payload["roic_records"][-1] if roic_basis == "annual" else roic_payload["roic_records"][-1]
    roic_assessment = _assess_roic_quality(
        roic_records=roic_payload["roic_records"],
        selected_roic_record=selected_roic_record,
        roic_basis=roic_basis,
        tax_result=roic_payload["tax_result"],
        derived_roic=derived_roic,
    )
    roic_quality = str(roic_assessment["quality"])
    roic_reason = _metric_reason(roic_assessment["reason"])
    roic_warnings = list(roic_assessment["warnings"])
    latest_roic_year = sorted(roic_payload["roic_years"])[-1] if roic_payload["roic_years"] else None
    roic_as_of = f"{latest_roic_year}-12-31" if latest_roic_year is not None else None
    roic_metric_role = "primary" if _is_decision_grade_roic(roic_quality, derived_roic) else "fallback"
    roic_output = float(derived_roic) if roic_metric_role == "primary" and derived_roic is not None else float(fallback.roic)
    roic_meta = _derived_metric_meta(
        method="stable_invested_capital",
        quality=roic_quality,
        reason=roic_reason,
        warnings=roic_warnings,
        confidence=_metric_confidence(roic_quality, roic_metric_role),
        source="Stable ROIC from NOPAT over average invested capital" if roic_metric_role == "primary" else "Fallback ROIC assumption because stable ROIC was not decision-grade.",
        calculation_version="roic_v3_stable_invested_capital",
        metric_role=roic_metric_role,
        as_of=roic_as_of,
    )

    latest_debt = _latest_from_map(debt_by_year)
    latest_equity = _latest_from_map(equity_by_year)
    latest_debt_ratio = _bounded(latest_debt / (latest_debt + latest_equity) * 100, 0, 90) if _has_valid_capital_ratio_inputs(latest_debt, latest_equity) else None
    debt_ratio = latest_debt_ratio

    reinvestment_values = [
        _bounded(ratio * 100, 0, 100)
        for year in _matching_years(capex_by_year, depreciation_by_year)
        if (nopat := nopat_by_year.get(year)) is not None
        if (ratio := _safe_ratio(max(capex_by_year[year] - depreciation_by_year[year], 0), nopat)) is not None
    ]
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

    debt_to_equity = _statement_debt_to_equity(latest_debt=latest_debt, latest_equity=latest_equity, fallback=fallback)
    levered_beta = float(info.get("beta") or fallback.unlevered_beta * (1 + (1 - tax_rate) * debt_to_equity))
    unlevered_beta = _bounded(levered_beta / (1 + (1 - tax_rate) * debt_to_equity), 0.4, 3.0)

    latest_interest = _latest_from_map(interest_expense_by_year) or 0
    cost_of_debt = min(max((latest_interest / latest_debt) if _has_positive_debt_balance(latest_debt) else 0.045, 0.01), 0.15)
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
        [int(point["year"]) for point in growth_payload["revenue_points"]],
        [int(point["year"]) for point in annual_growth],
        [int(point["year"]) for point in roic_points],
        sorted(debt_by_year),
        sorted(equity_by_year),
        round(growth_output, 4) if growth_output is not None else None,
        round(roic_output, 4) if roic_output is not None else None,
        round(debt_ratio, 4) if debt_ratio is not None else None,
        round(wacc, 4),
    )

    return CorporateMetrics(
        ticker=ticker,
        growth=round(growth_output, 2),
        growth_avg_legacy=round(growth_payload["growth_recent_average"], 2) if growth_payload["growth_recent_average"] is not None else None,
        growth_cagr_v2=round(growth_payload["growth_cagr"], 2) if growth_payload["growth_cagr"] is not None else None,
        roic=round(roic_output, 2),
        roic_legacy=round(float(fallback.roic), 2),
        roic_stable_v2=round(float(derived_roic), 2) if derived_roic is not None else None,
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
        growth_meta=growth_meta,
        roic_meta=roic_meta,
    )


def _display_number(value: Optional[float], suffix: str = "", precision: int = 2) -> str:
    if value is None:
        return "Unavailable"
    return f"{value:.{precision}f}{suffix}"


def _display_percent(value: Optional[float], precision: int = 1) -> str:
    if value is None:
        return "N/A"
    return f"{value:.{precision}f}%"


def _display_money(value: Optional[float]) -> str:
    if value is None:
        return "Unavailable"
    return f"${value:,.0f}"


def _quality_rank(value: str) -> int:
    order = {
        "ok": 0,
        "estimated": 1,
        "stale": 2,
        "suspicious": 3,
        "invalid": 4,
        "missing": 5,
    }
    return order.get(value, 5)


def _pick_worst_quality(*values: str) -> str:
    return max(values, key=_quality_rank) if values else "missing"


def _metric_confidence(quality: str, metric_role: str) -> float:
    base = {
        "ok": 0.98,
        "estimated": 0.84,
        "stale": 0.72,
        "suspicious": 0.45,
        "invalid": 0.2,
        "missing": 0.05,
    }.get(quality, 0.05)
    role_adjustment = {
        "primary": 0.0,
        "supporting": -0.08,
        "fallback": -0.22,
    }.get(metric_role, -0.1)
    return round(min(max(base + role_adjustment, 0.0), 1.0), 2)


def _assess_wacc_quality(
    *,
    market_cap: Optional[float],
    latest_debt: Optional[float],
    latest_equity: Optional[float],
    wacc_value: float,
) -> dict[str, object]:
    context = WaccAuditContext(
        market_cap=market_cap,
        latest_debt=latest_debt,
        latest_equity=latest_equity,
        wacc_value=wacc_value,
    )
    warnings: list[str] = []
    quality = "ok"
    for warning_rule in WACC_WARNING_RULES:
        if warning_rule.predicate(context):
            quality = warning_rule.quality
            warnings.append(warning_rule.message)

    matched_rule = next((rule for rule in WACC_QUALITY_RULES if rule.predicate(context)), None)
    reason = matched_rule.message if matched_rule is not None else None
    if matched_rule is not None:
        quality = matched_rule.quality
        warnings.append(reason)
    return {"quality": quality, "reason": reason, "warnings": warnings}


def _derived_metric_meta(
    *,
    method: str,
    quality: str,
    reason: str | None,
    warnings: list[str],
    confidence: float,
    source: str,
    calculation_version: str,
    metric_role: str,
    as_of: str | None,
) -> CorporateDerivedMetricMeta:
    return CorporateDerivedMetricMeta(
        method=method,
        quality=quality,
        reason=reason,
        warnings=warnings,
        confidence=confidence,
        source=source,
        calculation_version=calculation_version,
        metric_role=metric_role,
        as_of=as_of,
    )


def _audit_input(
    *,
    field: str,
    label: str,
    value: Optional[float],
    display_value: str,
    source: str,
) -> CorporateMetricAuditInput:
    return CorporateMetricAuditInput(
        field=field,
        label=label,
        value=value,
        display_value=display_value,
        source=source,
    )


def _select_roic_record(
    roic_records: list[dict[str, float | int | None | str | bool]],
    *,
    roic_basis: str,
    roic_year: Optional[int],
) -> dict[str, float | int | None | str | bool] | None:
    if not roic_records:
        return None
    if roic_basis != "annual" or roic_year is None:
        return roic_records[-1]
    return next((record for record in roic_records if int(record["year"]) == roic_year), roic_records[-1])


def _roic_value_for_basis(
    roic_records: list[dict[str, float | int | None | str | bool]],
    selected_roic_record: dict[str, float | int | None | str | bool] | None,
    *,
    roic_basis: str,
) -> Optional[float]:
    roic_values = [float(record["roic"]) for record in roic_records if record["roic"] is not None]
    if roic_basis == "all_year_average":
        return _average(roic_values)
    if roic_basis != "annual":
        return _average(roic_values[-3:])
    if selected_roic_record is None:
        return None
    return selected_roic_record["roic"]  # type: ignore[return-value]


def _statement_debt_ratio(
    *,
    latest_debt: Optional[float],
    latest_equity: Optional[float],
    fallback: CorporateMetrics,
) -> float:
    if not _has_valid_capital_ratio_inputs(latest_debt, latest_equity):
        return max(float(fallback.debt_ratio) / 100, 0.0)
    return _bounded(latest_debt / (latest_debt + latest_equity), 0, 0.9)


def _has_valid_capital_ratio_inputs(latest_debt: Optional[float], latest_equity: Optional[float]) -> bool:
    if latest_debt is None or latest_equity is None:
        return False
    return latest_debt + latest_equity != 0


def _has_valid_debt_to_equity_inputs(latest_debt: Optional[float], latest_equity: Optional[float]) -> bool:
    return latest_debt is not None and latest_equity is not None and latest_equity != 0


def _has_positive_debt_balance(latest_debt: Optional[float]) -> bool:
    return latest_debt is not None and latest_debt > 0


def _statement_debt_to_equity(
    *,
    latest_debt: Optional[float],
    latest_equity: Optional[float],
    fallback: CorporateMetrics,
) -> float:
    if not _has_valid_debt_to_equity_inputs(latest_debt, latest_equity):
        return max(float(fallback.debt_ratio) / max(100 - float(fallback.debt_ratio), 1), 0.0)
    return latest_debt / latest_equity


def _capital_weights(
    *,
    market_cap: Optional[float],
    latest_debt: Optional[float],
    debt_ratio: float,
) -> tuple[float, float]:
    if market_cap is None or latest_debt is None:
        return debt_ratio, 1 - debt_ratio
    if market_cap + latest_debt <= 0:
        return debt_ratio, 1 - debt_ratio
    return latest_debt / (market_cap + latest_debt), market_cap / (market_cap + latest_debt)


def _record_value(
    record: dict[str, float | int | None | str | bool] | None,
    field: str,
) -> Optional[float]:
    if record is None:
        return None
    value = record[field]
    if value is None:
        return None
    return float(value)


def _record_money_display(
    record: dict[str, float | int | None | str | bool] | None,
    field: str,
) -> str:
    value = _record_value(record, field)
    if value is None:
        return "Unavailable"
    return _display_money(value)


def _metric_reason(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _has_stable_growth_cagr(growth_payload: dict[str, object]) -> bool:
    return growth_payload["growth_cagr"] is not None


def _is_decision_grade_roic(roic_quality: str, roic_value: Optional[float]) -> bool:
    return roic_quality in {"ok", "estimated"} and roic_value is not None


def _fallback_metric_audit(
    ticker: str,
    metrics: CorporateMetrics,
    *,
    source_mode: str,
    source_label: str,
) -> CorporateMetricAudit:
    generated_at = datetime.now(timezone.utc).isoformat()
    roic_quality = "estimated" if source_mode != "unavailable" else "missing"
    wacc_quality = "estimated" if source_mode != "unavailable" else "missing"
    roic_reason = (
        "Yahoo statement inputs were unavailable, so the UI is using saved or deterministic fallback assumptions."
        if source_mode != "unavailable"
        else "No auditable ROIC source is available for this ticker."
    )
    wacc_reason = (
        "Yahoo statement inputs were unavailable, so the UI is using saved or deterministic fallback assumptions."
        if source_mode != "unavailable"
        else "No auditable WACC source is available for this ticker."
    )
    roic_warnings = [roic_reason] if roic_reason else []
    wacc_warnings = [wacc_reason] if wacc_reason else []
    spread_value = float(metrics.roic) - float(metrics.wacc)
    spread_quality = _pick_worst_quality(roic_quality, wacc_quality)
    growth_quality = "estimated" if source_mode != "unavailable" else "missing"
    growth_reason = (
        "Yahoo statement inputs were unavailable, so the UI is using saved or deterministic fallback assumptions."
        if source_mode != "unavailable"
        else "No auditable growth source is available for this ticker."
    )
    growth_warnings = [growth_reason] if growth_reason else []
    growth_dcf_placeholder = CorporateMetricAuditEntry(
        value=None,
        display_value="Unavailable",
        method="dcf_summary_placeholder",
        quality="missing",
        reason="DCF audit is loaded from the DCF report endpoint.",
        warnings=["Use the DCF report endpoint for valuation audit inputs."],
        confidence=0.0,
        inputs_used=[],
        source="Deferred to /corporate/dcf/{ticker}/report",
        as_of=None,
        calculation_version="dcf_v1_summary_placeholder",
    )
    return CorporateMetricAudit(
        ticker=ticker,
        source_mode=source_mode,
        generated_at=generated_at,
        growth=CorporateMetricAuditEntry(
            value=float(metrics.growth),
            display_value=_display_percent(float(metrics.growth)),
            method="fallback_growth_assumption",
            quality=growth_quality,
            reason=growth_reason,
            warnings=growth_warnings,
            confidence=_metric_confidence(growth_quality, "fallback"),
            inputs_used=[
                _audit_input(
                    field="final_growth_value",
                    label="Final growth value",
                    value=float(metrics.growth),
                    display_value=_display_percent(float(metrics.growth)),
                    source=source_label,
                )
            ],
            source=source_label,
            as_of=None,
            calculation_version="growth_v2_stable_cagr",
        ),
        roic=CorporateMetricAuditEntry(
            value=float(metrics.roic),
            display_value=_display_percent(float(metrics.roic)),
            method="stable_invested_capital",
            quality=roic_quality,
            reason=roic_reason,
            warnings=roic_warnings,
            confidence=_metric_confidence(roic_quality, "fallback"),
            inputs_used=[
                _audit_input(
                    field="final_roic_value",
                    label="Final ROIC value",
                    value=float(metrics.roic),
                    display_value=_display_percent(float(metrics.roic)),
                    source=source_label,
                )
            ],
            source=source_label,
            as_of=None,
            calculation_version="roic_v3_stable_invested_capital",
        ),
        wacc=CorporateMetricAuditEntry(
            value=float(metrics.wacc),
            display_value=_display_percent(float(metrics.wacc)),
            method="latest_capital_structure",
            quality=wacc_quality,
            reason=wacc_reason,
            warnings=wacc_warnings,
            confidence=_metric_confidence(wacc_quality, "fallback"),
            inputs_used=[
                _audit_input(
                    field="final_wacc_value",
                    label="Final WACC value",
                    value=float(metrics.wacc),
                    display_value=_display_percent(float(metrics.wacc)),
                    source=source_label,
                )
            ],
            source=source_label,
            as_of=None,
            calculation_version="wacc_v2_latest_capital_structure",
        ),
        spread=CorporateMetricAuditEntry(
            value=round(spread_value, 2),
            display_value=_display_percent(round(spread_value, 2)),
            method="roic_minus_wacc",
            quality=spread_quality,
            reason="Spread inherits the lower-confidence state of ROIC and WACC." if spread_quality != "ok" else None,
            warnings=[
                "ROIC - WACC inherits the lower-confidence state of the two source metrics."
            ] if spread_quality != "ok" else [],
            confidence=_metric_confidence(spread_quality, "fallback"),
            inputs_used=[
                _audit_input(
                    field="roic",
                    label="ROIC",
                    value=float(metrics.roic),
                    display_value=_display_percent(float(metrics.roic)),
                    source=source_label,
                ),
                _audit_input(
                    field="wacc",
                    label="WACC",
                    value=float(metrics.wacc),
                    display_value=_display_percent(float(metrics.wacc)),
                    source=source_label,
                ),
            ],
            source=source_label,
            as_of=None,
            calculation_version="spread_v1_roic_minus_wacc",
        ),
        dcf=growth_dcf_placeholder,
    )


def metric_audit_for_ticker(
    ticker: str,
    fallback: CorporateMetrics,
    *,
    has_saved_metrics: bool,
    roic_basis: str = "recent_average",
    roic_year: Optional[int] = None,
    bundle_loader=get_yahoo_statement_bundle,
) -> CorporateMetricAudit:
    ticker = ticker.upper()
    bundle = bundle_loader(ticker, "audit")
    if bundle is None:
        if has_saved_metrics:
            return _fallback_metric_audit(
                ticker,
                fallback,
                source_mode="corporate_metrics",
                source_label="SQLite corporate_metrics fallback",
            )
        return _fallback_metric_audit(
            ticker,
            fallback,
            source_mode="default_model",
            source_label="Deterministic default model fallback",
        )

    income = bundle["income"]
    balance = bundle["balance"]
    quarterly_income = bundle["quarterly_income"]
    quarterly_balance = bundle["quarterly_balance"]
    info = bundle["info"]
    revenue_by_year = _prefer_annual_map(
        _statement_map_from_year(income, ("Total Revenue", "Operating Revenue"), YAHOO_STATEMENT_START_YEAR - 1),
        _quarterly_flow_map(quarterly_income, ("Total Revenue", "Operating Revenue"), start_year=YAHOO_STATEMENT_START_YEAR - 1),
    )
    current_revenue_by_year = _current_statement_years(revenue_by_year)
    growth_payload = _stable_growth_payload(current_revenue_by_year)
    annual_growth = growth_payload["annual_growth"]

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
    roic_payload = _build_roic_records(
        operating_income_by_year=operating_income_by_year,
        pretax_income_by_year=pretax_income_by_year,
        tax_expense_by_year=tax_expense_by_year,
        debt_by_year=debt_by_year,
        equity_by_year=equity_by_year,
    )
    tax_result = roic_payload["tax_result"]
    tax_rate = float(tax_result["tax_rate"])
    roic_years = roic_payload["roic_years"]
    roic_records = roic_payload["roic_records"]

    selected_roic_record = _select_roic_record(roic_records, roic_basis=roic_basis, roic_year=roic_year)
    roic_value = _roic_value_for_basis(roic_records, selected_roic_record, roic_basis=roic_basis)

    latest_year = sorted(roic_years)[-1] if roic_years else None
    latest_debt = _latest_from_map(debt_by_year)
    latest_equity = _latest_from_map(equity_by_year)
    latest_interest = _latest_from_map(interest_expense_by_year) or 0.0
    debt_ratio = _statement_debt_ratio(latest_debt=latest_debt, latest_equity=latest_equity, fallback=fallback)
    debt_to_equity = _statement_debt_to_equity(latest_debt=latest_debt, latest_equity=latest_equity, fallback=fallback)
    levered_beta = float(info.get("beta") or fallback.unlevered_beta * (1 + (1 - tax_rate) * debt_to_equity))
    cost_of_debt = min(max((latest_interest / latest_debt) if _has_positive_debt_balance(latest_debt) else 0.045, 0.01), 0.15)
    cost_of_equity = DEFAULT_RISK_FREE_RATE + levered_beta * DEFAULT_EQUITY_RISK_PREMIUM + KOREA_COUNTRY_RISK_PREMIUM / 100
    market_cap = float(info.get("marketCap") or 0.0) or None
    debt_weight, equity_weight = _capital_weights(
        market_cap=market_cap,
        latest_debt=latest_debt,
        debt_ratio=debt_ratio,
    )
    wacc_value = (equity_weight * cost_of_equity + debt_weight * cost_of_debt * (1 - tax_rate)) * 100

    latest_growth_year = int(growth_payload["revenue_points"][-1]["year"]) if growth_payload["revenue_points"] else None
    growth_as_of = f"{latest_growth_year}-12-31" if latest_growth_year is not None else None
    has_stable_growth_cagr = _has_stable_growth_cagr(growth_payload)
    growth_quality = "ok" if has_stable_growth_cagr else "invalid"
    growth_reason = None if has_stable_growth_cagr else str(growth_payload["growth_note"])
    growth_metric_role = "primary" if has_stable_growth_cagr else "fallback"
    growth_confidence = _metric_confidence(growth_quality, growth_metric_role)
    growth_value = float(growth_payload["growth_cagr"]) if has_stable_growth_cagr else float(fallback.growth)
    dcf_placeholder = CorporateMetricAuditEntry(
        value=None,
        display_value="Unavailable",
        method="dcf_summary_placeholder",
        quality="missing",
        reason="DCF audit is loaded from the DCF report endpoint.",
        warnings=["Use the DCF report endpoint for valuation audit inputs."],
        confidence=0.0,
        inputs_used=[],
        source="Deferred to /corporate/dcf/{ticker}/report",
        as_of=None,
        calculation_version="dcf_v1_summary_placeholder",
    )

    roic_assessment = _assess_roic_quality(
        roic_records=roic_records,
        selected_roic_record=selected_roic_record,
        roic_basis=roic_basis,
        tax_result=tax_result,
        derived_roic=roic_value,
    )
    roic_quality = str(roic_assessment["quality"])
    roic_reason = _metric_reason(roic_assessment["reason"])
    roic_warnings = list(roic_assessment["warnings"])

    wacc_assessment = _assess_wacc_quality(
        market_cap=market_cap,
        latest_debt=latest_debt,
        latest_equity=latest_equity,
        wacc_value=wacc_value,
    )
    wacc_quality = str(wacc_assessment["quality"])
    wacc_reason = _metric_reason(wacc_assessment["reason"])
    wacc_warnings = list(wacc_assessment["warnings"])

    source_as_of = f"{latest_year}-12-31" if latest_year is not None else None
    roic_source = "Yahoo Finance annual or quarterly statement bundle"
    wacc_source = "Yahoo Finance statement bundle plus market profile"
    spread_value = round((float(roic_value) if roic_value is not None else fallback.roic) - wacc_value, 2)
    spread_quality = _pick_worst_quality(roic_quality, wacc_quality)

    return CorporateMetricAudit(
        ticker=ticker,
        source_mode="yahoo_finance",
        generated_at=datetime.now(timezone.utc).isoformat(),
        growth=CorporateMetricAuditEntry(
            value=round(growth_value, 2),
            display_value=_display_percent(round(growth_value, 2)),
            method="stable_cagr",
            quality=growth_quality,
            reason=growth_reason,
            warnings=[str(growth_payload["growth_note"])] if growth_reason else [],
            confidence=growth_confidence,
            inputs_used=[
                _audit_input(
                    field="final_growth_value",
                    label="Final growth value",
                    value=round(growth_value, 2),
                    display_value=_display_percent(round(growth_value, 2)),
                    source="Stable CAGR from Yahoo annual revenue values",
                ),
                _audit_input(
                    field="growth_recent_average",
                    label="Recent average growth",
                    value=round(float(growth_payload["growth_recent_average"]), 2) if growth_payload["growth_recent_average"] is not None else None,
                    display_value=_display_percent(round(float(growth_payload["growth_recent_average"]), 2)) if growth_payload["growth_recent_average"] is not None else "Unavailable",
                    source="Supporting annual YoY context",
                ),
            ],
            source="Stable CAGR from Yahoo annual revenue values",
            as_of=growth_as_of,
            calculation_version="growth_v2_stable_cagr",
        ),
        roic=CorporateMetricAuditEntry(
            value=round(float(roic_value), 2) if roic_value is not None else None,
            display_value=_display_percent(round(float(roic_value), 2), precision=1) if roic_value is not None else "N/A",
            method="stable_invested_capital",
            quality=roic_quality,
            reason=roic_reason,
            warnings=roic_warnings,
            confidence=_metric_confidence(roic_quality, "primary" if _is_decision_grade_roic(roic_quality, roic_value) else "fallback"),
            inputs_used=[
                _audit_input(
                    field="operating_income",
                    label="Operating income / EBIT",
                    value=_record_value(selected_roic_record, "operating_income"),
                    display_value=_record_money_display(selected_roic_record, "operating_income"),
                    source=roic_source,
                ),
                _audit_input(field="tax_rate", label="Tax rate", value=round(tax_rate, 6), display_value=_display_percent(tax_rate * 100), source=str(tax_result["tax_rate_source"])),
                _audit_input(
                    field="nopat",
                    label="NOPAT",
                    value=_record_value(selected_roic_record, "nopat"),
                    display_value=_record_money_display(selected_roic_record, "nopat"),
                    source=roic_source,
                ),
                _audit_input(field="total_debt", label="Total debt", value=latest_debt, display_value=_display_money(latest_debt), source=roic_source),
                _audit_input(field="total_equity", label="Total equity", value=latest_equity, display_value=_display_money(latest_equity), source=roic_source),
                _audit_input(
                    field="invested_capital",
                    label="Invested capital",
                    value=_record_value(selected_roic_record, "invested_capital_ending"),
                    display_value=_record_money_display(selected_roic_record, "invested_capital_ending"),
                    source=roic_source,
                ),
                _audit_input(
                    field="invested_capital_beginning",
                    label="Beginning invested capital",
                    value=_record_value(selected_roic_record, "invested_capital_beginning"),
                    display_value=_record_money_display(selected_roic_record, "invested_capital_beginning"),
                    source=roic_source,
                ),
                _audit_input(
                    field="invested_capital_ending",
                    label="Ending invested capital",
                    value=_record_value(selected_roic_record, "invested_capital_ending"),
                    display_value=_record_money_display(selected_roic_record, "invested_capital_ending"),
                    source=roic_source,
                ),
                _audit_input(
                    field="average_invested_capital",
                    label="Average invested capital",
                    value=_record_value(selected_roic_record, "average_invested_capital"),
                    display_value=_record_money_display(selected_roic_record, "average_invested_capital"),
                    source=roic_source,
                ),
                _audit_input(field="final_roic_value", label="Final ROIC value", value=round(float(roic_value), 2) if roic_value is not None else None, display_value=_display_percent(round(float(roic_value), 2), precision=1) if roic_value is not None else "N/A", source=f"Computed from {roic_basis} basis"),
            ],
            source=roic_source,
            as_of=source_as_of,
            calculation_version="roic_v3_stable_invested_capital",
        ),
        wacc=CorporateMetricAuditEntry(
            value=round(float(wacc_value), 2),
            display_value=_display_percent(round(float(wacc_value), 2), precision=1),
            method="latest_capital_structure",
            quality=wacc_quality,
            reason=wacc_reason,
            warnings=wacc_warnings,
            confidence=_metric_confidence(wacc_quality, "supporting"),
            inputs_used=[
                _audit_input(field="risk_free_rate", label="Risk-free rate", value=round(DEFAULT_RISK_FREE_RATE, 6), display_value=_display_percent(DEFAULT_RISK_FREE_RATE * 100), source="Model policy input"),
                _audit_input(field="beta", label="Beta", value=round(levered_beta, 6), display_value=_display_number(round(levered_beta, 6), precision=2), source=wacc_source),
                _audit_input(field="equity_risk_premium", label="Equity risk premium", value=round(DEFAULT_EQUITY_RISK_PREMIUM, 6), display_value=_display_percent(DEFAULT_EQUITY_RISK_PREMIUM * 100), source="Model policy input"),
                _audit_input(field="country_risk_premium", label="Country risk premium", value=round(KOREA_COUNTRY_RISK_PREMIUM / 100, 6), display_value=_display_percent(KOREA_COUNTRY_RISK_PREMIUM), source="Model policy input"),
                _audit_input(field="cost_of_equity", label="Cost of equity", value=round(cost_of_equity, 6), display_value=_display_percent(cost_of_equity * 100), source="Risk-free rate + beta x ERP + CRP"),
                _audit_input(field="total_debt", label="Total debt", value=latest_debt, display_value=_display_money(latest_debt), source=wacc_source),
                _audit_input(field="market_cap", label="Market cap", value=market_cap, display_value=_display_money(market_cap), source="Yahoo Finance company profile"),
                _audit_input(field="debt_weight", label="Debt weight", value=round(debt_weight, 6), display_value=_display_percent(debt_weight * 100), source="Capital structure mix"),
                _audit_input(field="equity_weight", label="Equity weight", value=round(equity_weight, 6), display_value=_display_percent(equity_weight * 100), source="Capital structure mix"),
                _audit_input(field="cost_of_debt", label="Cost of debt", value=round(cost_of_debt, 6), display_value=_display_percent(cost_of_debt * 100), source="Interest expense / debt balance"),
                _audit_input(field="tax_rate", label="Tax rate", value=round(tax_rate, 6), display_value=_display_percent(tax_rate * 100), source=str(tax_result["tax_rate_source"])),
                _audit_input(field="final_wacc_value", label="Final WACC value", value=round(float(wacc_value), 2), display_value=_display_percent(round(float(wacc_value), 2), precision=1), source="Weighted capital costs"),
            ],
            source=wacc_source,
            as_of=source_as_of,
            calculation_version="wacc_v2_latest_capital_structure",
        ),
        spread=CorporateMetricAuditEntry(
            value=spread_value,
            display_value=_display_percent(spread_value, precision=1),
            method="roic_minus_wacc",
            quality=spread_quality,
            reason="ROIC - WACC inherits the lower-confidence state of the two source metrics." if spread_quality != "ok" else None,
            warnings=[
                "ROIC - WACC inherits the lower-confidence state of ROIC and WACC."
            ] if spread_quality != "ok" else [],
            confidence=_metric_confidence(spread_quality, "supporting"),
            inputs_used=[
                _audit_input(field="roic", label="ROIC", value=round(float(roic_value), 2) if roic_value is not None else None, display_value=_display_percent(round(float(roic_value), 2), precision=1) if roic_value is not None else "N/A", source=roic_source),
                _audit_input(field="wacc", label="WACC", value=round(float(wacc_value), 2), display_value=_display_percent(round(float(wacc_value), 2), precision=1), source=wacc_source),
            ],
            source="Derived spread",
            as_of=source_as_of,
            calculation_version="spread_v1_roic_minus_wacc",
        ),
        dcf=dcf_placeholder,
    )


def yahoo_metric_history(ticker: str, bundle_loader=get_yahoo_statement_bundle) -> Optional[dict[str, object]]:
    bundle = bundle_loader(ticker, "history")
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
    current_revenue_by_year = {
        year: value
        for year, value in revenue_by_year.items()
        if YAHOO_STATEMENT_START_YEAR <= year <= YAHOO_STATEMENT_END_YEAR
    }
    growth_payload = _stable_growth_payload(current_revenue_by_year)
    annual_growth = growth_payload["annual_growth"]

    roic_payload = _build_roic_records(
        operating_income_by_year=operating_income_by_year,
        pretax_income_by_year=pretax_income_by_year,
        tax_expense_by_year=tax_expense_by_year,
        debt_by_year=debt_by_year,
        equity_by_year=equity_by_year,
    )
    roic_points = roic_payload["roic_points"]
    logger.info(
        "corporate.statement_history ticker=%s revenue_years=%s annual_growth_years=%s roic_years=%s "
        "debt_years=%s equity_years=%s",
        ticker,
        [int(point["year"]) for point in growth_payload["revenue_points"]],
        [int(point["year"]) for point in annual_growth],
        [int(point["year"]) for point in roic_points],
        sorted(debt_by_year),
        sorted(equity_by_year),
    )

    return {
        "ticker": ticker,
        "start_year": YAHOO_STATEMENT_START_YEAR,
        "country_risk_premium": KOREA_COUNTRY_RISK_PREMIUM,
        "growth_calculation_version": "growth_v2_stable_cagr",
        "growth_cagr": growth_payload["growth_cagr"],
        "growth_recent_average": growth_payload["growth_recent_average"],
        "roic_calculation_version": "roic_v3_stable_invested_capital",
        "annual_growth_rates": _annual_metric_rows(annual_growth),
        "roic_recent_average": _roic_value(roic_points, "recent_average", None),
        "roic_all_year_average": _roic_value(roic_points, "all_year_average", None),
        "annual_roic": _annual_metric_rows(roic_points),
    }
