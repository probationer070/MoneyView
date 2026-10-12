"""Schema and loader for rules.yaml.

Validation runs at app start (`reload_rules` in main.lifespan), so a typo'd key or an
unknown series id stops the backend instead of silently dropping a signal.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt, model_validator

RULES_PATH = Path(__file__).with_name("rules.yaml")

# The FRED series this engine knows. A new series is added here on purpose, never by a
# typo in rules.yaml.
KNOWN_SERIES = frozenset({"DGS10", "CPILFESL", "BAMLH0A0HYM2", "DCOILBRENTEU", "DFEDTARU", "PAYEMS"})

Op = Literal[">=", ">", "<", "<="]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Label(_Strict):
    ko: str
    en: str


class Likelihood(_Strict):
    a: PositiveFloat
    b: PositiveFloat
    c: PositiveFloat


class Probabilities(_Strict):
    a: PositiveFloat
    b: PositiveFloat
    c: PositiveFloat

    @model_validator(mode="after")
    def _sums_to_one(self):
        if abs(self.a + self.b + self.c - 1.0) > 1e-9:
            raise ValueError("prior must sum to 1")
        return self


class Weights(_Strict):
    triggered: PositiveFloat
    near: PositiveFloat

    @model_validator(mode="after")
    def _near_below_triggered(self):
        if self.near >= self.triggered:
            raise ValueError("near weight must be below triggered weight")
        return self


class ScenarioConfig(_Strict):
    prior: Probabilities
    floor: float = Field(ge=0, lt=1)
    cap: float = Field(gt=0, le=1)
    weights: Weights

    @model_validator(mode="after")
    def _feasible(self):
        if not (3 * self.floor <= 1.0 <= 3 * self.cap):
            raise ValueError("floor/cap are infeasible for three scenarios")
        return self


class _AutoBase(_Strict):
    id: str = Field(pattern=r"^[ab]_[a-z0-9_]+$")
    label: Label
    direction: Literal["A", "B"]
    series: list[str] = Field(min_length=1)
    max_age_days: PositiveInt
    lr: Likelihood


class LevelStreakRule(_AutoBase):
    kind: Literal["level_streak"]
    op: Op
    threshold: float
    days: PositiveInt
    near_threshold: float | None = None
    near_days: PositiveInt | None = None


class RollingMeanRule(_AutoBase):
    kind: Literal["rolling_mean"]
    window: PositiveInt
    op: Op
    threshold: float
    near_threshold: float | None = None


class MomPctRule(_AutoBase):
    kind: Literal["mom_pct"]
    op: Op
    threshold: float
    near_threshold: float | None = None


class LevelChangeRule(_AutoBase):
    kind: Literal["level_change"]
    lookback_days: PositiveInt
    op: Op
    threshold: float = 0.0


class CompoundCondition(_Strict):
    label: str
    series: str
    transform: Literal["mom_pct", "mom_diff"]
    op: Op
    threshold: float


class CompoundRule(_AutoBase):
    kind: Literal["compound"]
    conditions: list[CompoundCondition] = Field(min_length=2)


class ManualRule(_Strict):
    id: str = Field(pattern=r"^m_[a-z0-9_]+$")
    label: Label
    direction: Literal["A", "B"]
    kind: Literal["manual"]
    lr: Likelihood


AutoRule = Union[LevelStreakRule, RollingMeanRule, MomPctRule, LevelChangeRule, CompoundRule]
Rule = Annotated[
    Union[LevelStreakRule, RollingMeanRule, MomPctRule, LevelChangeRule, CompoundRule, ManualRule],
    Field(discriminator="kind"),
]


class RulesFile(_Strict):
    scenario: ScenarioConfig
    rules: list[Rule]

    @model_validator(mode="after")
    def _consistent(self):
        ids = [r.id for r in self.rules]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate rule ids: {duplicates}")
        for rule in self.rules:
            if rule.kind == "manual":
                continue
            unknown = [s for s in rule.series if s not in KNOWN_SERIES]
            if unknown:
                raise ValueError(f"{rule.id}: unknown FRED series {unknown}")
            if rule.kind == "compound":
                stray = [c.series for c in rule.conditions if c.series not in rule.series]
                if stray:
                    raise ValueError(f"{rule.id}: condition series {stray} not listed in series")
            elif len(rule.series) != 1:
                raise ValueError(f"{rule.id}: {rule.kind} takes exactly one series")
        return self


@dataclass(frozen=True)
class LoadedRules:
    file: RulesFile
    version: str


def load_rules(path: Path | None = None) -> LoadedRules:
    raw = (path or RULES_PATH).read_bytes()
    return LoadedRules(RulesFile.model_validate(yaml.safe_load(raw)), hashlib.sha256(raw).hexdigest()[:12])


_current: LoadedRules | None = None


def reload_rules() -> LoadedRules:
    global _current
    _current = load_rules()
    return _current


def get_rules() -> LoadedRules:
    return _current or reload_rules()
