import pytest

from apps.api.services import investment_decision
from apps.api.services.db import get_db
from apps.api.services.investment_decision import record_decision


def _figures_ok(ticker):
    return {
        "price_at_decision": 431.65,
        "dcf_value": 379.39,
        "dcf_implied_return": -12.11,
        "roic": 29.64,
        "wacc": 9.92,
        "source": "corporate_comparison._dcf_snapshot",
    }


def _figures_refused(ticker):
    raise ValueError(f"no usable metrics for {ticker}")


def _figures_at_price(price):
    return {
        "price_at_decision": price,
        "dcf_value": 100.0,
        "dcf_implied_return": 1.0,
        "roic": 10.0,
        "wacc": 8.0,
        "source": "test",
    }


def _row(decision_id):
    with get_db() as conn:
        return dict(
            conn.execute(
                "SELECT * FROM investment_decision WHERE id = ?", (decision_id,)
            ).fetchone()
        )


def test_the_figures_are_captured_by_the_server_not_supplied_by_the_caller():
    """record_decision takes no figure arguments at all. A browser-posted number
    could be stale or rounded for display and would be stored as what the user
    believed, undetectably."""
    decision_id = record_decision(
        ticker="MSFT", action="buy", memo="cheap on FCF", figures_loader=_figures_ok
    )
    row = _row(decision_id)
    assert row["price_at_decision"] == 431.65
    assert row["dcf_value"] == 379.39
    assert row["figures_source"] == "corporate_comparison._dcf_snapshot"
    assert row["figures_unavailable_reason"] is None


def test_a_decision_is_recorded_even_when_the_model_cannot_value_the_ticker():
    """Otherwise the feature refuses to record decisions about exactly the
    companies the model finds hardest -- the ones a memo is most worth having."""
    decision_id = record_decision(
        ticker="NEWCO", action="watch", memo="pre-revenue, watching",
        figures_loader=_figures_refused,
    )
    row = _row(decision_id)
    assert row["memo"] == "pre-revenue, watching"
    assert row["price_at_decision"] is None
    assert "no usable metrics for NEWCO" in row["figures_unavailable_reason"]


def _figures_with(**overrides):
    """Figures that would pass every other gate, so ONE discriminator decides.

    The two guards in `record_decision` are checked in an `elif` chain, and the
    scenario that motivated them (a ticker with neither statements nor a stored
    metrics row) trips BOTH at once -- so removing either guard alone left the
    other one still refusing, and the suite still green. These fixtures set the
    two discriminators independently so each guard is pinned by a case only it
    can catch.
    """
    figures = {
        "price_at_decision": 431.65,
        "dcf_value": 5135.11,
        "dcf_implied_return": 0.0,
        "roic": 23.0,
        "wacc": 11.25,
        "source": "corporate_comparison._dcf_snapshot",
        "bridge_quality": "ok",
        "metrics_are_real": True,
    }
    figures.update(overrides)
    return lambda ticker: figures


def test_a_missing_equity_bridge_is_refused_even_when_the_metrics_are_real():
    """roic/wacc off a genuine stored row, but no bridge: `dcf_value` is then an
    ENTERPRISE value and `dcf_implied_return` is f(price, price) = 0, because
    `_dcf_snapshot` falls back to comparing the price against itself. Storing
    that pair would be ERROR-LOG.md's 2026-08-05 defect a third time, and the
    real metrics beside them make the row look trustworthy.
    """
    row = _row(
        record_decision(
            ticker="BRIDGELESS", action="buy", memo="no bridge, real metrics",
            figures_loader=_figures_with(bridge_quality="missing"),
        )
    )
    assert row["figures_unavailable_reason"] is not None
    assert "bridge" in row["figures_unavailable_reason"]
    assert row["dcf_value"] is None
    assert row["dcf_implied_return"] is None


def test_hashed_metrics_are_refused_even_when_the_bridge_resolves():
    """The mirror case: the bridge is fine, so `dcf_value` really is per-share,
    but roic/wacc came from `sum(ord(c) for c in ticker)` rather than from any
    statement. A number derived from spelling is not a modelling judgement, and
    stored beside a resolved bridge nothing downstream could tell.
    """
    row = _row(
        record_decision(
            ticker="HASHED", action="watch", memo="bridge fine, metrics fake",
            figures_loader=_figures_with(metrics_are_real=False),
        )
    )
    assert row["figures_unavailable_reason"] is not None
    assert "not real" in row["figures_unavailable_reason"]
    assert row["roic"] is None
    assert row["wacc"] is None


def test_exactly_one_of_figures_and_refusal_is_ever_populated():
    ok = _row(record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures_ok))
    refused = _row(record_decision(ticker="X", action="pass", memo="m", figures_loader=_figures_refused))
    assert (ok["price_at_decision"] is None) != (ok["figures_unavailable_reason"] is None)
    assert (refused["price_at_decision"] is None) != (refused["figures_unavailable_reason"] is None)
    # All five figure columns move together with the refusal, not just price --
    # a partial write (e.g. price populated but dcf_value NULL) would be exactly
    # the "numbers presented as captured when they are not" defect this table
    # exists to prevent.
    figure_columns = ("price_at_decision", "dcf_value", "dcf_implied_return", "roic", "wacc")
    for col in figure_columns:
        assert (ok[col] is None) == (ok["figures_unavailable_reason"] is not None), col
        assert (refused[col] is None) == (refused["figures_unavailable_reason"] is not None), col


def test_an_unknown_action_is_refused():
    with pytest.raises(ValueError, match="action"):
        record_decision(ticker="MSFT", action="hodl", memo="m", figures_loader=_figures_ok)


def test_an_empty_memo_is_refused_before_it_reaches_the_database():
    with pytest.raises(ValueError, match="memo"):
        record_decision(ticker="MSFT", action="buy", memo="   ", figures_loader=_figures_ok)


def test_a_ticker_with_no_stored_price_is_recorded_as_unavailable_not_as_zero():
    """The real loader never raises for an unvaluable ticker -- latest_market_price
    returns 0.0 and the metrics layer falls back to defaults -- so without an
    explicit check the row would store fallback figures as captured ones."""
    decision_id = record_decision(
        ticker="NOPRICE", action="watch", memo="no market data",
        figures_loader=lambda t: _figures_at_price(0.0),
    )
    row = _row(decision_id)
    assert row["price_at_decision"] is None, row
    assert row["figures_unavailable_reason"] is not None, row


def test_a_ticker_with_no_statements_no_metrics_row_and_no_bridge_is_refused_not_fabricated():
    """Reproduces the CRITICAL finding, through the REAL default loader (no
    figures_loader override): with only a price bar stored -- no statements,
    no corporate_metrics row, no equity bridge -- the loader used to return a
    fabricated dcf_value (an enterprise value, not per-share, since the
    equity bridge never resolved), a fabricated dcf_implied_return of 0.0
    (price compared against itself), and fabricated roic/wacc (hashed from
    the ticker's letters), all stamped
    figures_source='corporate_comparison._dcf_snapshot' with
    figures_unavailable_reason left NULL. The table's whole promise is that a
    number and its attribution cannot diverge; this is the default path."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO stocks (ticker, date, close) VALUES ('ZZTOP', '2026-08-01', 431.65)"
        )

    decision_id = record_decision(ticker="ZZTOP", action="buy", memo="cheap on FCF")
    row = _row(decision_id)

    assert row["figures_unavailable_reason"] is not None, row
    assert row["price_at_decision"] is None, row
    assert row["dcf_value"] is None, row
    assert row["dcf_implied_return"] is None, row
    assert row["roic"] is None, row
    assert row["wacc"] is None, row


def test_real_metrics_without_an_equity_bridge_are_refused_through_the_default_loader():
    """The ZZTOP case above trips BOTH discriminators at once, so it cannot see
    whether `_default_figures_loader` actually wires `bridge_quality` through:
    hardcoding "ok" there left the suite green, because metrics_are_real=False
    still refused. This ticker has a genuine (non-generic) corporate_metrics
    row, so metrics_are_real is True and only the bridge can refuse it -- which
    is also the realistic shape of the defect, since a stored metrics row makes
    the fabricated dcf_value look better attributed, not worse.
    """
    with get_db() as conn:
        conn.execute(
            "INSERT INTO stocks (ticker, date, close) VALUES ('REALMET', '2026-08-01', 431.65)"
        )
        # Deliberately unlike the generic defaults on every column that
        # `is_generic_default` inspects, so `load_fallback_metrics` reports it
        # as real. No statements are stored, so the equity bridge cannot resolve.
        conn.execute(
            """INSERT INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance, esg_penalty)
               VALUES ('REALMET', 9.5, 24.0, 8.5, 22.0, 1.2, 0.8, 41.0, 120.0,
                       77.0, 55.0, 68.0, 15.0)"""
        )

    row = _row(record_decision(ticker="REALMET", action="buy", memo="real metrics, no bridge"))

    assert row["figures_unavailable_reason"] is not None, row
    assert "bridge" in row["figures_unavailable_reason"], row
    assert row["dcf_value"] is None, row
    assert row["dcf_implied_return"] is None, row


def test_metrics_provenance_separates_a_stored_row_from_a_hashed_fallback():
    """`metrics_for_ticker_with_provenance` is the whole basis of the refusal
    above, and its flag was observable only transitively -- through a ticker
    that ALSO has no equity bridge, where the bridge guard fires first. Invert
    the flag and nothing else in the suite notices. Asserted directly here,
    with no statements in play (`bundle_loader` returns None), so the flag is
    reporting on the stored-row path and nothing else.
    """
    from apps.api.services.corporate_metrics_service import (
        metrics_for_ticker_with_provenance,
    )

    no_statements = lambda ticker, purpose=None: None

    _, unknown_is_real = metrics_for_ticker_with_provenance(
        "NOSUCHCO", bundle_loader=no_statements
    )
    assert unknown_is_real is False, "a ticker-hash fallback must not report as real"

    with get_db() as conn:
        conn.execute(
            """INSERT INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance, esg_penalty)
               VALUES ('STOREDCO', 9.5, 24.0, 8.5, 22.0, 1.2, 0.8, 41.0, 120.0,
                       77.0, 55.0, 68.0, 15.0)"""
        )

    stored, stored_is_real = metrics_for_ticker_with_provenance(
        "STOREDCO", bundle_loader=no_statements
    )
    assert stored_is_real is True, "a genuine stored row must report as real"
    assert stored.roic == 24.0


def test_the_default_loader_reports_both_discriminators_from_their_real_sources():
    """Asserted on the loader's OUTPUT, not through the guard chain.

    The guards are an `elif` chain, so a ticker that trips both discriminators
    is refused whichever one is wired correctly -- which is why hardcoding
    either key left the suite green. Reading the dict directly pins each key to
    its own source: `bridge_quality` to `_dcf_snapshot`, `metrics_are_real` to
    `metrics_for_ticker_with_provenance`.
    """
    with get_db() as conn:
        conn.execute(
            "INSERT INTO stocks (ticker, date, close) VALUES ('LOADCO', '2026-08-01', 431.65)"
        )
        conn.execute(
            """INSERT INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance, esg_penalty)
               VALUES ('LOADCO', 9.5, 24.0, 8.5, 22.0, 1.2, 0.8, 41.0, 120.0,
                       77.0, 55.0, 68.0, 15.0)"""
        )
        conn.execute(
            "INSERT INTO stocks (ticker, date, close) VALUES ('HASHCO', '2026-08-01', 431.65)"
        )

    # A genuine stored metrics row, but no statements anywhere -- so the metrics
    # are real and the equity bridge is not.
    real = investment_decision._default_figures_loader(
        "LOADCO", risk_free_rate=0.042, equity_risk_premium=0.055
    )
    assert real["metrics_are_real"] is True
    assert real["bridge_quality"] == "missing"

    # Neither a metrics row nor statements: both discriminators must say so.
    hashed = investment_decision._default_figures_loader(
        "HASHCO", risk_free_rate=0.042, equity_risk_premium=0.055
    )
    assert hashed["metrics_are_real"] is False
    assert hashed["bridge_quality"] == "missing"


def test_a_bug_in_the_loader_is_not_presented_as_a_modelling_judgement():
    """Finding 6 (MINOR): `except (ValueError, KeyError, TypeError)` cannot
    tell a deliberate refusal (e.g. `_figures_refused`'s ValueError) from a
    stack-level bug (a KeyError/TypeError), and previously stored the raw
    exception text verbatim -- indistinguishable, in a PERMANENT record, from
    a considered modelling judgement about the ticker. Prefixed so the two
    read differently."""
    def _buggy(ticker):
        raise KeyError("current_price")

    decision_id = record_decision(
        ticker="BUGGY", action="watch", memo="m", figures_loader=_buggy,
    )
    row = _row(decision_id)
    assert row["figures_unavailable_reason"].startswith("figures unavailable:"), row


def test_a_non_default_rate_passed_to_record_decision_reaches_the_loader(monkeypatch):
    """Overriding risk_free_rate/equity_risk_premium must change what is
    COMPUTED, not just what is stored -- otherwise the copied assumptions are
    not "a fixed record of what was actually believed"."""
    seen = {}

    def fake_default_loader(ticker, *, risk_free_rate, equity_risk_premium):
        seen["risk_free_rate"] = risk_free_rate
        seen["equity_risk_premium"] = equity_risk_premium
        return _figures_ok(ticker)

    monkeypatch.setattr(investment_decision, "_default_figures_loader", fake_default_loader)

    record_decision(
        ticker="MSFT", action="buy", memo="m",
        risk_free_rate=0.05, equity_risk_premium=0.065,
    )
    assert seen["risk_free_rate"] == 0.05
    assert seen["equity_risk_premium"] == 0.065
