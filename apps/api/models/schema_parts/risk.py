"""Response models of /api/v1/risk (spec 2026-10-19 section 6). Percents are percent numbers, unrounded."""
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field


class LabelOut(BaseModel):
    ko: str
    en: str


class RiskWarning(BaseModel):
    id: str
    label: LabelOut
    state: Literal["on", "off", "unknown"]
    value: float | None
    unit: Literal["pct_level", "pct_change", "days", "mm_pct", "pct_drop"]
    rule: LabelOut
    observed_at: str | None


class WarningAtStart(BaseModel):
    id: str
    state: Literal["on", "off", "unknown"]
    value: float | None


class ThemeStintOut(BaseModel):
    theme: str
    label: LabelOut
    via: Literal["theme", "sox"]
    joined_date: str
    left_date: str | None
    dd20_at_join: float | None
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None
    max_dd10: float | None


class HeadlineOut(BaseModel):
    title: str
    url: str
    published_date: str
    lang: str


class CrashCardOut(BaseModel):
    ticker: str
    name: str
    theme: str
    drawdown_pct: float | None
    high_date: str | None
    high_close: float | None
    close: float | None
    closes_30d: list[float]
    headlines: list[HeadlineOut]


class CandidateCardOut(BaseModel):
    ticker: str
    name: str
    theme: str
    pct_from_high63: float | None
    corr: float | None
    corr_with: str | None
    corr_with_name: str | None


_Card = TypeVar("_Card")


class DeckOut(BaseModel, Generic[_Card]):
    as_of: str | None
    total: int
    cards: list[_Card]


class SnapshotCardOut(BaseModel):
    ticker: str
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None


class StartSnapshotOut(BaseModel):
    crash: list[SnapshotCardOut]
    candidates: list[SnapshotCardOut]


class OutcomeOut(BaseModel):
    primary_theme: str
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None
    useful: bool | None


class NewsItemOut(BaseModel):
    title: str
    url: str
    source: str
    published_date: str
    lang: str
    kind: Literal["macro", "industry"]
    topic: str | None
    theme: str | None
    ticker: str | None


class MacroValueOut(BaseModel):
    period: str
    value: float


class MacroFigureOut(BaseModel):
    topic: str
    series: str
    label: LabelOut
    kind: Literal["mm_pct", "level"]
    latest: MacroValueOut
    prior: MacroValueOut


class TriggerLabelOut(BaseModel):
    id: str
    label: LabelOut


class RiskAlertSummary(BaseModel):
    id: int
    origin: Literal["live", "backfill"]
    rules_version: str
    status: Literal["open", "released"]
    start_date: str
    release_date: str | None
    days: int
    trigger_themes: list[str]
    theme_count: int
    warnings_at_start: list[str]
    primary_theme: str
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None
    useful: bool | None
    w1_proxy: bool
    max_dd10: float | None
    trigger_labels: list[TriggerLabelOut]


class RiskAlertDetail(BaseModel):
    id: int
    origin: Literal["live", "backfill"]
    rules_version: str
    status: Literal["open", "released"]
    start_date: str
    release_date: str | None
    w1_proxy: bool
    trigger_themes: list[str]
    themes: list[ThemeStintOut]
    warnings_at_start: list[WarningAtStart]
    crash: DeckOut[CrashCardOut]
    candidates: DeckOut[CandidateCardOut]
    start_snapshot: StartSnapshotOut
    outcome: OutcomeOut
    news: list[NewsItemOut]
    macro_figures: list[MacroFigureOut]
    news_shortfall: int
    news_note: Literal["before_collection", "feed_failed"] | None


class RiskData(BaseModel):
    bars_coverage: float
    fred_errors: list[str] = Field(default_factory=list)


class SurgeComponentsOut(BaseModel):
    magnitude_z: float | None = None
    accel_pct: float | None = None
    accel_rank: float | None = None
    breadth_pct: float | None = None
    rsi: float | None = None


class SurgeLeaderOut(BaseModel):
    ticker: str
    name: str
    return5_pct: float | None


class SurgeComponentInfoOut(BaseModel):
    id: Literal["magnitude", "accel", "breadth", "rsi"]
    label: LabelOut
    rule: LabelOut


class SurgeThemeOut(BaseModel):
    theme: str
    label: LabelOut
    event_id: int
    start_date: str
    shown: bool
    components: SurgeComponentsOut
    overheated: bool
    leaders: list[SurgeLeaderOut]


class SurgeLatestOut(BaseModel):
    banner: bool
    cap_share: float
    themes: list[SurgeThemeOut]
    components_info: list[SurgeComponentInfoOut]
    banner_since: str | None


class MoverOut(BaseModel):
    rank: int
    ticker: str
    name: str
    theme: str
    return_pct: float
    close: float
    return5_pct: float | None
    rsi: float | None


class MoversLatestOut(BaseModel):
    as_of: str
    items: list[MoverOut]


class MoversDayOut(BaseModel):
    date: str
    items: list[MoverOut]


class SurgeEventOut(BaseModel):
    id: int
    origin: Literal["live", "backfill"]
    rules_version: str
    theme: str
    label: LabelOut
    start_date: str
    end_date: str | None
    end_reason: Literal["below_ema", "stalled", "rules_changed"] | None
    shown: bool
    components: SurgeComponentsOut
    overheated_on: str | None
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None
    max_runup10: float | None
    leaders: list[SurgeLeaderOut]


class SurgeEventDetailOut(SurgeEventOut):
    components_info: list[SurgeComponentInfoOut]


class ThemeLevelPoint(BaseModel):
    date: str
    level: float


class RiskLatest(BaseModel):
    as_of: str | None
    evaluated_at: str | None
    rules_version: str
    backfill: Literal["pending", "running", "done", "degraded", "failed"]
    data: RiskData | None
    warnings: list[RiskWarning]
    warnings_on: int
    warnings_total: int
    alert: RiskAlertDetail | None
    last_alert: RiskAlertSummary | None
    surge: SurgeLatestOut | None = None
    movers: MoversLatestOut | None = None
