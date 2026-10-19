"""Shape and size of the long risk fixture (tests/fixtures/risk_long)."""
from pathlib import Path

import pandas as pd

from tests.core_finance._fixture import FIXTURES, load_long

MAX_BYTES = 3 * 1024 * 1024


def test_long_fixture_shape():
    px, sox, rsp, shares, themes, fred = load_long()
    assert str(px.index[0].date()) == "2023-01-03" and str(px.index[-1].date()) == "2026-10-16"
    assert (sox.index == px.index).all() and (rsp.index == px.index).all()
    assert sox.notna().sum() > 900 and rsp.notna().sum() > 900
    assert "^SOX" not in px.columns and "RSP" not in px.columns
    assert px.shape[1] >= 240
    assert set(px.columns) <= set(themes) and len(shares) >= 240
    assert fred and all(isinstance(s, pd.Series) and len(s) > 0 for s in fred.values())
    raw = pd.read_csv(FIXTURES / "risk_long" / "closes.csv.gz", index_col="date")
    assert {"^SOX", "RSP"} <= set(raw.columns)


def test_long_fixture_size():
    total = sum(f.stat().st_size for f in Path(FIXTURES / "risk_long").rglob("*") if f.is_file())
    assert total <= MAX_BYTES
