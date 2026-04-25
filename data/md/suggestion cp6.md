# ============================================================
# MoneyView Stable ROIC + Growth Rate Calculation Pipeline
# ============================================================
#
# Goal:
# - Avoid absurd ROIC values such as +100,000% or -300,000%
# - Handle Yahoo Finance missing / noisy / negative values
# - Separate "data quality problem" from "business interpretation"
#
# Core outputs:
# - ROIC %
# - Revenue Growth CAGR %
# - ROIC quality flag
# - Growth quality flag
# - Explanation fields for debugging / UI display
# ============================================================


# ------------------------------------------------------------
# 0. Recommended constants
# ------------------------------------------------------------

DEFAULT_TAX_RATE = 0.25          # fallback tax rate, 25%
MIN_TAX_RATE = 0.15              # lower bound for normalized tax rate
MAX_TAX_RATE = 0.30              # upper bound for normalized tax rate

MIN_INVESTED_CAPITAL = 1_000_000 # reject tiny denominator
MAX_ABS_ROIC = 3.0               # 300% ROIC cap for validity check

MIN_REVENUE = 1_000_000          # reject tiny revenue base
MAX_GROWTH_CAGR = 2.0            # 200% CAGR cap for sanity check
MIN_GROWTH_CAGR = -0.9           # -90% CAGR floor


# ------------------------------------------------------------
# 1. Safe numeric helper
# ------------------------------------------------------------

def safe_number(value):
    """
    Convert Yahoo values into usable float.

    Returns:
        float | None
    """
    try:
        if value is None:
            return None

        value = float(value)

        if value != value:  # NaN check
            return None

        if value in (float("inf"), float("-inf")):
            return None

        return value

    except Exception:
        return None


def clamp(value, low, high):
    return max(low, min(high, value))


# ------------------------------------------------------------
# 2. Tax rate normalization
# ------------------------------------------------------------

def calculate_stable_tax_rate(statement_rows):
    """
    Calculate stable effective tax rate from annual Yahoo statements.

    Expected input:
        statement_rows = [
            {
                "year": 2024,
                "pretax_income": ...,
                "income_tax_expense": ...
            },
            ...
        ]

    Rule:
    - Use only years where pretax income is positive.
    - Ignore negative tax rates.
    - Ignore absurdly high tax rates.
    - Use median of valid tax rates.
    - If no valid tax rate exists, use DEFAULT_TAX_RATE.

    Why:
    - Negative tax rate such as -3.9% is usually accounting noise,
      tax benefit, deferred tax, or loss-year distortion.
    """

    valid_rates = []

    for row in statement_rows:
        pretax = safe_number(row.get("pretax_income"))
        tax = safe_number(row.get("income_tax_expense"))

        if pretax is None or tax is None:
            continue

        if pretax <= 0:
            continue

        raw_rate = tax / pretax

        if raw_rate <= 0:
            continue

        if raw_rate > 0.50:
            continue

        valid_rates.append(raw_rate)

    if not valid_rates:
        return {
            "tax_rate": DEFAULT_TAX_RATE,
            "tax_rate_source": "fallback_default",
            "tax_rate_note": "No valid positive statement tax rate found."
        }

    valid_rates.sort()
    mid = len(valid_rates) // 2

    if len(valid_rates) % 2 == 1:
        median_rate = valid_rates[mid]
    else:
        median_rate = (valid_rates[mid - 1] + valid_rates[mid]) / 2

    normalized_rate = clamp(median_rate, MIN_TAX_RATE, MAX_TAX_RATE)

    return {
        "tax_rate": normalized_rate,
        "tax_rate_source": "median_valid_statement_tax_rate",
        "tax_rate_note": "Used median of positive valid tax rates, clamped to realistic range."
    }


# ------------------------------------------------------------
# 3. NOPAT calculation
# ------------------------------------------------------------

def calculate_nopat(operating_income, tax_rate):
    """
    NOPAT proxy:
        NOPAT = Operating Income x (1 - stable tax rate)

    Use Yahoo operating income as EBIT proxy.

    Important:
    - Do not use negative tax rates directly.
    - Do not let tax benefits increase NOPAT above operating income.
    """

    op_income = safe_number(operating_income)

    if op_income is None:
        return {
            "nopat": None,
            "nopat_note": "Missing operating income."
        }

    nopat = op_income * (1 - tax_rate)

    return {
        "nopat": nopat,
        "nopat_note": "NOPAT calculated from operating income after normalized tax."
    }


# ------------------------------------------------------------
# 4. Invested Capital calculation
# ------------------------------------------------------------

def calculate_invested_capital(balance_sheet_row):
    """
    Preferred stable definition:

        Invested Capital = Total Equity + Interest-Bearing Debt

    Interest-Bearing Debt:
        short_term_debt + long_term_debt

    Why this definition:
    - More stable than Total Assets - Cash - Non-interest liabilities.
    - Avoids denominator collapsing when cash is huge.
    - Works better with Yahoo data.
    """

    equity = safe_number(balance_sheet_row.get("total_stockholder_equity"))
    short_debt = safe_number(balance_sheet_row.get("short_long_term_debt"))
    long_debt = safe_number(balance_sheet_row.get("long_term_debt"))

    if short_debt is None:
        short_debt = 0

    if long_debt is None:
        long_debt = 0

    if equity is None:
        return {
            "invested_capital": None,
            "invested_capital_note": "Missing total stockholder equity."
        }

    invested_capital = equity + short_debt + long_debt

    if invested_capital <= 0:
        return {
            "invested_capital": None,
            "invested_capital_note": "Invested capital is zero or negative."
        }

    if invested_capital < MIN_INVESTED_CAPITAL:
        return {
            "invested_capital": None,
            "invested_capital_note": "Invested capital is too small; ROIC denominator unstable."
        }

    return {
        "invested_capital": invested_capital,
        "invested_capital_note": "Invested capital calculated as equity plus interest-bearing debt."
    }


# ------------------------------------------------------------
# 5. Average Invested Capital
# ------------------------------------------------------------

def calculate_average_invested_capital(current_balance_sheet, previous_balance_sheet=None):
    """
    Preferred:
        Average Invested Capital = (IC_current + IC_previous) / 2

    Why:
    - NOPAT comes from income statement period.
    - Invested capital is balance sheet snapshot.
    - Average invested capital reduces timing mismatch.
    """

    current = calculate_invested_capital(current_balance_sheet)

    if current["invested_capital"] is None:
        return {
            "average_invested_capital": None,
            "average_ic_note": current["invested_capital_note"]
        }

    if previous_balance_sheet is None:
        return {
            "average_invested_capital": current["invested_capital"],
            "average_ic_note": "Only current balance sheet available; used current invested capital."
        }

    previous = calculate_invested_capital(previous_balance_sheet)

    if previous["invested_capital"] is None:
        return {
            "average_invested_capital": current["invested_capital"],
            "average_ic_note": "Previous invested capital unavailable; used current invested capital."
        }

    avg_ic = (current["invested_capital"] + previous["invested_capital"]) / 2

    return {
        "average_invested_capital": avg_ic,
        "average_ic_note": "Used average invested capital from current and previous year."
    }


# ------------------------------------------------------------
# 6. Stable ROIC calculation
# ------------------------------------------------------------

def calculate_stable_roic(
    latest_income_statement,
    current_balance_sheet,
    previous_balance_sheet,
    annual_income_statements
):
    """
    Stable ROIC pipeline.

    Input:
        latest_income_statement:
            latest annual or TTM income statement row

        current_balance_sheet:
            latest balance sheet row

        previous_balance_sheet:
            previous year balance sheet row

        annual_income_statements:
            list of annual rows used for tax normalization

    Output:
        dict with:
            roic_percent
            roic_decimal
            nopat
            tax_rate
            invested_capital
            quality_flag
            notes
    """

    tax_result = calculate_stable_tax_rate(annual_income_statements)
    tax_rate = tax_result["tax_rate"]

    operating_income = latest_income_statement.get("operating_income")

    nopat_result = calculate_nopat(
        operating_income=operating_income,
        tax_rate=tax_rate
    )

    avg_ic_result = calculate_average_invested_capital(
        current_balance_sheet=current_balance_sheet,
        previous_balance_sheet=previous_balance_sheet
    )

    nopat = nopat_result["nopat"]
    avg_ic = avg_ic_result["average_invested_capital"]

    if nopat is None:
        return {
            "roic_percent": None,
            "roic_decimal": None,
            "quality_flag": "invalid_missing_nopat",
            "nopat": None,
            "tax_rate": tax_rate,
            "invested_capital": avg_ic,
            "notes": [
                tax_result["tax_rate_note"],
                nopat_result["nopat_note"],
                avg_ic_result["average_ic_note"]
            ]
        }

    if avg_ic is None:
        return {
            "roic_percent": None,
            "roic_decimal": None,
            "quality_flag": "invalid_missing_or_unstable_invested_capital",
            "nopat": nopat,
            "tax_rate": tax_rate,
            "invested_capital": None,
            "notes": [
                tax_result["tax_rate_note"],
                nopat_result["nopat_note"],
                avg_ic_result["average_ic_note"]
            ]
        }

    roic_decimal = nopat / avg_ic

    if abs(roic_decimal) > MAX_ABS_ROIC:
        return {
            "roic_percent": None,
            "roic_decimal": roic_decimal,
            "quality_flag": "invalid_roic_outlier",
            "nopat": nopat,
            "tax_rate": tax_rate,
            "invested_capital": avg_ic,
            "notes": [
                "ROIC exceeded sanity threshold.",
                "This usually means denominator distortion, bad Yahoo data, or unusual capital structure.",
                tax_result["tax_rate_note"],
                nopat_result["nopat_note"],
                avg_ic_result["average_ic_note"]
            ]
        }

    return {
        "roic_percent": roic_decimal * 100,
        "roic_decimal": roic_decimal,
        "quality_flag": "valid",
        "nopat": nopat,
        "tax_rate": tax_rate,
        "invested_capital": avg_ic,
        "notes": [
            tax_result["tax_rate_note"],
            nopat_result["nopat_note"],
            avg_ic_result["average_ic_note"]
        ]
    }


# ------------------------------------------------------------
# 7. Revenue Growth Rate calculation
# ------------------------------------------------------------

def calculate_revenue_growth_cagr(annual_income_statements, min_year=2021):
    """
    Preferred Growth Rate:
        Revenue CAGR from available Yahoo annual statements from 2021 onward.

    Formula:
        CAGR = (Revenue_last / Revenue_first) ** (1 / years) - 1

    Why not average annual growth?
    - Simple average gets distorted by one extreme year.
    - CAGR better reflects actual multi-year compounding.

    Expected input:
        annual_income_statements = [
            {"year": 2021, "total_revenue": ...},
            {"year": 2022, "total_revenue": ...},
            {"year": 2023, "total_revenue": ...},
            {"year": 2024, "total_revenue": ...}
        ]
    """

    rows = []

    for row in annual_income_statements:
        year = row.get("year")
        revenue = safe_number(row.get("total_revenue"))

        if year is None:
            continue

        try:
            year = int(year)
        except Exception:
            continue

        if year < min_year:
            continue

        if revenue is None:
            continue

        if revenue < MIN_REVENUE:
            continue

        rows.append({
            "year": year,
            "revenue": revenue
        })

    rows.sort(key=lambda x: x["year"])

    if len(rows) < 2:
        return {
            "growth_percent": None,
            "growth_decimal": None,
            "quality_flag": "invalid_not_enough_revenue_history",
            "revenue_points": rows,
            "note": "Need at least two valid revenue years."
        }

    first = rows[0]
    last = rows[-1]

    years = last["year"] - first["year"]

    if years <= 0:
        return {
            "growth_percent": None,
            "growth_decimal": None,
            "quality_flag": "invalid_year_range",
            "revenue_points": rows,
            "note": "Invalid year range for CAGR."
        }

    revenue_first = first["revenue"]
    revenue_last = last["revenue"]

    if revenue_first <= 0 or revenue_last <= 0:
        return {
            "growth_percent": None,
            "growth_decimal": None,
            "quality_flag": "invalid_revenue_base",
            "revenue_points": rows,
            "note": "Revenue base must be positive."
        }

    cagr = (revenue_last / revenue_first) ** (1 / years) - 1

    if cagr > MAX_GROWTH_CAGR or cagr < MIN_GROWTH_CAGR:
        return {
            "growth_percent": None,
            "growth_decimal": cagr,
            "quality_flag": "invalid_growth_outlier",
            "revenue_points": rows,
            "note": "Growth CAGR exceeded sanity threshold."
        }

    return {
        "growth_percent": cagr * 100,
        "growth_decimal": cagr,
        "quality_flag": "valid",
        "revenue_points": rows,
        "note": "Growth calculated using revenue CAGR from available annual statements."
    }


# ------------------------------------------------------------
# 8. Optional: fallback simple average growth for display only
# ------------------------------------------------------------

def calculate_average_annual_revenue_growth(annual_income_statements, min_year=2021):
    """
    Optional secondary metric:
        Average YoY revenue growth.

    Use this only as supporting display, not as primary Growth Rate.

    Reason:
    - It shows yearly volatility.
    - But it can be badly distorted by one abnormal year.
    """

    rows = []

    for row in annual_income_statements:
        year = row.get("year")
        revenue = safe_number(row.get("total_revenue"))

        if year is None or revenue is None:
            continue

        try:
            year = int(year)
        except Exception:
            continue

        if year < min_year:
            continue

        if revenue < MIN_REVENUE:
            continue

        rows.append({
            "year": year,
            "revenue": revenue
        })

    rows.sort(key=lambda x: x["year"])

    growth_rates = []

    for i in range(1, len(rows)):
        prev = rows[i - 1]["revenue"]
        curr = rows[i]["revenue"]

        if prev <= 0:
            continue

        yoy_growth = (curr / prev) - 1

        if yoy_growth < -0.95 or yoy_growth > 5.0:
            continue

        growth_rates.append(yoy_growth)

    if not growth_rates:
        return {
            "average_growth_percent": None,
            "average_growth_decimal": None,
            "quality_flag": "invalid_no_valid_yoy_growth",
            "note": "No valid YoY growth rates."
        }

    avg_growth = sum(growth_rates) / len(growth_rates)

    return {
        "average_growth_percent": avg_growth * 100,
        "average_growth_decimal": avg_growth,
        "quality_flag": "valid",
        "note": "Average YoY growth calculated as supporting metric only."
    }


# ------------------------------------------------------------
# 9. Combined classification
# ------------------------------------------------------------

def classify_roic_growth(roic_result, growth_result):
    """
    Classify company quality using ROIC and Growth.

    This is for UI interpretation, not raw calculation.
    """

    roic = roic_result.get("roic_decimal")
    growth = growth_result.get("growth_decimal")

    if roic_result.get("roic_percent") is None:
        return {
            "label": "ROIC Unreliable",
            "description": "ROIC could not be used because NOPAT or invested capital was unstable."
        }

    if growth_result.get("growth_percent") is None:
        return {
            "label": "Growth Unreliable",
            "description": "Growth could not be calculated from available revenue history."
        }

    if roic >= 0.15 and growth >= 0.10:
        return {
            "label": "Compounder",
            "description": "High capital efficiency and strong revenue growth."
        }

    if roic >= 0.15 and growth < 0.10:
        return {
            "label": "High-Quality Mature",
            "description": "Strong capital efficiency, but limited growth."
        }

    if roic < 0.15 and growth >= 0.20:
        return {
            "label": "High-Growth Investment Phase",
            "description": "Strong growth, but capital efficiency is still developing."
        }

    if roic < 0:
        return {
            "label": "Value Destruction",
            "description": "Negative ROIC indicates operating losses or poor capital efficiency."
        }

    return {
        "label": "Average / Transitional",
        "description": "Neither capital efficiency nor growth is clearly dominant."
    }


# ------------------------------------------------------------
# 10. Example wrapper for one ticker
# ------------------------------------------------------------

def calculate_company_quality_metrics(
    latest_income_statement,
    annual_income_statements,
    current_balance_sheet,
    previous_balance_sheet
):
    """
    Final wrapper used by MoneyView.

    Returns stable:
    - ROIC
    - Growth Rate
    - Debug values
    - UI classification
    """

    roic_result = calculate_stable_roic(
        latest_income_statement=latest_income_statement,
        current_balance_sheet=current_balance_sheet,
        previous_balance_sheet=previous_balance_sheet,
        annual_income_statements=annual_income_statements
    )

    growth_result = calculate_revenue_growth_cagr(
        annual_income_statements=annual_income_statements,
        min_year=2021
    )

    avg_growth_result = calculate_average_annual_revenue_growth(
        annual_income_statements=annual_income_statements,
        min_year=2021
    )

    classification = classify_roic_growth(
        roic_result=roic_result,
        growth_result=growth_result
    )

    return {
        "roic_percent": roic_result["roic_percent"],
        "growth_percent": growth_result["growth_percent"],

        "roic": roic_result,
        "growth_cagr": growth_result,
        "average_yoy_growth": avg_growth_result,

        "classification": classification
    }


# ============================================================
# Recommended UI display rules
# ============================================================
#
# 1. If roic_percent is None:
#       show "N/A"
#       tooltip: quality_flag + notes
#
# 2. If raw roic_decimal exists but was rejected:
#       do not display the raw extreme value as normal ROIC
#       show "N/A" or "Unreliable"
#
# 3. If growth_percent is None:
#       show "N/A"
#       tooltip: growth quality flag
#
# 4. Display supporting debug fields in company modal:
#       - Operating Income
#       - Normalized Tax Rate
#       - NOPAT
#       - Invested Capital
#       - Revenue First Year
#       - Revenue Last Year
#       - CAGR Years
#
# 5. Never use negative Yahoo tax rate directly in NOPAT.
#
# 6. Use CAGR as primary Growth Rate.
#    Use average YoY growth only as secondary context.
# ============================================================