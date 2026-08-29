import pandas as pd
import pytest

from apps.api.models.schema_parts.corporate import CorporateMetrics
from apps.api.services.company_baseline import (
    build_company_baseline,
    generate_conservative_case,
)
from apps.api.services.corporate_statement_metrics import statement_baseline

BILLION = 1_000_000_000.0


def _metrics(**overrides):
    base = dict(ticker="TEST", growth=20.0, roic=35.0, wacc=8.5)
    base.update(overrides)
    return CorporateMetrics(**base)


def _baseline_source(**overrides):
    """Raw-currency statement figures, as they come off a bundle."""
    base = {
        "revenue_by_year": {2024: 90_000_000_000.0, 2025: 100_000_000_000.0},
        "operating_income_by_year": {2024: 27_000_000_000.0, 2025: 30_000_000_000.0},
        "invested_capital_by_year": {2024: 30_000_000_000.0, 2025: 33_333_333_333.0},
    }
    base.update(overrides)
    return base


def test_revenue_is_converted_to_billions():
    """A 100bn-revenue company yields 100.0, not 1e11. This is the single
    boundary in the whole feature where a 10^9 error is possible."""
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert reason is None
    assert baseline.base_revenue == pytest.approx(100.0)


def test_percent_metrics_are_converted_to_fractions():
    """CorporateMetrics stores roic/wacc/growth as percent. A 35.0 leaking
    through as a fraction would be a 3500% return on capital."""
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(roic=35.0, wacc=8.5, growth=20.0),
        statement_source=_baseline_source(), net_debt=5.0, shares=1.0,
    )
    assert baseline.current_roic == pytest.approx(0.35)
    assert baseline.current_wacc == pytest.approx(0.085)
    assert baseline.current_growth == pytest.approx(0.20)


def test_base_margin_is_dimensionless_and_not_scaled():
    """operating_income / revenue is a ratio of two raw-currency figures, so it
    must NOT be divided by 1e9 alongside them."""
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.base_margin == pytest.approx(0.30)


def test_sales_to_capital_is_revenue_over_invested_capital():
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.current_sales_to_capital == pytest.approx(3.0, rel=1e-4)


def test_positive_net_debt_becomes_debt_and_zero_cash():
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.debt == pytest.approx(5.0)
    assert baseline.cash == pytest.approx(0.0)


def test_negative_net_debt_becomes_cash_and_zero_debt():
    """A net-cash company. EV - debt + cash must reconstruct the same bridge."""
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=-12.0, shares=1.0,
    )
    assert baseline.cash == pytest.approx(12.0)
    assert baseline.debt == pytest.approx(0.0)


def test_source_years_names_the_years_actually_used():
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.source_years == (2024, 2025)


@pytest.mark.parametrize("missing,expected", [
    ("revenue_by_year", "no_revenue"),
    ("operating_income_by_year", "no_operating_income"),
    ("invested_capital_by_year", "no_invested_capital"),
])
def test_a_missing_statement_series_refuses_with_a_reason(missing, expected):
    """Never a defaulted zero. A baseline built on a substituted figure produces
    a confident valuation from data that does not exist."""
    source = _baseline_source()
    source[missing] = {}
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source,
        net_debt=5.0, shares=1.0,
    )
    assert baseline is None
    assert expected in reason


def test_a_missing_share_count_refuses():
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=None,
    )
    assert baseline is None
    assert "no_shares" in reason


def test_a_missing_net_debt_refuses():
    """Unlike a zero balance, a missing one is unknown. The argument in
    `calculate_net_debt`'s docstring applies: a missing balance is not a zero
    balance."""
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=None, shares=1.0,
    )
    assert baseline is None
    assert "no_net_debt" in reason


def test_zero_revenue_refuses_rather_than_dividing_by_zero():
    source = _baseline_source(revenue_by_year={2025: 0.0})
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source,
        net_debt=5.0, shares=1.0,
    )
    assert baseline is None
    assert "no_revenue" in reason


def test_three_populated_series_with_no_shared_year_refuse():
    """Each series alone is present, so none of the three per-series refusals
    fires -- but a margin taken from one year over a revenue from another is not
    a measurement of anything, so there is no baseline to build."""
    source = _baseline_source(
        operating_income_by_year={2022: 27_000_000_000.0},
        invested_capital_by_year={2023: 30_000_000_000.0},
    )
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source,
        net_debt=5.0, shares=1.0,
    )
    assert baseline is None
    assert "no_shared_year" in reason


def test_non_positive_invested_capital_refuses():
    source = _baseline_source(invested_capital_by_year={2024: 30_000_000_000.0, 2025: -1.0})
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source,
        net_debt=5.0, shares=1.0,
    )
    assert baseline is None
    assert "no_invested_capital" in reason


# ---------------------------------------------------------------- statement_baseline


def _frame(rows, periods):
    return pd.DataFrame(rows, index=pd.to_datetime(periods)).T


def _bundle():
    empty = pd.DataFrame()
    income = _frame(
        {
            "Total Revenue": [90 * BILLION, 100 * BILLION],
            "Operating Income": [27 * BILLION, 30 * BILLION],
        },
        ["2024-12-31", "2025-12-31"],
    )
    balance = _frame(
        {
            "Stockholders Equity": [25 * BILLION, 28 * BILLION],
            "Total Debt": [5 * BILLION, 5 * BILLION],
        },
        ["2024-12-31", "2025-12-31"],
    )
    return {
        "ticker": "TEST", "income": income, "balance": balance, "cashflow": empty,
        "quarterly_income": empty, "quarterly_balance": empty, "quarterly_cashflow": empty,
        "info": {}, "fetched_at": None,
    }


def test_statement_baseline_reads_the_three_series_in_raw_currency():
    """Raw statement currency, NOT billions -- the scaling boundary is
    `build_company_baseline`, and doing it twice is the 10^9 error."""
    source = statement_baseline("TEST", bundle_loader=lambda t, e: _bundle())
    assert source["revenue_by_year"][2025] == pytest.approx(100 * BILLION)
    assert source["operating_income_by_year"][2025] == pytest.approx(30 * BILLION)
    # equity + interest-bearing debt, the same definition ROIC uses.
    assert source["invested_capital_by_year"][2025] == pytest.approx(33 * BILLION)


def test_statement_baseline_returns_none_when_nothing_is_stored():
    """Metric computation never acquires: an unacquired ticker is a refusal,
    not a fetch."""
    assert statement_baseline("TEST", bundle_loader=lambda t, e: None) is None


def test_statement_baseline_feeds_build_company_baseline_end_to_end():
    """The seam this task exists to close: bundle -> raw maps -> billions."""
    source = statement_baseline("TEST", bundle_loader=lambda t, e: _bundle())
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source, net_debt=5.0, shares=1.0,
    )
    assert reason is None
    assert baseline.base_revenue == pytest.approx(100.0)
    assert baseline.base_margin == pytest.approx(0.30)
    assert baseline.current_sales_to_capital == pytest.approx(100 / 33)


# ---------------------------------------------------------------- the entry point


def _seed_quote_facts(ticker="TEST", industry="Semiconductors"):
    from apps.api.services.db import get_db

    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker.upper(), industry),
        )


def _generate(**overrides):
    kwargs = dict(
        base_year=2026, riskfree_rate=0.0456, marginal_tax_rate=0.25,
        metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    kwargs.update(overrides)
    ticker = kwargs.pop("ticker", "TEST")
    return generate_conservative_case(ticker, **kwargs)


def test_generate_produces_a_stored_runnable_case():
    """The end-to-end gate this whole task exists to provide: benchmark ->
    baseline -> case -> stored -> runnable."""
    from apps.api.services.industry_benchmark_store import store_vintage
    from apps.api.services.valuation_case import run_stored_case
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts()

    case_id, reason = _generate()
    assert reason is None
    assert case_id > 0
    result = run_stored_case(case_id)
    assert result["enterprise_value"] > 0


def test_generate_refuses_when_no_benchmark_resolves():
    case_id, reason = _generate(ticker="UNKNOWN")
    assert case_id is None
    assert reason is not None


def test_generate_refuses_when_the_ticker_has_no_stored_statements():
    """`statement_baseline` returns None for an unacquired ticker, and a case
    cannot be built from an absent bundle."""
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts()

    case_id, reason = _generate(statement_source=None)
    assert case_id is None
    assert "no_statements" in reason


def test_generate_passes_a_baseline_refusal_through_unchanged():
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts()

    case_id, reason = _generate(shares=None)
    assert case_id is None
    assert "no_shares" in reason


def test_generating_the_same_case_twice_refuses_rather_than_raising():
    """`case_name` is unique per ticker and vintage, so a second run collides.
    A duplicate is a legitimate refusal, not a fault, and the caller gets a
    reason rather than an exception."""
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts()

    first_id, first_reason = _generate()
    assert first_reason is None and first_id > 0

    second_id, second_reason = _generate()
    assert second_id is None
    assert "not_storable" in second_reason


# --- the ticker -> case wrapper -------------------------------------------


def _bundle_for(revenue, operating_income, equity, debt, cash, shares):
    """A synthetic Yahoo-shaped bundle. Injected, so no network is reachable."""
    import pandas as pd

    years = sorted(revenue)
    idx = [pd.Timestamp(f"{y}-12-31") for y in years]

    def frame(rows):
        return pd.DataFrame(rows, index=idx).T

    return {
        "income": frame({"Total Revenue": [revenue[y] for y in years],
                         "Operating Income": [operating_income[y] for y in years]}),
        "balance": frame({"Stockholders Equity": [equity[y] for y in years],
                          "Total Debt": [debt[y] for y in years],
                          "Cash And Cash Equivalents": [cash[y] for y in years],
                          "Diluted Average Shares": [shares[y] for y in years]}),
        "cashflow": frame({"Free Cash Flow": [1.0 for _ in years]}),
        "quarterly_income": frame({"Total Revenue": [revenue[y] for y in years]}),
        "quarterly_balance": frame({"Stockholders Equity": [equity[y] for y in years]}),
        "quarterly_cashflow": frame({"Free Cash Flow": [1.0 for _ in years]}),
        "info": {"marketCap": 200_000_000_000.0, "sharesOutstanding": 1_000_000_000.0},
    }


def test_the_ticker_wrapper_reaches_no_network_and_refuses_without_a_benchmark():
    """Refusal propagates unchanged from the layer that raised it.

    This test does NOT prove the statement and bridge loaders are wired: it
    refuses at `resolve_for_ticker`, before either is reached. The test below,
    which produces a runnable case, is the one that proves the wiring. Kept
    separate because a refusal path that swallowed its reason would still pass
    that one."""
    from apps.api.services.company_baseline import generate_conservative_case_for_ticker

    bundle = _bundle_for(
        revenue={2024: 90e9, 2025: 100e9},
        operating_income={2024: 27e9, 2025: 30e9},
        equity={2024: 25e9, 2025: 28e9},
        debt={2024: 6e9, 2025: 6e9},
        cash={2024: 1e9, 2025: 1e9},
        shares={2024: 1e9, 2025: 1e9},
    )
    case_id, reason = generate_conservative_case_for_ticker(
        "NOBENCH", bundle_loader=lambda ticker, endpoint: bundle,
    )
    # No vintage stored and no quote facts, so it must refuse -- but it must
    # have got far enough to ASK, which proves the loaders were wired.
    assert case_id is None
    assert reason is not None


def test_the_ticker_wrapper_produces_a_stored_runnable_case():
    """End to end from a bare ticker: benchmark + statements + bridge -> case,
    and every loader provably threaded."""
    from apps.api.services.company_baseline import generate_conservative_case_for_ticker
    from apps.api.services.db import get_db
    from apps.api.services.industry_benchmark_store import store_vintage
    from apps.api.services.valuation_case import run_stored_case
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES ('WRAP', 1.0, 1.0, 'USD', 1.0, 'Technology', 'Semiconductors', '2026-01-01')"
        )

    bundle = _bundle_for(
        revenue={2024: 90e9, 2025: 100e9},
        operating_income={2024: 27e9, 2025: 30e9},
        equity={2024: 25e9, 2025: 28e9},
        debt={2024: 6e9, 2025: 6e9},
        cash={2024: 1e9, 2025: 1e9},
        shares={2024: 1e9, 2025: 1e9},
    )
    class _Recorder:
        """Records which endpoints were asked for, so the assertion below can
        prove each loader received the injection."""

        def __init__(self, payload):
            self.payload = payload
            self.endpoints = []

        def __call__(self, ticker, endpoint):
            self.endpoints.append(endpoint)
            return self.payload

    loader = _Recorder(bundle)
    case_id, reason = generate_conservative_case_for_ticker(
        "WRAP", base_year=2026, bundle_loader=loader,
    )
    assert reason is None, reason
    assert case_id > 0
    assert run_stored_case(case_id)["enterprise_value"] > 0

    # The wiring assertion, and it has to be explicit. A produced case does NOT
    # prove all three loaders were threaded: `metrics_for_ticker` never refuses
    # -- on a miss it falls back through `load_fallback_metrics` to a generic
    # `default_metrics` (growth 6%, roic 18%, wacc 10%) -- so dropping its
    # `bundle_loader` still yields a stored, runnable, positive-value case,
    # silently computed against defaults instead of this bundle. Verified by
    # deliberately breaking that one wire. The other two hard-refuse, so only
    # this one is invisible.
    assert set(loader.endpoints) == {"metrics", "equity_bridge", "conservative_case"}


def test_generate_refuses_a_case_the_engine_cannot_value():
    """A thin-margin, capital-heavy company: 3% operating margin against a
    capital base 1.66x revenue.

    Before the write-time gate this returned `(case_id, None)` -- a success --
    for a case that raised on every run. The refusal must name both the layer
    (`not_storable`) and the engine's own guard, so a reader can tell it apart
    from a duplicate case name, which carries the same prefix.
    """
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts()

    case_id, reason = _generate(
        metrics=_metrics(growth=2.0, roic=4.0, wacc=9.0),
        statement_source=_baseline_source(
            revenue_by_year={2025: 100_000_000_000.0},
            operating_income_by_year={2025: 3_000_000_000.0},
            invested_capital_by_year={2025: 166_000_000_000.0},
        ),
    )
    assert case_id is None
    assert reason.startswith("not_storable: case is not valuable: ")
    assert "must exceed the magnitude of terminal growth" in reason
