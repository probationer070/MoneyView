"""Fetch inputs for the risk-alert backtest into bt2/cache/. Read-only against the repo.

Outputs:
  cache/db_close.csv     wide close table from the local DB (watchlist tickers)
  cache/watchlist.csv    ticker, theme
  cache/shares.csv       ticker, shares, source (db | yfinance)
  cache/yf_close.csv     yfinance auto-adjusted closes: all watchlist tickers + ^SOX, RSP, SPY
  cache/fred_<id>.csv    FRED observations (date, value)
"""
import os
import sqlite3
import time
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
CACHE.mkdir(exist_ok=True)
REPO = Path(r"C:\Learn\Economy\MoneyView")
DB = REPO / "data" / "processed" / "moneyview.db"
START, END = "2015-06-01", "2026-10-17"  # END exclusive in yfinance -> includes 2026-10-16
FRED_SERIES = ["BAMLH0A0HYM2", "DGS10", "THREEFYTP10", "DCOILBRENTEU", "DFEDTARU",
               "CPILFESL", "CPIAUCSL", "PCEPILFE"]


def fred_key():
    for line in (REPO / "config" / ".env").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("FRED_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("FRED_API_KEY not found")


def main():
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    wl = pd.read_sql("select ticker, theme from watchlist", con)
    wl.to_csv(CACHE / "watchlist.csv", index=False)
    px = pd.read_sql("select ticker, date, close from stocks where ticker in (select ticker from watchlist)", con)
    px.pivot(index="date", columns="ticker", values="close").to_csv(CACHE / "db_close.csv")
    sh = pd.read_sql("select ticker, shares_outstanding as shares from corporate_quote_facts "
                     "where shares_outstanding is not null", con)
    sh = sh[sh.ticker.isin(wl.ticker)].assign(source="db")
    con.close()

    tickers = sorted(wl.ticker) + ["^SOX", "RSP", "SPY"]
    if not (CACHE / "yf_close.csv").exists():
        yc = yf.download(tickers, start=START, end=END, auto_adjust=True, progress=False, threads=True)["Close"]
        yc.to_csv(CACHE / "yf_close.csv")

    missing = sorted(set(wl.ticker) - set(sh.ticker))
    rows = []
    for t in missing:
        for attempt in range(3):
            try:
                rows.append({"ticker": t, "shares": float(yf.Ticker(t).fast_info["shares"]), "source": "yfinance"})
                break
            except Exception as e:  # noqa: BLE001 - retry then record failure
                time.sleep(3 * (attempt + 1))
                if attempt == 2:
                    print("shares failed", t, type(e).__name__)
        time.sleep(0.4)
    pd.concat([sh, pd.DataFrame(rows)]).to_csv(CACHE / "shares.csv", index=False)

    key = fred_key()
    for s in FRED_SERIES:
        r = requests.get("https://api.stlouisfed.org/fred/series/observations",
                         params={"series_id": s, "api_key": key, "file_type": "json",
                                 "observation_start": "2014-01-01"}, timeout=60)
        r.raise_for_status()
        obs = pd.DataFrame(r.json()["observations"])[["date", "value"]]
        obs["value"] = pd.to_numeric(obs["value"], errors="coerce")
        obs.dropna().to_csv(CACHE / f"fred_{s}.csv", index=False)
        print(s, len(obs), obs.date.max())
        time.sleep(0.6)


if __name__ == "__main__":
    main()
