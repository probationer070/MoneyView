"""One ticker that cannot be valued must not cost the whole batch.

`Calculate All Reports` sent every non-benchmark ticker to
`POST /corporate/dcf/reports/bulk`, which built each report in a bare loop. Any single
failure propagated out of the endpoint, so the caller got nothing at all for the other
138 tickers.

The failure is not rare. `ValuationAssumptions.terminal_growth_rate` is capped at
`le=0.1`, and `_valuation_params_from_metrics` derives that rate from the company's own
growth with no clamp, so every fast grower raises. Measured against the live watchlist,
5 of the first 20 tickers did -- ASM 0.1415, AMD 0.1364, ANET 0.1334, ARIS 0.1254,
AXP 0.1055 -- which is why the button never worked on a real universe.

Skipping is deliberately not silent: a batch that quietly returned 134 of 139 reports
would be this repo's own defect class, a number wearing a completeness it has not
earned. Each skip is named with its reason.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from apps.api.models.schemas import ValuationAssumptions
from apps.api.services.corporate_dcf import build_bulk_dcf_reports


class _Report:
    def __init__(self, ticker: str) -> None:
        self.ticker = ticker


def _metrics(ticker: str):
    return {"ticker": ticker}


def _valid_params(**overrides) -> ValuationAssumptions:
    """A params object that satisfies every bound, so only the override under test fails."""
    return ValuationAssumptions(
        **{
            "revenue_growth_rate": 0.08,
            "operating_margin": 0.25,
            "tax_rate": 0.21,
            "wacc": 0.09,
            "terminal_growth_rate": 0.025,
            **overrides,
        }
    )


def _params_builder_that_refuses(bad: set[str]):
    """Mirrors the real failure: the params model rejects a derived growth rate."""

    def build(metrics):
        if metrics["ticker"] in bad:
            # 0.1364 is AMD's derived rate against the model's le=0.1 cap -- the real value
            # from the real watchlist, so the fixture cannot drift from the defect.
            return _valid_params(terminal_growth_rate=0.1364)
        return _valid_params()

    return build


def _build(tickers, bad=frozenset()):
    return build_bulk_dcf_reports(
        tickers,
        current_price_loader=lambda ticker: 100.0,
        metrics_loader=_metrics,
        valuation_params_builder=_params_builder_that_refuses(set(bad)),
        report_builder=lambda ticker, **_: _Report(ticker),
        risk_free_rate=0.04,
    )


def test_a_refused_ticker_does_not_cost_the_others():
    result = _build(["AAPL", "AMD", "MSFT"], bad={"AMD"})

    assert [report.ticker for report in result.reports] == ["AAPL", "MSFT"]


def test_every_skip_is_named_with_a_reason():
    result = _build(["AAPL", "AMD", "MSFT"], bad={"AMD"})

    assert [skip.ticker for skip in result.skipped] == ["AMD"]
    assert "terminal_growth_rate" in skip_reason(result)


def skip_reason(result) -> str:
    return " ".join(skip.reason for skip in result.skipped)


def test_a_clean_batch_reports_no_skips():
    result = _build(["AAPL", "MSFT"])

    assert [report.ticker for report in result.reports] == ["AAPL", "MSFT"]
    assert result.skipped == []


def test_every_ticker_refused_is_reported_rather_than_raising():
    """The empty case must still answer, or the caller cannot tell refusal from a crash."""
    result = _build(["AMD", "ANET"], bad={"AMD", "ANET"})

    assert result.reports == []
    assert [skip.ticker for skip in result.skipped] == ["AMD", "ANET"]


def test_the_counts_account_for_every_requested_ticker():
    """Requested == valued + skipped, after de-duplication."""
    requested = ["AAPL", "AMD", "MSFT", "aapl"]
    result = _build(requested, bad={"AMD"})

    assert len(result.reports) + len(result.skipped) == 3


def test_the_cap_that_causes_this_is_real():
    """Pins the upstream constraint, so a later loosening does not silently strand this."""
    with pytest.raises(ValidationError):
        _valid_params(terminal_growth_rate=0.1364)
