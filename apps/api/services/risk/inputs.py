"""Everything the pure risk evaluator needs, read from the local DB and the FRED cache."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime

import pandas as pd

from apps.api.services.db import get_db
from apps.api.services.risk.constants import BENCHMARK_TICKERS, RISK_FRED_SERIES
from apps.api.services.risk.rules import LoadedRules, get_rules
from apps.api.services.signals import store
from apps.api.services.signals.fetch import SeriesFetcher, fred_source_from_env
from packages.core_finance.risk_signals.config import RiskRules

FRED_START = date(2014, 1, 1)


@dataclass(frozen=True)
class RiskInputs:
    closes: pd.DataFrame
    sox: pd.Series
    rsp: pd.Series
    shares: dict[str, float]
    themes: dict[str, str]
    names: dict[str, str]
    fred: dict[str, pd.Series]
    fred_errors: list[str]


def _wide(rows: list[tuple[str, str, float]], tickers: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame(rows, columns=["ticker", "date", "close"])
    frame["date"] = pd.to_datetime(frame["date"])
    frame["close"] = frame["close"].astype(float)
    wide = frame.pivot(index="date", columns="ticker", values="close").sort_index()
    wide.index = pd.DatetimeIndex(wide.index)
    wide.columns.name = None
    return wide.reindex(columns=[t for t in tickers if t in wide.columns])


def _fred_series(observations) -> pd.Series:
    return pd.Series(
        [float(o.value) for o in observations],
        index=pd.DatetimeIndex([pd.Timestamp(o.date) for o in observations]),
        dtype=float,
    )


def cached_fred() -> dict[str, pd.Series]:
    """Every engine FRED series from the local cache only; never the network."""
    return {sid: _fred_series(store.load_cache(sid, FRED_START)) for sid in RISK_FRED_SERIES}


def load_inputs(
    *,
    through: date | None = None,
    fetch_fred: bool = True,
    now: datetime | None = None,
    loaded: LoadedRules | None = None,
    since: date | None = None,
) -> RiskInputs:
    """`since` trims closes, ^SOX and RSP to dates >= since (FRED is never trimmed). The closes keep
    the columns of an untrimmed load, so a ticker with no bar since then stays as an empty column."""
    rules = (loaded or get_rules()).rules
    start = rules.history_start.isoformat()
    first = max(since, rules.history_start).isoformat() if since is not None else start
    end = (through or date.max).isoformat()
    with get_db() as conn:
        watch = conn.execute("SELECT ticker, name, theme FROM watchlist ORDER BY ticker").fetchall()
        bars = conn.execute(
            "SELECT ticker, date, close FROM stocks WHERE date >= ? AND date <= ? AND close IS NOT NULL",
            (first, end)).fetchall()
        present = None if since is None else {r["ticker"] for r in conn.execute(
            "SELECT DISTINCT ticker FROM stocks WHERE date >= ? AND date <= ? AND close IS NOT NULL",
            (start, end))}
        shares = {
            r["ticker"]: float(r["shares_outstanding"])
            for r in conn.execute(
                "SELECT ticker, shares_outstanding FROM corporate_quote_facts "
                "WHERE shares_outstanding IS NOT NULL")}
    tickers = [r["ticker"] for r in watch if r["ticker"] not in BENCHMARK_TICKERS]
    rows = [(b["ticker"], b["date"], b["close"]) for b in bars]
    tracked = set(tickers)
    closes = _wide([r for r in rows if r[0] in tracked], tickers)
    if present is not None:
        closes = closes.reindex(columns=[t for t in tickers if t in present])
    benchmarks = _wide([r for r in rows if r[0] in ("^SOX", "RSP")], ["^SOX", "RSP"])
    benchmarks = benchmarks.reindex(columns=["^SOX", "RSP"])

    fred: dict[str, pd.Series] = {}
    fred_errors: list[str] = []
    fetcher = (
        SeriesFetcher(fred_source_from_env(), now=lambda: now or datetime.now(UTC)) if fetch_fred else None
    )
    for series_id in RISK_FRED_SERIES:
        if fetcher is not None:
            # A successful fetch has already written its rolling window into fred_cache; the engine
            # reads the accumulated cache so rows older than that window stay in the series.
            fetched = fetcher.get_series(series_id, FRED_START)
            if fetched.error:
                fred_errors.append(f"{series_id}: {fetched.error}")
        fred[series_id] = _fred_series(store.load_cache(series_id, FRED_START))

    return RiskInputs(
        closes=closes,
        sox=benchmarks["^SOX"].dropna(),
        rsp=benchmarks["RSP"].dropna(),
        shares=shares,
        themes={r["ticker"]: r["theme"] for r in watch if r["theme"]},
        names={r["ticker"]: r["name"] for r in watch if r["name"]},
        fred=fred,
        fred_errors=fred_errors,
    )


def coverage(closes: pd.DataFrame, themes: Mapping[str, str], day: date, rules: RiskRules) -> float:
    """Share of trigger-theme tickers (themed, not excluded, in closes) that have a close on `day`."""
    tracked = [t for t in closes.columns if themes.get(t) and themes[t] not in rules.excluded_themes]
    stamp = pd.Timestamp(day)
    if not tracked or stamp not in closes.index:
        return 0.0
    return float(closes.loc[stamp, tracked].notna().sum()) / len(tracked)
