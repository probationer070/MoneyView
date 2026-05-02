from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

YAHOO_STATEMENT_START_YEAR = 2021
YAHOO_STATEMENT_END_YEAR = 2025


@dataclass(frozen=True)
class NumericRule:
    name: str
    minimum: float
    maximum: float

    def contains(self, value: float) -> bool:
        return self.minimum <= value <= self.maximum

    def clamp(self, value: float) -> float:
        return min(max(value, self.minimum), self.maximum)


@dataclass(frozen=True)
class RoicQualityContext:
    roic_records: list[dict[str, float | int | None | str | bool]]
    selected_roic_record: dict[str, float | int | None | str | bool] | None
    roic_basis: str
    tax_result: dict[str, object]
    derived_roic: Optional[float]
    selected_average_capital: Optional[float]


@dataclass(frozen=True)
class RoicPolicyRule:
    name: str
    quality: str
    predicate: Callable[[RoicQualityContext], bool]
    reason: Callable[[RoicQualityContext], str]


@dataclass(frozen=True)
class RoicWarningRule:
    name: str
    quality: str
    predicate: Callable[[RoicQualityContext], bool]
    warning: Callable[[RoicQualityContext], str]


@dataclass(frozen=True)
class GrowthQualityContext:
    revenue_points: list[dict[str, float]]
    annual_growth: list[dict[str, float]]
    recent_average: Optional[float]
    first: dict[str, float] | None
    last: dict[str, float] | None
    periods: Optional[int]
    revenue_first: Optional[float]
    revenue_last: Optional[float]
    growth_cagr: Optional[float]


@dataclass(frozen=True)
class GrowthPolicyRule:
    name: str
    predicate: Callable[[GrowthQualityContext], bool]
    note: str


TAX_RATE_RULE = NumericRule("statement_tax_rate", 0.15, 0.30)
VALID_RAW_TAX_RATE_RULE = NumericRule("raw_statement_tax_rate", 0.0, 0.50)
INVESTED_CAPITAL_RULE = NumericRule("invested_capital", 1_000_000.0, float("inf"))
ROIC_SANITY_RULE = NumericRule("absolute_roic", 0.0, 3.0)
REVENUE_RULE = NumericRule("revenue", 1_000_000.0, float("inf"))
GROWTH_CAGR_RULE = NumericRule("growth_cagr", -0.9, 2.0)

DEFAULT_TAX_RATE = 0.21
MIN_TAX_RATE = TAX_RATE_RULE.minimum
MAX_TAX_RATE = TAX_RATE_RULE.maximum
MIN_INVESTED_CAPITAL = INVESTED_CAPITAL_RULE.minimum
MAX_ABS_ROIC = ROIC_SANITY_RULE.maximum
MIN_REVENUE = REVENUE_RULE.minimum
MAX_GROWTH_CAGR = GROWTH_CAGR_RULE.maximum
MIN_GROWTH_CAGR = GROWTH_CAGR_RULE.minimum


def _roic_missing_reason(context: RoicQualityContext) -> str:
    if context.selected_roic_record is None:
        return "Average invested capital is missing or non-positive."
    return str(context.selected_roic_record["average_invested_capital_note"])


def _has_unstable_roic_denominator(context: RoicQualityContext) -> bool:
    if context.selected_average_capital is None or context.selected_roic_record is None:
        return False
    nopat = context.selected_roic_record.get("nopat")
    return nopat is not None and context.selected_average_capital < max(abs(float(nopat)) * 0.1, 1.0)


def _has_outlier_roic(context: RoicQualityContext) -> bool:
    return context.derived_roic is not None and not is_roic_within_sanity_range(float(context.derived_roic))


ROIC_WARNING_RULES = (
    RoicWarningRule(
        name="non_annual_roic_basis",
        quality="estimated",
        predicate=lambda context: bool(context.roic_records) and context.roic_basis != "annual",
        warning=lambda context: f"ROIC uses {context.roic_basis.replace('_', ' ')} rather than a single fiscal year.",
    ),
    RoicWarningRule(
        name="fallback_tax_rate",
        quality="estimated",
        predicate=lambda context: bool(context.roic_records) and context.tax_result["tax_rate_source"] == "fallback_default",
        warning=lambda context: str(context.tax_result["tax_rate_note"]),
    ),
    RoicWarningRule(
        name="current_capital_only",
        quality="estimated",
        predicate=lambda context: bool(context.selected_roic_record)
        and not bool(context.selected_roic_record["used_previous_capital"]),
        warning=lambda context: str(context.selected_roic_record["average_invested_capital_note"])
        if context.selected_roic_record
        else "",
    ),
)

ROIC_QUALITY_RULES = (
    RoicPolicyRule(
        name="missing_roic_records",
        quality="missing",
        predicate=lambda context: not context.roic_records,
        reason=lambda context: "No overlapping Yahoo statement years were available to compute ROIC.",
    ),
    RoicPolicyRule(
        name="missing_average_invested_capital",
        quality="invalid",
        predicate=lambda context: bool(context.roic_records) and context.selected_average_capital is None,
        reason=_roic_missing_reason,
    ),
    RoicPolicyRule(
        name="non_positive_average_invested_capital",
        quality="invalid",
        predicate=lambda context: context.selected_average_capital is not None and context.selected_average_capital <= 0,
        reason=lambda context: "Average invested capital is missing or non-positive.",
    ),
    RoicPolicyRule(
        name="unstable_roic_denominator",
        quality="suspicious",
        predicate=_has_unstable_roic_denominator,
        reason=lambda context: "Average invested capital is unusually small relative to NOPAT.",
    ),
    RoicPolicyRule(
        name="outlier_roic",
        quality="suspicious",
        predicate=_has_outlier_roic,
        reason=lambda context: "ROIC exceeds the configured sanity range.",
    ),
)

GROWTH_QUALITY_RULES = (
    GrowthPolicyRule(
        name="insufficient_revenue_history",
        predicate=lambda context: context.first is None or context.last is None or len(context.revenue_points) < 2,
        note="Need at least two valid revenue years.",
    ),
    GrowthPolicyRule(
        name="invalid_year_range",
        predicate=lambda context: context.periods is None or context.periods <= 0,
        note="Invalid year range for CAGR.",
    ),
    GrowthPolicyRule(
        name="non_positive_revenue_base",
        predicate=lambda context: context.revenue_first is None
        or context.revenue_last is None
        or context.revenue_first <= 0
        or context.revenue_last <= 0,
        note="Revenue base must be positive.",
    ),
    GrowthPolicyRule(
        name="outlier_growth_cagr",
        predicate=lambda context: context.growth_cagr is not None
        and not is_growth_cagr_within_sanity_range(context.growth_cagr),
        note="Growth CAGR exceeded sanity threshold.",
    ),
)


def safe_number(value: object) -> Optional[float]:
    try:
        if value is None:
            return None
        numeric = float(value)
        if numeric != numeric or numeric in (float("inf"), float("-inf")):
            return None
        return numeric
    except (TypeError, ValueError):
        return None


def safe_ratio(numerator: float, denominator: float) -> Optional[float]:
    if denominator == 0:
        return None
    return numerator / denominator


def bounded(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def is_valid_statement_tax_rate(raw_rate: float) -> bool:
    return VALID_RAW_TAX_RATE_RULE.minimum < raw_rate <= VALID_RAW_TAX_RATE_RULE.maximum


def is_stable_invested_capital(value: float) -> bool:
    return INVESTED_CAPITAL_RULE.contains(value)


def is_roic_within_sanity_range(roic_percent: float) -> bool:
    return abs(roic_percent) <= ROIC_SANITY_RULE.maximum * 100


def is_valid_revenue_base(value: float) -> bool:
    return REVENUE_RULE.contains(value)


def is_growth_cagr_within_sanity_range(cagr_percent: float) -> bool:
    return GROWTH_CAGR_RULE.minimum * 100 <= cagr_percent <= GROWTH_CAGR_RULE.maximum * 100


def average(values: list[float]) -> Optional[float]:
    clean = [value for value in values if value == value]
    return sum(clean) / len(clean) if clean else None


def median(values: list[float]) -> Optional[float]:
    clean = sorted(value for value in values if value == value)
    if not clean:
        return None
    mid = len(clean) // 2
    if len(clean) % 2 == 1:
        return clean[mid]
    return (clean[mid - 1] + clean[mid]) / 2


def matching_years(*maps: dict[int, float]) -> list[int]:
    if not maps:
        return []
    years = set(maps[0])
    for mapping in maps[1:]:
        years &= set(mapping)
    return sorted(years)[-5:]


def stable_tax_result(pretax_income_by_year: dict[int, float], tax_expense_by_year: dict[int, float]) -> dict[str, object]:
    valid_rates: list[float] = []
    for year in matching_years(pretax_income_by_year, tax_expense_by_year):
        pretax = safe_number(pretax_income_by_year.get(year))
        tax = safe_number(tax_expense_by_year.get(year))
        if pretax is None or tax is None or pretax <= 0:
            continue
        raw_rate = tax / pretax
        if not is_valid_statement_tax_rate(raw_rate):
            continue
        valid_rates.append(raw_rate)
    median_rate = median(valid_rates)
    if median_rate is None:
        return {
            "tax_rate": DEFAULT_TAX_RATE,
            "tax_rate_source": "fallback_default",
            "tax_rate_note": "No valid positive statement tax rate found.",
        }
    return {
        "tax_rate": TAX_RATE_RULE.clamp(median_rate),
        "tax_rate_source": "median_valid_statement_tax_rate",
        "tax_rate_note": "Used median of positive valid tax rates, clamped to realistic range.",
    }


def calculate_nopat(operating_income: Optional[float], tax_rate: float) -> dict[str, object]:
    op_income = safe_number(operating_income)
    if op_income is None:
        return {"nopat": None, "nopat_note": "Missing operating income."}
    return {
        "nopat": op_income * (1 - tax_rate),
        "nopat_note": "NOPAT calculated from operating income after normalized tax.",
    }


def calculate_invested_capital(equity: Optional[float], debt: Optional[float]) -> dict[str, object]:
    normalized_equity = safe_number(equity)
    normalized_debt = safe_number(debt) or 0.0
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
    if not is_stable_invested_capital(invested_capital):
        return {
            "invested_capital": None,
            "invested_capital_note": "Invested capital is too small; ROIC denominator unstable.",
        }
    return {
        "invested_capital": invested_capital,
        "invested_capital_note": "Invested capital calculated as equity plus interest-bearing debt.",
    }


def average_invested_capital_result(
    current_equity: Optional[float],
    current_debt: Optional[float],
    previous_equity: Optional[float],
    previous_debt: Optional[float],
) -> dict[str, object]:
    current = calculate_invested_capital(current_equity, current_debt)
    current_ic = current["invested_capital"]
    if current_ic is None:
        return {
            "invested_capital_ending": None,
            "invested_capital_beginning": None,
            "average_invested_capital": None,
            "average_ic_note": current["invested_capital_note"],
            "used_previous": False,
        }
    previous = calculate_invested_capital(previous_equity, previous_debt)
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


def build_roic_records(
    *,
    operating_income_by_year: dict[int, float],
    pretax_income_by_year: dict[int, float],
    tax_expense_by_year: dict[int, float],
    debt_by_year: dict[int, float],
    equity_by_year: dict[int, float],
) -> dict[str, object]:
    tax_result = stable_tax_result(pretax_income_by_year, tax_expense_by_year)
    tax_rate = float(tax_result["tax_rate"])
    roic_years = matching_years(operating_income_by_year, debt_by_year, equity_by_year)
    roic_records: list[dict[str, float | int | None | str | bool]] = []
    roic_points: list[dict[str, float]] = []
    for year in roic_years:
        average_capital = average_invested_capital_result(
            current_equity=equity_by_year.get(year),
            current_debt=debt_by_year.get(year),
            previous_equity=equity_by_year.get(year - 1),
            previous_debt=debt_by_year.get(year - 1),
        )
        nopat_result = calculate_nopat(operating_income_by_year.get(year), tax_rate)
        nopat = nopat_result["nopat"]
        average_invested_capital = average_capital["average_invested_capital"]
        roic_decimal = safe_ratio(nopat, average_invested_capital) if nopat is not None and average_invested_capital not in (None, 0) else None
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


def annual_growth_rates(revenue: dict[int, float]) -> list[dict[str, float]]:
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


def valid_revenue_points(revenue_by_year: dict[int, float]) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    for year in sorted(revenue_by_year):
        if year < YAHOO_STATEMENT_START_YEAR or year > YAHOO_STATEMENT_END_YEAR:
            continue
        revenue = safe_number(revenue_by_year.get(year))
        if revenue is None or not is_valid_revenue_base(revenue):
            continue
        rows.append({"year": year, "revenue": revenue})
    return rows


def _growth_payload(context: GrowthQualityContext, *, growth_cagr: Optional[float], note: str) -> dict[str, object]:
    return {
        "revenue_points": context.revenue_points,
        "annual_growth": context.annual_growth,
        "growth_cagr": growth_cagr,
        "growth_recent_average": context.recent_average,
        "growth_note": note,
    }


def assess_growth_quality(context: GrowthQualityContext) -> dict[str, object]:
    matched_rule = next((rule for rule in GROWTH_QUALITY_RULES if rule.predicate(context)), None)
    if matched_rule is not None:
        return _growth_payload(context, growth_cagr=None, note=matched_rule.note)
    return _growth_payload(
        context,
        growth_cagr=context.growth_cagr,
        note="Growth calculated using revenue CAGR from available annual statements.",
    )


def stable_growth_payload(revenue_by_year: dict[int, float]) -> dict[str, object]:
    revenue_points = valid_revenue_points(revenue_by_year)
    sanitized_revenue = {int(row["year"]): float(row["revenue"]) for row in revenue_points}
    annual_growth = annual_growth_rates(sanitized_revenue)
    first = revenue_points[0] if revenue_points else None
    last = revenue_points[-1] if revenue_points else None
    recent_average = average([point["value"] for point in annual_growth[-3:]]) if annual_growth else None
    periods = int(last["year"]) - int(first["year"]) if first is not None and last is not None else None
    revenue_first = float(first["revenue"]) if first is not None else None
    revenue_last = float(last["revenue"]) if last is not None else None
    cagr = (
        ((revenue_last / revenue_first) ** (1 / periods) - 1) * 100
        if periods is not None
        and periods > 0
        and revenue_first is not None
        and revenue_last is not None
        and revenue_first > 0
        and revenue_last > 0
        else None
    )
    return assess_growth_quality(
        GrowthQualityContext(
            revenue_points=revenue_points,
            annual_growth=annual_growth,
            recent_average=recent_average,
            first=first,
            last=last,
            periods=periods,
            revenue_first=revenue_first,
            revenue_last=revenue_last,
            growth_cagr=cagr,
        )
    )


def growth_value(
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


def roic_value(points: list[dict[str, float]], roic_basis: str, roic_year: Optional[int]) -> Optional[float]:
    if roic_basis == "annual" and roic_year is not None:
        match = next((point["value"] for point in points if int(point["year"]) == roic_year), None)
        if match is not None:
            return match
    if roic_basis == "annual":
        return points[-1]["value"] if points else None
    values = [point["value"] for point in points]
    if roic_basis == "all_year_average":
        return average(values)
    return average(values[-3:])


def assess_roic_quality(
    *,
    roic_records: list[dict[str, float | int | None | str | bool]],
    selected_roic_record: dict[str, float | int | None | str | bool] | None,
    roic_basis: str,
    tax_result: dict[str, object],
    derived_roic: Optional[float],
) -> dict[str, object]:
    warnings: list[str] = []
    quality = "ok"
    selected_average_capital = (
        float(selected_roic_record["average_invested_capital"])
        if selected_roic_record and selected_roic_record["average_invested_capital"] is not None
        else None
    )
    context = RoicQualityContext(
        roic_records=roic_records,
        selected_roic_record=selected_roic_record,
        roic_basis=roic_basis,
        tax_result=tax_result,
        derived_roic=derived_roic,
        selected_average_capital=selected_average_capital,
    )

    for warning_rule in ROIC_WARNING_RULES:
        if warning_rule.predicate(context):
            quality = warning_rule.quality if quality == "ok" else quality
            warnings.append(warning_rule.warning(context))

    matched_rule = next((rule for rule in ROIC_QUALITY_RULES if rule.predicate(context)), None)
    reason = matched_rule.reason(context) if matched_rule is not None else None
    if matched_rule is not None:
        quality = matched_rule.quality
    if reason:
        warnings.append(reason)
    return {"quality": quality, "reason": reason, "warnings": warnings}
