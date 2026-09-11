"""A DCF report should say which bound decided its terminal growth.

`terminal_value_share_pct` has always been on the report and on screen. What no surface
could say is WHY a valuation is 96% terminal value -- whether an economic judgement or the
Gordon denominator's safety bound produced the growth rate. These two fields answer that.

Stage 1: the values below are today's arithmetic. When Stage 2 supplies a ceiling they
change, and the characterisation test here is what makes that change visible rather than
merely asserted.
"""

import inspect

import pytest

from apps.api.models.schemas import ValuationAssumptions
from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_dcf import build_dcf_full_report
from packages.core_finance.terminal_growth import SAFETY_MARGIN, TERMINAL_GROWTH_CEILING


def _watchlist_tickers(limit: int | None = None) -> list[str]:
    """Real watchlist tickers, without opening `data/processed/moneyview.db`.

    tests/conftest.py's `_forbid_the_real_database` fixture (and `tests/__init__.py`'s
    same refusal armed at import time) refuse any connection to that file -- deliberately,
    after the 2026-09-03 incident recorded in ERROR-LOG.md. `ensure_watchlist_bootstrapped`
    loads the identical ticker roster from the checked-in
    `apps/api/services/webscrap/stock_targets.json` seed into this test's isolated
    database, so the sweep below still exercises the real watchlist.
    """
    from apps.api.services import db as db_service
    from apps.api.services.watchlist_seed import ensure_watchlist_bootstrapped

    ensure_watchlist_bootstrapped(corporate_route._WATCHLIST_JSON)
    query = "SELECT ticker FROM watchlist ORDER BY ticker"
    if limit is not None:
        query += f" LIMIT {int(limit)}"
    with db_service.get_db() as conn:
        return [row["ticker"] for row in conn.execute(query)]


def _report(ticker: str = "AAPL"):
    metrics = corporate_route._metrics_for_ticker(ticker)
    params = corporate_route._valuation_params_from_metrics(metrics)
    return build_dcf_full_report(
        ticker=ticker,
        params=params,
        current_price_loader=corporate_route._latest_market_price,
        metrics_loader=corporate_route._metrics_for_ticker,
        risk_free_rate=corporate_route.DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=corporate_route.DEFAULT_EQUITY_RISK_PREMIUM,
        country_risk_premium=corporate_route.KOREA_COUNTRY_RISK_PREMIUM,
    )


def _report_from_params(params: ValuationAssumptions, *, ticker: str = "AAPL"):
    """Like `_report`, but taking params directly rather than building them from metrics.

    `_report` always routes through `_valuation_params_from_metrics` -- the bulk
    endpoint's path, where the reconstructed terminal-growth derivation agrees with the
    rate that ran by construction. Testing the single-ticker routes' shape (a hand-set
    `terminal_growth_rate` the ceiling never bounded) needs params supplied directly.
    """
    return build_dcf_full_report(
        ticker=ticker,
        params=params,
        current_price_loader=corporate_route._latest_market_price,
        metrics_loader=corporate_route._metrics_for_ticker,
        risk_free_rate=corporate_route.DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=corporate_route.DEFAULT_EQUITY_RISK_PREMIUM,
        country_risk_premium=corporate_route.KOREA_COUNTRY_RISK_PREMIUM,
    )


def test_the_report_states_the_spread_the_terminal_value_turns_on():
    summary = _report().summary

    assert summary.wacc_minus_terminal_growth is not None
    assert summary.wacc_minus_terminal_growth > 0


def test_the_report_names_the_binding_constraint():
    summary = _report().summary

    assert summary.terminal_growth_binding_constraint in {"company", "wacc_safety", "ceiling"}


def _seed_floor_ticker(ticker: str) -> None:
    """Write a genuine (non-generic-default) `corporate_metrics` row with ALGM's shape.

    The isolated test database has no real financial data, so every real watchlist ticker
    below falls back to `corporate_metrics_service.default_metrics`, whose growth is
    always `5.0 + (seed % 9)` -- never negative, so the sweep alone can never revisit the
    scenario this test exists to catch. Seeding one genuine row with growth below the
    floor (ALGM's real -13.71%) makes the floor case reachable without touching
    `data/processed/moneyview.db`.
    """
    from apps.api.services import db as db_service

    with db_service.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance, esg_penalty)
               VALUES (?, -13.71, 9.0, 13.16, 20.0, 1.1, 1.1, 30.0, 90.0, 50.0, 40.0, 55.0, 10.0)""",
            (ticker,),
        )


def test_the_reported_constraint_and_spread_describe_the_same_number():
    """The two fields are computed by different paths; they must agree on every ticker.

    They did not. `derive_terminal_growth` modelled three bounds while the computation
    applied four, so for a company growing below the floor the spread implied one rate and
    the named constraint implied another. 8 watchlist tickers were affected -- ALGM, DNN,
    LGO, MXL, OXY, RGTI, SGML, STEM -- and none of the tests noticed, because no fixture
    grew below -0.1.
    """
    from packages.core_finance.terminal_growth import derive_terminal_growth

    tickers = _watchlist_tickers()
    _seed_floor_ticker("ZFLOOR")
    tickers = tickers + ["ZFLOOR"]

    mismatched = []
    checked = 0
    for ticker in tickers:
        try:
            summary = _report(ticker).summary
            metrics = corporate_route._metrics_for_ticker(ticker)
        except Exception:
            continue
        checked += 1
        wacc = max(float(metrics.wacc) / 100, 0.001)
        expected = derive_terminal_growth(
            company_growth=float(metrics.growth) / 100, wacc=wacc, ceiling=TERMINAL_GROWTH_CEILING
        )
        implied_rate = wacc - summary.wacc_minus_terminal_growth
        if abs(implied_rate - expected.rate) > 1e-9:
            mismatched.append((ticker, implied_rate, expected.rate))

    assert checked > 50, f"only {checked} tickers valued; this test proved little"
    assert mismatched == [], f"spread and constraint disagree: {mismatched[:5]}"


def test_a_fast_grower_is_bound_by_the_ceiling_not_the_safety_margin():
    """AMD derived 0.1364 under the old clamp -- 50bp below its 14.14% WACC.

    That rate is refused by ValuationAssumptions' own `le=0.1` bound, which is why 9 of the
    first 40 watchlist tickers could not be valued at all. Under the ceiling it is 3%, and
    the report says the ceiling is why.
    """
    from packages.core_finance.terminal_growth import derive_terminal_growth

    result = derive_terminal_growth(
        company_growth=0.18, wacc=0.1414, ceiling=TERMINAL_GROWTH_CEILING
    )

    # Literal, not TERMINAL_GROWTH_CEILING: an expectation derived from the constant under
    # test cannot detect that constant changing. The binding_constraint assertion below
    # still carries the mutation.
    assert result.rate == pytest.approx(0.03)
    assert result.binding_constraint == "ceiling"


def test_the_watchlist_no_longer_pins_on_the_safety_margin_alone():
    """The defect mechanism, tested directly rather than through a share threshold.

    Not `terminal_share < 90%`: the share is a diagnostic, and asserting a bound on it
    would turn it into a target. The claim is narrower -- no ticker arrives at
    `wacc - safety_margin` merely because its growth exceeded WACC.
    """
    # NOT `sqlite3.connect("data/processed/moneyview.db")`. `tests/conftest.py:161` and
    # `tests/__init__.py` both refuse that path outright -- a guard added after a test
    # wrote a fabricated Damodaran vintage into the developer's real database. Use the
    # hermetic helper Task 2 introduced, which bootstraps the isolated test database from
    # the checked-in `stock_targets.json` seed and yields the same ticker roster.
    tickers = _watchlist_tickers(limit=20)

    pinned = []
    checked = 0
    for ticker in tickers:
        try:
            summary = _report(ticker).summary
        except Exception:
            continue
        checked += 1
        if (
            summary.terminal_growth_binding_constraint == "wacc_safety"
            and summary.wacc_minus_terminal_growth == pytest.approx(SAFETY_MARGIN)
        ):
            # Legitimate only when WACC is genuinely below the ceiling plus the margin.
            # Hardcoded (0.03 + 0.005) as of this commit, deliberately not imported as
            # TERMINAL_GROWTH_CEILING + SAFETY_MARGIN: a legitimacy threshold derived from
            # the constant under test cannot distinguish "the ceiling is working" from "the
            # ceiling moved and the test moved with it".
            wacc = float(corporate_route._metrics_for_ticker(ticker).wacc) / 100
            if wacc >= 0.035:
                pinned.append(ticker)

    # The assertion under test is that a list is EMPTY, so it passes for free if the loop
    # never ran. `except Exception: continue` makes that a live possibility -- a bootstrap
    # or schema breakage would swallow every ticker and leave this test green while proving
    # nothing. That is the exact shape of two vacuous tests already caught on this branch.
    assert checked > 0, "no sampled ticker was valued; this test proved nothing"
    assert pinned == [], f"still pinned on the safety margin alone: {pinned}"


def test_both_derivation_sites_agree_on_the_same_ticker():
    """A ceiling applied in one derivation and not the other splits one ticker in two.

    corporate_comparison computes the comparison table's dcf_value; corporate_dcf computes
    the report. They read the same metrics, so they must reach the same terminal growth.
    """
    from apps.api.services import corporate_comparison

    metrics = corporate_route._metrics_for_ticker("AAPL")
    wacc = max(float(metrics.wacc) / 100, 0.001)
    growth_rate = float(metrics.growth) / 100

    from packages.core_finance.terminal_growth import derive_terminal_growth

    expected = derive_terminal_growth(
        company_growth=growth_rate, wacc=wacc, ceiling=TERMINAL_GROWTH_CEILING
    ).rate
    params = corporate_route._valuation_params_from_metrics(metrics)

    assert params.terminal_growth_rate == pytest.approx(expected)
    source = inspect.getsource(corporate_comparison._dcf_snapshot)
    assert "wacc - 0.005" not in source
    assert "derive_terminal_growth" in source


def test_a_hand_set_terminal_rate_is_not_attributed_to_a_bound_it_never_passed():
    """The constraint is a reconstruction, and it must refuse to speak when it cannot know.

    `_valuation_params_from_metrics` feeds only the bulk endpoint. Every single-ticker DCF
    route takes `terminal_growth_rate` from the request body, and the web client sends
    company growth with no ceiling -- so reconstructing the bounds from
    `revenue_growth_rate` named a 3% ceiling on a rate that was never bounded by one, while
    the spread beside it implied a different rate entirely.
    """
    params = ValuationAssumptions(
        revenue_growth_rate=0.10,
        operating_margin=0.2,
        tax_rate=0.25,
        wacc=0.08,
        terminal_growth_rate=0.10,   # what the browser actually sends: growth, unbounded
        fcff=100.0,
    )
    summary = _report_from_params(params).summary

    # The rate that ran is min(0.10, 0.075) = 0.075, so the spread is the safety margin.
    assert summary.wacc_minus_terminal_growth == pytest.approx(SAFETY_MARGIN)
    assert summary.terminal_growth_binding_constraint is None


def test_builder_params_still_name_their_bound():
    """The guard must not silence the path where the reconstruction IS a record."""
    metrics = corporate_route._metrics_for_ticker("AAPL")
    params = corporate_route._valuation_params_from_metrics(metrics)
    summary = _report_from_params(params, ticker="AAPL").summary

    assert summary.terminal_growth_binding_constraint is not None
    wacc = max(float(metrics.wacc) / 100, 0.001)
    implied = wacc - summary.wacc_minus_terminal_growth
    assert implied == pytest.approx(params.terminal_growth_rate)
