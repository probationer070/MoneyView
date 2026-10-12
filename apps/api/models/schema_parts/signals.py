from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ScenarioProbs(BaseModel):
    a: float
    b: float
    c: float


class SignalResultOut(BaseModel):
    rule_id: str
    label_ko: str
    label_en: str
    direction: Literal["A", "B"] | None
    kind: str | None
    state: Literal["triggered", "near", "not_triggered", "stale"]
    value: float | None
    observed_at: str | None
    threshold: float | None
    note: str
    contribution: ScenarioProbs | None


class SignalSnapshot(BaseModel):
    iso_week: str
    run_at: str
    rules_version: str
    probs: ScenarioProbs
    previous_probs: ScenarioProbs | None
    results: list[SignalResultOut]
    failures: list[str] = Field(default_factory=list)


class SignalHistoryPoint(BaseModel):
    iso_week: str
    run_at: str
    rules_version: str
    a: float
    b: float
    c: float


class SignalRules(BaseModel):
    version: str
    scenario: dict[str, Any]
    rules: list[dict[str, Any]]


class ManualInputIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Literal["triggered", "near", "not_triggered"]
    note: str = Field(default="", max_length=500)


class ManualInputSaved(BaseModel):
    iso_week: str
    snapshot: SignalSnapshot | None
