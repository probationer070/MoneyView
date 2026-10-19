"""Strict schema for the risk evaluator's rules file. Pure: no apps imports.

Theme-id and FRED-series membership are checked by the apps-side loader.
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt, model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Label(_Strict):
    ko: str
    en: str


class PriceRule(_Strict):
    drop_pct: PositiveFloat
    down_days: PositiveInt
    window: PositiveInt


class W1Proxy(_Strict):
    series: str
    rise_pp: PositiveFloat
    level: PositiveFloat


class W1(_Strict):
    series: str
    rise_pp: PositiveFloat
    rise_window: PositiveInt
    level: PositiveFloat
    hy_from: date
    proxy: W1Proxy


class W2(_Strict):
    series: str
    level: PositiveFloat
    rise_pp: PositiveFloat
    rise_window: PositiveInt


class W3(_Strict):
    series: str
    rise_pct: PositiveFloat
    window: PositiveInt


class W4(_Strict):
    series: str
    days: PositiveInt


class W5(_Strict):
    cpi_series: str
    pce_series: str
    mm_pct: PositiveFloat
    cpi_known_day: int = Field(gt=0, le=28)


class W7(_Strict):
    ratio_drop_pct: PositiveFloat
    sox_within_pct: PositiveFloat
    window: PositiveInt


class OpenGate(_Strict):
    cap_share_pct: PositiveFloat
    sox_opens: bool


class ThemeExit(_Strict):
    recover_within_pct: PositiveFloat
    quiet_days: PositiveInt


class CrashDeck(_Strict):
    drop_pct: PositiveFloat
    window: PositiveInt
    api_cards: PositiveInt


class Candidates(_Strict):
    within_high_pct: PositiveFloat
    high_window: PositiveInt
    corr_min: PositiveFloat
    corr_window: PositiveInt
    crashed_drop_pct: PositiveFloat
    api_cards: PositiveInt


class News(_Strict):
    min_items: PositiveInt
    max_items: PositiveInt
    days_before: PositiveInt


class Coverage(_Strict):
    min_share: PositiveFloat
    wait_hours: PositiveInt


class WarningLabels(_Strict):
    W1: Label
    W2: Label
    W3: Label
    W4: Label
    W5: Label
    W7: Label


class RiskRules(_Strict):
    price: PriceRule
    warnings_required: PositiveInt
    w1: W1
    w2: W2
    w3: W3
    w4: W4
    w5: W5
    w7: W7
    open_gate: OpenGate
    theme_exit: ThemeExit
    semis_themes: list[str]
    excluded_themes: list[str]
    min_members: PositiveInt
    eval_start: date
    history_start: date
    crash_deck: CrashDeck
    candidates: Candidates
    news: News
    coverage: Coverage
    labels: WarningLabels
    rule_text: WarningLabels

    @model_validator(mode="after")
    def _consistent(self):
        if self.history_start >= self.eval_start:
            raise ValueError("history_start must be before eval_start")
        if self.news.min_items > self.news.max_items:
            raise ValueError("news.min_items must not exceed news.max_items")
        return self
