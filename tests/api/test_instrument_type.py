"""An ETF or an index is not an operating company, and must not be valued as one.

`Calculate All Reports` sent every non-benchmark row to the DCF builder, including the
gold and silver ETFs on the watchlist. A DCF discounts a firm's future cash flows; an ETF
has none of its own, so any number produced for one is meaningless rather than merely
imprecise.

The classification is yfinance's own `quoteType`, read from the same `info` payload
`quote_facts` already fetches -- so it costs no extra provider call, which matters because
concurrent live fetching has already earned this project a Yahoo rate limit
(ERROR-LOG.md). Rows acquired before this exist with no type, and are treated as eligible
rather than excluded: excluding the unknown would silently shrink the universe to almost
nothing on the day this ships.
"""

from __future__ import annotations

from apps.api.services.acquisition.sources.quote_facts import normalize_instrument_type
from apps.api.services.corporate_dcf import partition_valuable_tickers


class TestNormalisation:
    def test_yfinance_equity_becomes_equity(self):
        assert normalize_instrument_type("EQUITY") == "equity"

    def test_yfinance_etf_becomes_etf(self):
        assert normalize_instrument_type("ETF") == "etf"

    def test_yfinance_index_becomes_index(self):
        assert normalize_instrument_type("INDEX") == "index"

    def test_mutualfund_is_kept_distinct_from_etf(self):
        """Both are funds, but conflating them would misreport what the row is."""
        assert normalize_instrument_type("MUTUALFUND") == "mutualfund"

    def test_an_absent_type_is_unknown_not_equity(self):
        """Guessing equity here is what would put an ETF through a DCF."""
        assert normalize_instrument_type(None) == ""
        assert normalize_instrument_type("") == ""

    def test_an_unrecognised_type_is_preserved_rather_than_flattened(self):
        """CRYPTOCURRENCY and CURRENCY are real quoteTypes; recording them beats "other"."""
        assert normalize_instrument_type("CRYPTOCURRENCY") == "cryptocurrency"


class TestPartition:
    def test_an_etf_is_refused_with_a_reason(self):
        valuable, refused = partition_valuable_tickers(
            ["AAPL", "SLV"], {"AAPL": "equity", "SLV": "etf"}
        )

        assert valuable == ["AAPL"]
        assert [item.ticker for item in refused] == ["SLV"]
        assert "etf" in refused[0].reason.lower()

    def test_an_index_is_refused(self):
        valuable, refused = partition_valuable_tickers(["^GSPC"], {"^GSPC": "index"})

        assert valuable == []
        assert [item.ticker for item in refused] == ["^GSPC"]

    def test_an_unclassified_ticker_is_still_valued(self):
        """Every row acquired before this column existed is unclassified.

        Excluding them would empty the batch on the day this ships, which is a worse
        failure than valuing a handful of funds for one more acquisition cycle.
        """
        valuable, refused = partition_valuable_tickers(["AAPL", "OLD"], {"AAPL": "equity"})

        assert valuable == ["AAPL", "OLD"]
        assert refused == []

    def test_the_partition_accounts_for_every_ticker(self):
        valuable, refused = partition_valuable_tickers(
            ["A", "B", "C"], {"A": "equity", "B": "etf", "C": "index"}
        )

        assert len(valuable) + len(refused) == 3

    def test_order_is_preserved_so_the_report_list_stays_stable(self):
        valuable, _ = partition_valuable_tickers(
            ["MSFT", "AAPL", "SLV"], {"MSFT": "equity", "AAPL": "equity", "SLV": "etf"}
        )

        assert valuable == ["MSFT", "AAPL"]
