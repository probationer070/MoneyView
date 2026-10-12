"""Macro signal engine: weekly FRED rule verdicts and heuristic scenario probabilities.

A FRED failure never becomes a 500: the affected rules come back `stale` and the reasons
are listed in `failures`.
"""
from fastapi import APIRouter, Body, HTTPException, Query

from apps.api.models.schemas import APIResponse
from apps.api.models.schema_parts.signals import (
    ManualInputIn, ManualInputSaved, ScenarioProbs, SignalHistoryPoint, SignalResultOut, SignalRules,
    SignalSnapshot,
)
from apps.api.services.signals import engine, store
from apps.api.services.signals.models import get_rules

router = APIRouter()


def _out(snapshot: store.StoredSnapshot, failures: list[str] | None = None) -> SignalSnapshot:
    rules = {rule.id: rule for rule in get_rules().file.rules}
    previous = store.previous_snapshot(snapshot.iso_week)
    results = []
    for row in snapshot.results:
        rule = rules.get(row.rule_id)   # None if rules.yaml dropped it since the run
        results.append(SignalResultOut(
            rule_id=row.rule_id, label_ko=rule.label.ko if rule else row.rule_id,
            label_en=rule.label.en if rule else row.rule_id, direction=rule.direction if rule else None,
            kind=rule.kind if rule else None, state=row.state, value=row.value, observed_at=row.observed_at,
            threshold=row.threshold, note=row.note,
            contribution=ScenarioProbs(**row.contribution) if row.contribution else None))
    return SignalSnapshot(
        iso_week=snapshot.iso_week, run_at=snapshot.run_at, rules_version=snapshot.rules_version,
        probs=ScenarioProbs(**snapshot.probs),
        previous_probs=ScenarioProbs(**previous.probs) if previous else None,
        results=results, failures=failures or [])


@router.post("/run", response_model=APIResponse[SignalSnapshot])
def run_signals():
    outcome = engine.run()
    return APIResponse(data=_out(outcome.snapshot, outcome.failures))


@router.get("/latest", response_model=APIResponse[SignalSnapshot | None])
def latest_signals():
    snapshot = store.latest_snapshot()
    return APIResponse(data=_out(snapshot) if snapshot else None)


@router.get("/history", response_model=APIResponse[list[SignalHistoryPoint]])
def signal_history(weeks: int = Query(26, ge=1, le=260)):
    return APIResponse(data=[SignalHistoryPoint(**vars(h)) for h in store.history(weeks)])


@router.get("/rules", response_model=APIResponse[SignalRules])
def signal_rules():
    loaded = get_rules()
    return APIResponse(data=SignalRules(
        version=loaded.version, scenario=loaded.file.scenario.model_dump(),
        rules=[rule.model_dump() for rule in loaded.file.rules]))


@router.put("/manual/{rule_id}", response_model=APIResponse[ManualInputSaved])
def put_manual_signal(rule_id: str, payload: ManualInputIn = Body(...)):
    rule = next((r for r in get_rules().file.rules if r.id == rule_id), None)
    if rule is None or rule.kind != "manual":
        raise HTTPException(status_code=404, detail=f"no manual signal named {rule_id}")
    week = store.iso_week(engine.kst_today())
    store.put_manual_input(rule_id, week, payload.state, payload.note,
                           engine.utc_now().isoformat(timespec="seconds"))
    snapshot = engine.rescore(week)
    return APIResponse(data=ManualInputSaved(iso_week=week, snapshot=_out(snapshot) if snapshot else None))
