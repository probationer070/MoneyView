"""Build the fixed risk-engine test fixture from the research backtest's cache. Run once; commit the output.

Reads only ``--cache`` (made by docs/superpowers/specs/2026-10-19-risk-engine-evidence/fetch_data.py) and
writes only tests/fixtures/risk/:

- closes.csv  wide, ``date`` plus one column per ticker and ^SOX, RSP; 2026-01-02..2026-10-16.
              Built as backtest.load_prices does: DB closes on the SPY calendar, extended before the
              first and after the last DB bar with yfinance closes rescaled to meet the DB close.
- shares.csv  ticker,shares
- themes.csv  ticker,theme
- fred/<SERIES>.csv  date,value from 2025-01-01, for every RISK_FRED_SERIES present in the cache.

    python scripts/risk/build_risk_fixture.py [--cache DIR]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from apps.api.services.risk.constants import RISK_FRED_SERIES  # noqa: E402

DEFAULT_CACHE = Path(
    r"C:\Users\eajwa\AppData\Local\Temp\claude\C--Learn-Economy-MoneyView"
    r"\eff61464-eb4c-4371-838d-2002f30d8aaa\scratchpad\bt2\cache"
)
OUT = ROOT / "tests" / "fixtures" / "risk"
CLOSE_FROM, CLOSE_TO = "2026-01-02", "2026-10-16"
FRED_FROM = "2025-01-01"
HISTORY_FROM = "2015-06-01"  # the calendar start load_prices uses


def load_closes(cache: Path) -> pd.DataFrame:
    yc = pd.read_csv(cache / "yf_close.csv", index_col=0, parse_dates=True)
    cal = yc["SPY"].dropna().index
    cal = cal[cal >= HISTORY_FROM]
    db = pd.read_csv(cache / "db_close.csv", index_col=0, parse_dates=True).reindex(cal)
    out = {}
    for t in db.columns:
        s = db[t].copy()
        first, last = s.first_valid_index(), s.last_valid_index()
        if t in yc.columns and first is not None:
            y = yc[t].reindex(cal)
            if pd.notna(y.get(first)):
                head = y[y.index < first] / y[first] * s[first]
                s[head.index] = head
            if pd.notna(y.get(last)):
                tail = y[y.index > last] / y[last] * s[last]
                s[tail.index] = tail
        out[t] = s
    px = pd.DataFrame(out)
    for bench in ("^SOX", "RSP"):
        px[bench] = yc[bench].reindex(cal)
    px.index.name = "date"
    return px.loc[CLOSE_FROM:CLOSE_TO]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    cache = ap.parse_args().cache

    (OUT / "fred").mkdir(parents=True, exist_ok=True)
    load_closes(cache).to_csv(OUT / "closes.csv", date_format="%Y-%m-%d")
    shares = pd.read_csv(cache / "shares.csv").drop_duplicates("ticker")
    shares[["ticker", "shares"]].to_csv(OUT / "shares.csv", index=False)
    pd.read_csv(cache / "watchlist.csv")[["ticker", "theme"]].to_csv(OUT / "themes.csv", index=False)

    for series in RISK_FRED_SERIES:
        src = cache / f"fred_{series}.csv"
        if not src.exists():
            print(f"skip {series}: not in cache")
            continue
        df = pd.read_csv(src, parse_dates=["date"])
        df = df[df["date"] >= FRED_FROM].dropna(subset=["value"])
        df.to_csv(OUT / "fred" / f"{series}.csv", index=False, date_format="%Y-%m-%d")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
