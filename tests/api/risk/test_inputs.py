"""Inputs loader. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd

from apps.api.services.db import get_db
from apps.api.services.risk import inputs
from apps.api.services.risk.rules import get_rules
from apps.api.services.signals import store
from packages.core_finance.macro_signals.rules import Observation

RULES = get_rules().rules


def _seed():
    with get_db() as conn:
        conn.executemany(
            "INSERT INTO watchlist (ticker, name, theme) VALUES (?, ?, ?)",
            [("NVDA", "NVIDIA", "ai_semis"), ("KO", "Coca-Cola", "defensives_other"), ("XYZ", "", ""), ("^SOX", "", "")])
        bars = [("NVDA", "2026-10-15", 100.0), ("NVDA", "2026-10-16", 101.0), ("KO", "2026-10-15", 60.0),
                ("^SOX", "2026-10-15", 5000.0), ("^SOX", "2026-10-16", 5100.0), ("RSP", "2026-10-16", 180.0),
                ("NVDA", "2026-10-19", 105.0), ("NVDA", "2000-01-03", 1.0)]
        conn.executemany("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, ?)", bars)
        conn.execute("INSERT INTO corporate_quote_facts (ticker, shares_outstanding, fetched_at) VALUES ('NVDA', 24000.0, 'x')")
        conn.execute("INSERT INTO corporate_quote_facts (ticker, shares_outstanding, fetched_at) VALUES ('KO', NULL, 'x')")


def test_loads_closes_shares_themes():
    """Catches benchmarks leaking into closes, `through` ignored, history_start ignored, NULL shares kept,
    empty theme/name kept, or a non-datetime index."""
    _seed()
    got = inputs.load_inputs(through=date(2026, 10, 16), fetch_fred=False)
    assert list(got.closes.columns) == ["KO", "NVDA"]
    assert isinstance(got.closes.index, pd.DatetimeIndex)
    assert got.closes.index.max() == pd.Timestamp("2026-10-16")
    assert got.closes.index.min() == pd.Timestamp("2026-10-15")
    assert pd.isna(got.closes.loc["2026-10-16", "KO"])
    assert got.closes.loc["2026-10-16", "NVDA"] == 101.0
    assert list(got.sox.index) == [pd.Timestamp("2026-10-15"), pd.Timestamp("2026-10-16")]
    assert got.sox.iloc[-1] == 5100.0
    assert list(got.rsp) == [180.0]
    assert got.shares == {"NVDA": 24000.0}
    assert got.themes == {"NVDA": "ai_semis", "KO": "defensives_other"}
    assert got.names == {"NVDA": "NVIDIA", "KO": "Coca-Cola"}


def test_fred_from_cache_when_no_key(monkeypatch):
    """Catches dropping cached observations on a fetch error, or losing the key reason."""
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    store.save_cache("DGS10", [Observation(date(2026, 10, 15), 4.2)], "2026-10-16T00:00:00")
    got = inputs.load_inputs(fetch_fred=True, now=datetime(2026, 10, 19, tzinfo=UTC))
    assert list(got.fred["DGS10"]) == [4.2]
    assert isinstance(got.fred["DGS10"].index, pd.DatetimeIndex)
    assert any(e.startswith("DGS10:") and "FRED_API_KEY" in e for e in got.fred_errors)
    assert got.fred["PAYEMS"].empty
    offline = inputs.load_inputs(fetch_fred=False)
    assert offline.fred_errors == [] and list(offline.fred["DGS10"]) == [4.2]


def test_coverage_counts_only_trigger_themes():
    """Catches counting excluded or unthemed tickers, a wrong denominator, or a missing day counted as covered."""
    day = date(2026, 10, 16)
    idx = pd.DatetimeIndex(["2026-10-15", "2026-10-16"])
    nan = float("nan")
    closes = pd.DataFrame({"A": [1.0, 1.0], "B": [1.0, nan], "D": [1.0, nan], "U": [1.0, nan]}, index=idx)
    themes = {"A": "ai_semis", "B": "ai_semis", "D": "defensives_other"}
    assert inputs.coverage(closes, themes, day, RULES) == 0.5
    assert inputs.coverage(closes.drop(columns="B"), themes, day, RULES) == 1.0
    assert inputs.coverage(closes, {"D": "defensives_other"}, day, RULES) == 0.0
    assert inputs.coverage(closes, themes, date(2026, 10, 17), RULES) == 0.0
