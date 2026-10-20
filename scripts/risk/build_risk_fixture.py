"""Build the fixed risk-engine test fixture from the research backtest's cache. Run once; commit the output.

Reads only ``--cache`` (made by docs/superpowers/specs/2026-10-19-risk-engine-evidence/fetch_data.py) and
writes only tests/fixtures/risk/:

- closes.csv  wide, ``date`` plus one column per ticker and ^SOX, RSP; 2026-01-02..2026-10-16.
              Built as backtest.load_prices does: DB closes on the SPY calendar, extended before the
              first and after the last DB bar with yfinance closes rescaled to meet the DB close.
- shares.csv  ticker,shares
- themes.csv  ticker,theme
- fred/<SERIES>.csv  date,value from 2025-01-01, for every RISK_FRED_SERIES present in the cache.

    python scripts/risk/build_risk_fixture.py [--cache DIR] [--long]

``--long`` writes tests/fixtures/risk_long/ instead (closes.csv.gz, 2023-01-03..2026-10-16, unrounded,
under 3 MB; shares.csv, themes.csv and fred/ built the same way, with FRED from 2022-01-01).
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
OUT_LONG = ROOT / "tests" / "fixtures" / "risk_long"
CLOSE_FROM, CLOSE_TO = "2026-01-02", "2026-10-16"
LONG_FROM = "2023-01-03"
FRED_FROM = "2025-01-01"
FRED_FROM_LONG = "2022-01-01"
HISTORY_FROM = "2015-06-01"  # the calendar start load_prices uses


def load_closes(cache: Path, close_from: str = CLOSE_FROM) -> pd.DataFrame:
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
    return px.loc[close_from:CLOSE_TO]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--long", action="store_true")
    args = ap.parse_args()
    cache, out = args.cache, (OUT_LONG if args.long else OUT)
    fred_from = FRED_FROM_LONG if args.long else FRED_FROM

    (out / "fred").mkdir(parents=True, exist_ok=True)
    if args.long:
        load_closes(cache, LONG_FROM).to_csv(out / "closes.csv.gz", date_format="%Y-%m-%d", compression="gzip")
    else:
        load_closes(cache).to_csv(out / "closes.csv", date_format="%Y-%m-%d")
    shares = pd.read_csv(cache / "shares.csv").drop_duplicates("ticker")
    shares[["ticker", "shares"]].to_csv(out / "shares.csv", index=False)
    pd.read_csv(cache / "watchlist.csv")[["ticker", "theme"]].to_csv(out / "themes.csv", index=False)

    for series in RISK_FRED_SERIES:
        src = cache / f"fred_{series}.csv"
        if not src.exists():
            print(f"skip {series}: not in cache")
            continue
        df = pd.read_csv(src, parse_dates=["date"])
        df = df[df["date"] >= fred_from].dropna(subset=["value"])
        df.to_csv(out / "fred" / f"{series}.csv", index=False, date_format="%Y-%m-%d")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
