from apps.api.services.acquisition.sources.quote_facts import fetch_quote_facts


class _FakeTicker:
    def __init__(self, info):
        self.info = info


def test_sector_and_industry_are_kept(monkeypatch):
    """`handle.info` already carries both; they were being discarded."""
    facts = fetch_quote_facts(
        "NVDA",
        ticker_factory=lambda _: _FakeTicker({
            "marketCap": 1_000.0, "sharesOutstanding": 10.0,
            "currency": "USD", "beta": 1.5,
            "sector": "Technology", "industry": "Semiconductors",
        }),
    )
    assert facts.sector == "Technology"
    assert facts.industry == "Semiconductors"


def test_missing_sector_and_industry_become_empty_strings_not_none():
    """Matches the existing `currency` convention in this dataclass."""
    facts = fetch_quote_facts(
        "X",
        ticker_factory=lambda _: _FakeTicker({"marketCap": 1.0, "sharesOutstanding": 1.0}),
    )
    assert facts.sector == ""
    assert facts.industry == ""
