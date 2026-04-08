from datetime import datetime

from apps.api.services.webscrap.Collector.GlobalMacroCollector import GlobalMacroCollector


class FakeYahooResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {
            "chart": {
                "result": [
                    {
                        "timestamp": [
                            int(datetime(2021, 4, 8).timestamp()),
                            int(datetime(2026, 4, 6).timestamp()),
                        ],
                        "indicators": {
                            "quote": [
                                {
                                    "close": [4000.0, 5200.0],
                                }
                            ]
                        },
                    }
                ]
            }
        }


def test_global_macro_collector_uses_five_year_yahoo_range(monkeypatch):
    captured_params = []

    def fake_get(url, headers, params, timeout):
        captured_params.append(params.copy())
        return FakeYahooResponse()

    monkeypatch.setattr(
        "apps.api.services.webscrap.Collector.GlobalMacroCollector.requests.get",
        fake_get,
    )

    collector = GlobalMacroCollector()
    collector.yahoo_tickers = {"^GSPC": ("S&P 500", "Global Macro")}

    rows = collector.fetch_yahoo_data()

    assert captured_params == [{"interval": "1d", "events": "history", "range": "5y"}]
    assert len(rows) == 2
    assert rows[0].date == "2021-04-08"
    assert rows[-1].date == "2026-04-06"
