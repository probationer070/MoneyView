"""One entry point for the risk engine: indices, shapes, warnings, confirmations and the alert walk,
plus the surge components, the surge event walk and the daily movers.

Pure: no DB, no network. The service uses it for both the backfill and the live run.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Mapping

import pandas as pd

from packages.core_finance.risk_signals.alerts import AlertRecord, OpenAlert, confirmations, run_alerts
from packages.core_finance.risk_signals.config import RiskRules
from packages.core_finance.risk_signals.indices import price_shapes, theme_cap_share, theme_indices
from packages.core_finance.risk_signals.movers import Mover, movers_by_day
from packages.core_finance.risk_signals.surge import (
    SOX, SurgeComponents, SurgeEvent, SurgeState, run_surge, surge_components,
)
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
    # Surge and movers. The defaults stand for "not evaluated"; evaluate_range always fills them.
    # series (themes, "^SOX") with a level that day -> {_SURGE_FLOATS: float | None, _SURGE_FLAGS: bool}
    surge: dict[str, dict] | None = None
    surge_banner: bool = False
    surge_cap_share: float = 0.0  # fraction of watchlist cap held by themes in an event
    surge_started: list[str] = field(default_factory=list)  # series whose event started this day
    # started series -> banner on its start day. The only place "shown" exists: SurgeEvent has no such
    # field and a one-day run cannot recompute it at the close, so it is persisted at the start.
    surge_shown: dict[str, bool] = field(default_factory=dict)
    movers: list[Mover] = field(default_factory=list)


@dataclass(frozen=True)
class EvaluationResult:
    days: list[DayResult]
    closed: list[AlertRecord]
    open: OpenAlert | None
    levels: pd.DataFrame  # theme indices over the full input history
    surge_closed: list[SurgeEvent]  # surge events that ended in start..end
    surge_state: SurgeState  # open events and last confirmations at ``end``, for the next run
    surge_components: SurgeComponents  # over the full input history


_SURGE_FLOATS = ("magnitude_z", "accel_pct", "accel_rank", "breadth_pct", "rsi")
_SURGE_FLAGS = ("magnitude_on", "accel_on", "breadth_on", "rsi_on", "on", "overheated")


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
    surge_state: SurgeState | None = None,
) -> EvaluationResult:
    """Compute everything over the whole input history; walk the alerts and surge events over
    start..end only.

    The calendar is the dates where ``sox`` has a value. Inputs before ``start`` serve only the
    rolling windows; ``state`` is the alert open at the end of the previous run, if any, and
    ``surge_state`` the surge events open and last confirmations at the end of the previous run.
    Movers rank ``closes`` (watchlist tickers only) on that calendar.
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

    comps = surge_components(levels, px, shares, themes, sox_c, rules)
    surge_closed, surge_end, surge_days = run_surge(
        dates, comps, levels.assign(**{SOX: sox_c}), cap, rules, surge_state
    )
    surge_maps = _surge_maps(comps, walk)
    movers = movers_by_day(px, dates, rules)

    starts = {a.start for a in closed} | ({open_.start} if open_ is not None else set())
    if state is not None:
        starts.discard(state.start)
    days = []
    for ts in walk:
        sd = surge_days[ts.date()]
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
                surge=surge_maps[ts],
                surge_banner=sd.banner,
                surge_cap_share=sd.cap_share,
                surge_started=list(sd.started),
                surge_shown={t: sd.banner for t in sd.started},
                movers=movers[ts.date()],
            )
        )
    return EvaluationResult(
        days=days, closed=closed, open=open_, levels=levels,
        surge_closed=surge_closed, surge_state=surge_end, surge_components=comps,
    )


def _surge_maps(comps: SurgeComponents, walk: pd.DatetimeIndex) -> dict[pd.Timestamp, dict[str, dict] | None]:
    """Per walked day: series with a level that day -> component values (None while warming up)
    and flags; None when no series has a level."""
    names = list(comps.ema.columns)
    has = comps.ema.loc[walk].notna().to_numpy()
    floats = {k: getattr(comps, k).loc[walk].to_numpy(dtype=float) for k in _SURGE_FLOATS}
    flags = {k: getattr(comps, k).loc[walk].to_numpy(dtype=bool) for k in _SURGE_FLAGS}
    out = {}
    for i, ts in enumerate(walk):
        day = {
            name: {
                **{k: _opt_float(v[i, j]) for k, v in floats.items()},
                **{k: bool(v[i, j]) for k, v in flags.items()},
            }
            for j, name in enumerate(names)
            if has[i, j]
        }
        out[ts] = day or None
    return out
