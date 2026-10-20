"""Risk engine read endpoints (spec 2026-10-19 section 6). Read-only: nothing here fetches from the network."""
import json
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from apps.api.models.schemas import APIResponse
from apps.api.models.schema_parts.risk import (
    CandidateCardOut, CrashCardOut, DeckOut, HeadlineOut, LabelOut, MacroFigureOut, MacroValueOut,
    MoverOut, MoversDayOut, MoversLatestOut, NewsItemOut, OutcomeOut, RiskAlertDetail, RiskAlertSummary,
    RiskData, RiskLatest, RiskWarning, SnapshotCardOut, StartSnapshotOut, SurgeComponentsOut,
    SurgeEventOut, SurgeLatestOut, SurgeLeaderOut, SurgeThemeOut, ThemeStintOut, WarningAtStart,
)
from apps.api.services.db import get_db
from apps.api.services.risk import news, store
from apps.api.services.risk.evaluator import BACKFILL_COMPLETE
from apps.api.services.risk.inputs import cached_fred
from apps.api.services.risk.rules import get_rules
from apps.api.services.risk.store import StoredAlert, StoredCard, StoredDay, StoredMover, StoredSurge
from apps.api.services.watchlist_themes import load_themes
from packages.core_finance.risk_signals.decks import _USEFUL_DD_PCT
from packages.core_finance.risk_signals.warnings import WARNING_IDS

router = APIRouter()

MOVERS_DEFAULT_DAYS = 20
MOVERS_MAX_DAYS = 2600
DECK_CARDS = 10
HEADLINES = 2
# What each warning's `value` measures (a display hint; the thresholds live in rules.yaml).
WARNING_UNITS = {"W1": "pct_level", "W2": "pct_level", "W3": "pct_change", "W4": "days",
                 "W5": "mm_pct", "W7": "pct_drop"}


def _backfill_state(version: str) -> str:
    return store.get_state(f"backfill:{version}") or "pending"


def _fred_errors() -> list[str]:
    raw = store.get_state("fred_errors")
    return json.loads(raw) if raw else []


def _visible_alerts(version: str, origin: str, limit: int) -> list[StoredAlert]:
    """Newest first. Backfill alerts count only once their version's backfill is done or degraded."""
    origins = ["live", "backfill"] if origin == "all" else [origin]
    if _backfill_state(version) not in BACKFILL_COMPLETE:
        origins = [o for o in origins if o != "backfill"]
    found = [a for o in origins for a in store.list_alerts(version, o, limit)]
    found.sort(key=lambda a: (a.start_date, a.id), reverse=True)
    return found[:limit]


def _visible_origins(version: str) -> list[str]:
    """Backfill rows count only once their version's backfill is done or degraded; live rows always."""
    return ["live", "backfill"] if _backfill_state(version) in BACKFILL_COMPLETE else ["live"]


def _useful(alert: StoredAlert) -> bool | None:
    firsts = [next((s for s in alert.stints if s.theme == t), None) for t in alert.trigger]
    dds = [s.max_dd10 for s in firsts if s is not None]
    if any(dd is not None and dd <= _USEFUL_DD_PCT for dd in dds):
        return True
    if any(dd is None for dd in dds):
        return None
    return False


def _primary(alert: StoredAlert):
    return next((s for s in alert.stints if s.theme == alert.primary_theme), None)


def _summary(alert: StoredAlert) -> RiskAlertSummary:
    latest = store.latest_day(alert.rules_version)
    end = alert.release_date or (latest.date if latest else alert.start_date)
    start_day = store.get_day(alert.rules_version, alert.start_date)
    primary = _primary(alert)
    return RiskAlertSummary(
        id=alert.id, origin=alert.origin, rules_version=alert.rules_version, status=alert.status,
        start_date=alert.start_date.isoformat(),
        release_date=alert.release_date.isoformat() if alert.release_date else None,
        days=store.count_days(alert.rules_version, alert.start_date, end),
        trigger_themes=list(alert.trigger), theme_count=len({s.theme for s in alert.stints}),
        warnings_at_start=[w for w in WARNING_IDS if start_day and start_day.warnings.get(w, {}).get("state") == "on"],
        primary_theme=alert.primary_theme,
        fwd5=primary.fwd5 if primary else None, fwd10=primary.fwd10 if primary else None,
        fwd20=primary.fwd20 if primary else None, useful=_useful(alert), w1_proxy=alert.w1_proxy)


def _watchlist() -> dict[str, tuple[str, str]]:
    with get_db() as conn:
        rows = conn.execute("SELECT ticker, name, theme FROM watchlist").fetchall()
    return {r["ticker"]: (r["name"] or "", r["theme"] or "") for r in rows}


def _headlines(alert: StoredAlert, tickers: list[str]) -> dict[str, list[HeadlineOut]]:
    days_before = get_rules().rules.news.days_before
    start = date.fromordinal(alert.start_date.toordinal() - days_before).isoformat()
    end = (alert.release_date or datetime.now(UTC).date()).isoformat()
    out: dict[str, list[HeadlineOut]] = {}
    with get_db() as conn:
        for ticker in tickers:
            rows = conn.execute(
                "SELECT headline, url, published_date, lang FROM news "
                "WHERE topic = '' AND ticker = ? AND substr(published_date, 1, 10) BETWEEN ? AND ? "
                "ORDER BY published_date DESC, id DESC LIMIT ?", (ticker, start, end, HEADLINES)).fetchall()
            out[ticker] = [HeadlineOut(title=r["headline"], url=r["url"] or "",
                                       published_date=r["published_date"] or "", lang=r["lang"]) for r in rows]
    return out


def _deck_as_of(cards: list[StoredCard]) -> str | None:
    return cards[0].as_of.isoformat() if cards else None


def _snapshot(cards: list[StoredCard]) -> list[SnapshotCardOut]:
    return [SnapshotCardOut(ticker=c.ticker, fwd5=c.fwd5, fwd10=c.fwd10, fwd20=c.fwd20) for c in cards]


def _detail(alert: StoredAlert) -> RiskAlertDetail:
    rules = get_rules().rules
    labels = {t.id: LabelOut(ko=t.ko, en=t.en) for t in load_themes()}
    watch = _watchlist()
    today = datetime.now(UTC).date()

    crash_all = alert.cards.get(("latest", "crash"), [])
    cand_all = alert.cards.get(("latest", "candidate"), [])
    crash = crash_all[:DECK_CARDS]
    heads = _headlines(alert, [c.ticker for c in crash])
    crash_cards = [CrashCardOut(
        ticker=c.ticker, name=watch.get(c.ticker, ("", ""))[0], theme=watch.get(c.ticker, ("", ""))[1],
        drawdown_pct=c.drawdown_pct, high_date=c.high_date.isoformat() if c.high_date else None,
        high_close=(c.payload or {}).get("high_close"), close=(c.payload or {}).get("close"),
        closes_30d=(c.payload or {}).get("closes_30d", []), headlines=heads[c.ticker]) for c in crash]
    cand_cards = [CandidateCardOut(
        ticker=c.ticker, name=watch.get(c.ticker, ("", ""))[0], theme=watch.get(c.ticker, ("", ""))[1],
        pct_from_high63=c.pct_from_high63, corr=c.corr, corr_with=c.corr_with,
        corr_with_name=(watch.get(c.corr_with, ("", ""))[0] or None) if c.corr_with else None)
        for c in cand_all[:DECK_CARDS]]

    start_day = store.get_day(alert.rules_version, alert.start_date)
    start_warnings = [
        WarningAtStart(id=w, state=start_day.warnings[w]["state"], value=start_day.warnings[w]["value"])
        for w in WARNING_IDS if start_day and w in start_day.warnings]

    selected = news.select_alert_news(alert, today, rules)
    latest = store.latest_day(alert.rules_version)
    figures_day = alert.release_date or (latest.date if latest else alert.start_date)
    figures = news.macro_figures(cached_fred(), figures_day)

    primary = _primary(alert)
    return RiskAlertDetail(
        id=alert.id, origin=alert.origin, rules_version=alert.rules_version, status=alert.status,
        start_date=alert.start_date.isoformat(),
        release_date=alert.release_date.isoformat() if alert.release_date else None,
        w1_proxy=alert.w1_proxy, trigger_themes=list(alert.trigger),
        themes=[ThemeStintOut(
            theme=s.theme, label=labels.get(s.theme, LabelOut(ko=s.theme, en=s.theme)), via=s.via,
            joined_date=s.joined_date.isoformat(), left_date=s.left_date.isoformat() if s.left_date else None,
            dd20_at_join=s.dd20_at_join, fwd5=s.fwd5, fwd10=s.fwd10, fwd20=s.fwd20, max_dd10=s.max_dd10)
            for s in alert.stints],
        warnings_at_start=start_warnings,
        crash=DeckOut[CrashCardOut](as_of=_deck_as_of(crash_all), total=len(crash_all), cards=crash_cards),
        candidates=DeckOut[CandidateCardOut](as_of=_deck_as_of(cand_all), total=len(cand_all), cards=cand_cards),
        start_snapshot=StartSnapshotOut(crash=_snapshot(alert.cards.get(("start", "crash"), [])),
                                        candidates=_snapshot(alert.cards.get(("start", "candidate"), []))),
        outcome=OutcomeOut(primary_theme=alert.primary_theme, fwd5=primary.fwd5 if primary else None,
                           fwd10=primary.fwd10 if primary else None, fwd20=primary.fwd20 if primary else None,
                           useful=_useful(alert)),
        news=[NewsItemOut(**vars(i)) for i in selected.items],
        macro_figures=[MacroFigureOut(
            topic=f.topic, series=f.series, label=LabelOut(**f.label), kind=f.kind,
            latest=MacroValueOut(**f.latest), prior=MacroValueOut(**f.prior)) for f in figures],
        news_shortfall=selected.shortfall, news_note=selected.note)


def _components(raw: dict | None) -> SurgeComponentsOut:
    raw = raw or {}
    return SurgeComponentsOut(**{k: raw.get(k) for k in SurgeComponentsOut.model_fields})


def _theme_label(theme: str, labels: dict[str, LabelOut]) -> LabelOut:
    return labels.get(theme, LabelOut(ko=theme, en=theme))


def _mover_out(m: StoredMover, watch: dict[str, tuple[str, str]]) -> MoverOut:
    return MoverOut(rank=m.rank, ticker=m.ticker, name=watch.get(m.ticker, ("", ""))[0], theme=m.theme,
                    return_pct=m.return_pct, close=m.close, return5_pct=m.return5_pct, rsi=m.rsi)


def _surge_event(e: StoredSurge) -> SurgeEventOut:
    labels = {t.id: LabelOut(ko=t.ko, en=t.en) for t in load_themes()}
    watch = _watchlist()
    return SurgeEventOut(
        id=e.id, origin=e.origin, rules_version=e.rules_version, theme=e.theme,
        label=_theme_label(e.theme, labels), start_date=e.start_date.isoformat(),
        end_date=e.end_date.isoformat() if e.end_date else None, end_reason=e.end_reason, shown=e.shown,
        components=_components(e.components),
        overheated_on=e.overheated_on.isoformat() if e.overheated_on else None,
        fwd5=e.fwd5, fwd10=e.fwd10, fwd20=e.fwd20, max_runup10=e.max_runup10,
        leaders=[SurgeLeaderOut(ticker=x["ticker"], name=watch.get(x["ticker"], ("", ""))[0],
                                return5_pct=x.get("return5_pct")) for x in e.leaders])


def _surge_latest(day: StoredDay, version: str) -> SurgeLatestOut | None:
    if day.surge is None:
        return None
    labels = {t.id: LabelOut(ko=t.ko, en=t.en) for t in load_themes()}
    hot = get_rules().rules.surge.rsi.overheated
    origins = _visible_origins(version)
    themes = []
    for e in store.open_surge_events(version):
        if e.origin not in origins:
            continue
        comps = _components(day.surge.get(e.theme, e.components))
        themes.append(SurgeThemeOut(
            theme=e.theme, label=_theme_label(e.theme, labels), event_id=e.id,
            start_date=e.start_date.isoformat(), shown=e.shown, components=comps,
            overheated=comps.rsi is not None and comps.rsi > hot))
    return SurgeLatestOut(banner=bool(day.surge_banner), cap_share=day.surge_cap_share or 0.0, themes=themes)


def _movers_latest(day: StoredDay, version: str) -> MoversLatestOut | None:
    rows = store.list_movers(version, day.date, day.date)
    if not rows:
        return None
    watch = _watchlist()
    return MoversLatestOut(as_of=day.date.isoformat(), items=[_mover_out(m, watch) for m in rows])


def _warnings(day: StoredDay) -> list[RiskWarning]:
    rules = get_rules().rules
    out = []
    for wid in WARNING_IDS:
        stored = day.warnings.get(wid)
        if stored is None:
            continue
        state = stored["state"]
        out.append(RiskWarning(
            id=wid, label=LabelOut(**getattr(rules.labels, wid).model_dump()), state=state,
            value=None if state == "unknown" else stored["value"], unit=WARNING_UNITS[wid],
            rule=LabelOut(**getattr(rules.rule_text, wid).model_dump()), observed_at=stored["observed_at"]))
    return out


@router.get("/latest", response_model=APIResponse[RiskLatest])
def risk_latest():
    version = get_rules().version
    backfill = _backfill_state(version)
    day = store.latest_day(version)
    if backfill not in BACKFILL_COMPLETE and day is not None and day.origin == "backfill":
        day = None  # a backfill still being written is not a finished evaluation
    open_alert = store.open_alert(version)
    if open_alert is not None and backfill not in BACKFILL_COMPLETE and open_alert.origin == "backfill":
        open_alert = None
    last = None
    if open_alert is None:
        released = [a for a in _visible_alerts(version, "all", 2) if a.status == "released"]
        last = _summary(released[0]) if released else None
    return APIResponse(data=RiskLatest(
        as_of=day.date.isoformat() if day else None, evaluated_at=day.evaluated_at if day else None,
        rules_version=version, backfill=backfill,
        data=RiskData(bars_coverage=day.bars_coverage, fred_errors=_fred_errors()) if day else None,
        warnings=_warnings(day) if day else [], warnings_on=day.on_count if day else 0,
        warnings_total=len(WARNING_IDS),
        alert=_detail(open_alert) if open_alert else None, last_alert=last,
        surge=_surge_latest(day, version) if day else None,
        movers=_movers_latest(day, version) if day else None))


@router.get("/history", response_model=APIResponse[list[RiskAlertSummary]])
def risk_history(origin: Literal["all", "live", "backfill"] = "all",
                 limit: int = Query(50, ge=1, le=500), rules_version: str | None = None):
    version = rules_version or get_rules().version
    return APIResponse(data=[_summary(a) for a in _visible_alerts(version, origin, limit)])


@router.get("/alerts/{alert_id}", response_model=APIResponse[RiskAlertDetail])
def risk_alert(alert_id: int):
    alert = store.get_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail=f"unknown_alert:{alert_id}")
    return APIResponse(data=_detail(alert))


@router.get("/surge/history", response_model=APIResponse[list[SurgeEventOut]])
def surge_history(shown: Literal["all", "yes"] = "all", theme: str | None = None,
                  limit: int = Query(50, ge=1, le=500)):
    version = get_rules().version
    events = store.list_surge(version, True if shown == "yes" else None, theme, limit,
                              origins=_visible_origins(version))
    return APIResponse(data=[_surge_event(e) for e in events])


@router.get("/surge/events/{event_id}", response_model=APIResponse[SurgeEventOut])
def surge_event(event_id: int):
    event = store.get_surge(event_id)
    if event is None or event.origin not in _visible_origins(event.rules_version):
        raise HTTPException(status_code=404, detail=f"unknown_surge:{event_id}")
    return APIResponse(data=_surge_event(event))


@router.get("/movers", response_model=APIResponse[list[MoversDayOut]])
def movers(from_: date | None = Query(None, alias="from"), to: date | None = None):
    """Per-day top movers, oldest first. No `from`: the latest 20 evaluated days up to `to` (or the latest)."""
    if from_ is not None and to is not None and from_ > to:
        raise HTTPException(status_code=422, detail="from_after_to")
    version = get_rules().version
    days = store.evaluated_dates(version, from_, to, live_only="backfill" not in _visible_origins(version))
    if from_ is None:
        days = days[-MOVERS_DEFAULT_DAYS:]
    elif len(days) > MOVERS_MAX_DAYS:
        raise HTTPException(status_code=422, detail="range_too_long")
    if not days:
        return APIResponse(data=[])
    wanted = set(days)
    watch = _watchlist()
    by_day: dict[date, list[MoverOut]] = {}
    for m in store.list_movers(version, days[0], days[-1]):
        if m.date in wanted:
            by_day.setdefault(m.date, []).append(_mover_out(m, watch))
    return APIResponse(data=[MoversDayOut(date=d.isoformat(), items=by_day[d]) for d in days if d in by_day])
