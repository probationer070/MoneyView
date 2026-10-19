"""One entry point for the risk engine: indices, shapes, warnings, confirmations and the alert walk.

Pure: no DB, no network. The service uses it for both the backfill and the live run.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Mapping

import pandas as pd

from packages.core_finance.risk_signals.alerts import AlertRecord, OpenAlert, confirmations, run_alerts
from packages.core_finance.risk_signals.config import RiskRules
from packages.core_finance.risk_signals.indices import price_shapes, theme_cap_share, theme_indices
from packages.core_finance.risk_signals.warnings import WARNING_IDS, market_warnings


@dataclass(frozen=True)
class DayResult:
    day: date
    warnings: dict[str, tuple[str, float | None, date | None]]  # id -> (state, value, observed_at)
    w1_proxy: bool
    on_count: int
    confirming: dict[str, str]  # theme -> via ("theme" | "sox")
    sox_confirm: bool
    cap_share: float  # summed cap share of the confirming themes, fraction of total cap
    opened: bool


@dataclass(frozen=True)
class EvaluationResult:
    days: list[DayResult]
    closed: list[AlertRecord]
    open: OpenAlert | None
    levels: pd.DataFrame  # theme indices over the full input history


def _opt_float(v) -> float | None:
    return None if pd.isna(v) else float(v)


def _opt_date(v) -> date | None:
    return None if pd.isna(v) else pd.Timestamp(v).date()


def evaluate_range(
    closes: pd.DataFrame,
    sox: pd.Series,
    rsp: pd.Series,
    shares: Mapping[str, float],
    themes: Mapping[str, str],
    fred: Mapping[str, pd.Series],
    rules: RiskRules,
    *,
    start: date,
    end: date,
    state: OpenAlert | None = None,
) -> EvaluationResult:
    """Compute everything over the whole input history; walk the alerts over start..end only.

    The calendar is the dates where ``sox`` has a value. Inputs before ``start`` serve only the
    rolling windows; ``state`` is the alert open at the end of the previous run, if any.
    """
    cal = pd.DatetimeIndex(sox.dropna().index).sort_values()
    px = closes.reindex(cal)
    sox_c, rsp_c = sox.reindex(cal), rsp.reindex(cal)

    levels = theme_indices(px, shares, themes, rules.min_members)
    cap = theme_cap_share(px, shares, themes)
    window = rules.price.window
    theme_shapes = {t: price_shapes(levels[t], window) for t in levels.columns}
    wf = market_warnings(cal, fred, sox_c, rsp_c, rules)
    conf = confirmations(theme_shapes, price_shapes(sox_c, window), wf.on_count, rules)

    walk = cal[(cal >= pd.Timestamp(start)) & (cal <= pd.Timestamp(end))]
    dates = [ts.date() for ts in walk]
    closed, open_ = run_alerts(dates, conf, cap, theme_shapes, rules, state)

    starts = {a.start for a in closed} | ({open_.start} if open_ is not None else set())
    if state is not None:
        starts.discard(state.start)
    days = []
    for ts in walk:
        confirming = {t: str(conf.via.at[ts, t]) for t in conf.theme.columns if bool(conf.theme.at[ts, t])}
        days.append(
            DayResult(
                day=ts.date(),
                warnings={
                    w: (
                        str(wf.state.at[ts, w]),
                        _opt_float(wf.value.at[ts, w]),
                        _opt_date(wf.observed_at.at[ts, w]),
                    )
                    for w in WARNING_IDS
                },
                w1_proxy=bool(wf.w1_proxy.at[ts]),
                on_count=int(wf.on_count.at[ts]),
                confirming=confirming,
                sox_confirm=bool(conf.sox.at[ts]),
                cap_share=sum(float(cap.at[ts, t]) for t in confirming if t in cap.columns),
                opened=ts.date() in starts,
            )
        )
    return EvaluationResult(days=days, closed=closed, open=open_, levels=levels)
