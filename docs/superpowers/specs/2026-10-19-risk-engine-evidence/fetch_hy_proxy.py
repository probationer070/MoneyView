"""HY spread proxy inputs. FRED serves BAMLH0A0HYM2 only from 2023-10-17 (ICE 3-year limit),
so W1 needs a proxy for 2016-2023. Candidates: FRED BAA10Y and yfinance HYG/IEF."""
from pathlib import Path
import time, pandas as pd, requests, yfinance as yf
import importlib.util
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("fd", HERE / "fetch_data.py"); fd = importlib.util.module_from_spec(spec); spec.loader.exec_module(fd)
key = fd.fred_key()
for s in ["BAA10Y"]:
    r = requests.get("https://api.stlouisfed.org/fred/series/observations",
                     params={"series_id": s, "api_key": key, "file_type": "json", "observation_start": "2014-01-01"}, timeout=60)
    r.raise_for_status()
    o = pd.DataFrame(r.json()["observations"])[["date", "value"]]
    o["value"] = pd.to_numeric(o["value"], errors="coerce")
    o.dropna().to_csv(HERE / "cache" / f"fred_{s}.csv", index=False)
    print(s, len(o), o.date.min(), o.date.max())
yf.download(["HYG", "IEF"], start="2015-06-01", end="2026-10-17", auto_adjust=True, progress=False)["Close"].to_csv(HERE / "cache" / "yf_credit.csv")
