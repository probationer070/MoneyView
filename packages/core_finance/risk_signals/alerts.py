"""Theme confirmation and the market-wide alert lifecycle (spec 3.4). Pure: no DB, no network.

Reproduces breadth.py ``run_alerts3`` (cap-share open, per-theme exit) with
``sox_confirm`` and backtest.py ``confirmations``; the market on_count replaces the
old per-theme W6 term.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import date
from typing import Mapping, Sequence

import numpy as np
import pandas as pd

from packages.core_finance.risk_signals.config import RiskRules
from packages.core_finance.risk_signals.indices import Shapes

_TOL = 1e-12
CLOSE_REASON = "all_themes_out"


@dataclass(frozen=True)
class Confirmations:
    theme: pd.DataFrame  # bool, trigger themes (every themed index minus excluded)
    via: pd.DataFrame  # "theme" | "sox" | "" (non-empty only on days the theme confirms)
    sox: pd.Series  # bool


@dataclass
class ThemeStint:
    theme: str
    via: str
    joined: date
    left: date | None
    last_ref: date


@dataclass
class OpenAlert:
    start: date
    trigger: tuple[str, ...]
    stints: list[ThemeStint] = field(default_factory=list)


@dataclass
class AlertRecord:
    start: date
    release: date | None
    trigger: tuple[str, ...]
    stints: list[ThemeStint]
    reason: str | None


def _price_test(s: Shapes, rules: RiskRules) -> pd.Series:
    p = rules.price
    test = (s.dd <= -p.drop_pct / 100 + _TOL) & (s.down >= p.down_days) & s.valid
    return test.fillna(False).astype(bool)


def confirmations(
    theme_shapes: Mapping[str, Shapes], sox_shapes: Shapes, on_count: pd.Series, rules: RiskRules
) -> Confirmations:
    idx = sox_shapes.dd.index
    warn = (on_count.reindex(idx).fillna(0) >= rules.warnings_required).to_numpy()
    sox_price = _price_test(sox_shapes, rules)
    sox = pd.Series(sox_price.to_numpy() & warn, index=idx)
    conf: dict[str, pd.Series] = {}
    via: dict[str, pd.Series] = {}
    for theme, s in theme_shapes.items():
        if theme in rules.excluded_themes:
            continue
        own = _price_test(s, rules).reindex(idx, fill_value=False)
        v = np.where(own, "theme", "")
        c = own
        if theme in rules.semis_themes:
            via_sox = sox_price & s.valid.reindex(idx, fill_value=False)
            v = np.where(own, "theme", np.where(via_sox, "sox", ""))
            c = own | via_sox
        c = c.to_numpy() & warn
        conf[theme] = pd.Series(c, index=idx)
        via[theme] = pd.Series(np.where(c, v, ""), index=idx)
    return Confirmations(pd.DataFrame(conf, index=idx), pd.DataFrame(via, index=idx), sox)


def run_alerts(
    dates: Sequence[date],
    conf: Confirmations,
    cap_share: pd.DataFrame,
    theme_shapes: Mapping[str, Shapes],
    rules: RiskRules,
    state: OpenAlert | None = None,
) -> tuple[list[AlertRecord], OpenAlert | None]:
    cur = copy.deepcopy(state)
    records: list[AlertRecord] = []
    idx = next(iter(theme_shapes.values())).dd.index
    gate = rules.open_gate.cap_share_pct / 100 - _TOL
    recover = rules.theme_exit.recover_within_pct / 100
    quiet = rules.theme_exit.quiet_days

    for raw in dates:
        ts = pd.Timestamp(raw)
        day = ts.date()
        firing = [t for t in conf.theme.columns if bool(conf.theme.at[ts, t])]
        if cur is None:
            if not firing:
                continue
            share = sum(float(cap_share.at[ts, t]) if t in cap_share.columns else 0.0 for t in firing)
            if share >= gate or (rules.open_gate.sox_opens and bool(conf.sox.at[ts])):
                cur = OpenAlert(
                    start=day,
                    trigger=tuple(firing),
                    stints=[ThemeStint(t, str(conf.via.at[ts, t]), day, None, day) for t in firing],
                )
            continue

        active = {s.theme: s for s in cur.stints if s.left is None}
        for t in firing:
            if t not in active:
                stint = ThemeStint(t, str(conf.via.at[ts, t]), day, None, day)
                cur.stints.append(stint)
                active[t] = stint
        for t, stint in active.items():
            if t in theme_shapes and bool(theme_shapes[t].new_low.at[ts]):
                stint.last_ref = day
        pos = idx.get_loc(ts)
        for t, stint in list(active.items()):
            if t in firing:
                continue
            if t not in theme_shapes:  # the theme no longer has an index (e.g. fewer members): it leaves
                stint.left = day
                del active[t]
                continue
            dd = theme_shapes[t].dd.at[ts]
            if dd > -recover or pos - idx.get_loc(pd.Timestamp(stint.last_ref)) >= quiet:
                stint.left = day
                del active[t]
        if not active:
            records.append(AlertRecord(cur.start, day, cur.trigger, cur.stints, CLOSE_REASON))
            cur = None
    return records, cur
