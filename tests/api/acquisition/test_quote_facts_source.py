from types import SimpleNamespace

from apps.api.services.acquisition.sources.quote_facts import QuoteFacts, fetch_quote_facts


def _fake_ticker(info):
    return SimpleNamespace(info=info)


def test_reads_market_cap_shares_and_currency():
    facts = fetch_quote_facts(
        "AAPL",
        ticker_factory=lambda _: _fake_ticker(
            {"marketCap": 4_957_276_209_152, "sharesOutstanding": 14_687_356_000, "currency": "USD"}
        ),
    )

    assert facts == QuoteFacts("AAPL", 4_957_276_209_152.0, 14_687_356_000.0, "USD")


def test_beta_is_carried_through():
    """WACC's levered beta reads info["beta"] and otherwise re-derives it from the
    fallback's unlevered beta. The provider dict already carries it, so dropping it here
    would silently switch every ticker's cost of equity onto the fallback path."""
    facts = fetch_quote_facts(
        "AAPL",
        ticker_factory=lambda _: _fake_ticker(
            {"marketCap": 4_957_276_209_152, "sharesOutstanding": 14_687_356_000,
             "currency": "USD", "beta": 1.21}
        ),
    )

    assert facts.beta == 1.21


def test_a_missing_beta_stays_none():
    facts = fetch_quote_facts(
        "NOBETA",
        ticker_factory=lambda _: _fake_ticker({"marketCap": 100.0, "currency": "USD"}),
    )

    assert facts.beta is None


def test_a_missing_market_cap_stays_none():
    """SPY reports marketCap None. That must reach the missing_market_cap quality rule as
    missing, not as a zero that a WACC weight would divide by."""
    facts = fetch_quote_facts(
        "SPY",
        ticker_factory=lambda _: _fake_ticker({"sharesOutstanding": 917_782_016, "currency": "USD"}),
    )

    assert facts.market_cap is None
    assert facts.shares_outstanding == 917_782_016.0


def test_empty_info_returns_none():
    assert fetch_quote_facts("NOPE", ticker_factory=lambda _: _fake_ticker({})) is None


def test_a_provider_that_raises_on_info_returns_none():
    class Raises:
        @property
        def info(self):
            raise ValueError("provider blew up")

    assert fetch_quote_facts("BAD", ticker_factory=lambda _: Raises()) is None
