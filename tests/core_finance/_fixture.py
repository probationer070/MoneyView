"""Loaders for the risk fixtures. Same return shapes as test_risk_acceptance._inputs."""
from functools import lru_cache
from pathlib import Path

import pandas as pd

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _load(fix: Path, closes_name: str):
    px = pd.read_csv(fix / closes_name, index_col="date", parse_dates=True)
    sox, rsp = px.pop("^SOX"), px.pop("RSP")
    shares = pd.read_csv(fix / "shares.csv").set_index("ticker")["shares"].to_dict()
    themes = pd.read_csv(fix / "themes.csv").set_index("ticker")["theme"].to_dict()
    fred = {
        f.stem: pd.read_csv(f, index_col="date", parse_dates=True)["value"]
        for f in sorted((fix / "fred").glob("*.csv"))
    }
    return px, sox, rsp, shares, themes, fred


@lru_cache(maxsize=1)
def load_long():
    """(closes, sox, rsp, shares, themes, fred) from tests/fixtures/risk_long, 2023-01-03..2026-10-16."""
    return _load(FIXTURES / "risk_long", "closes.csv.gz")
