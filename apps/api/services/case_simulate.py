"""Monte Carlo over caller-stated distributions on a stored valuation case.

Every sample runs. Refused samples are counted and grouped, never dropped
silently, because dropping them does not bias an estimate of the same quantity --
it changes WHICH quantity is estimated, to the distribution of the metric
CONDITIONAL on the engine accepting the inputs. Above `REFUSED_FRACTION_CAP`
that conditioning is large enough that the summary statistics are omitted
entirely.

Nothing here is persisted. A simulation is a question asked of a stored case,
not a new case: storing one would create a second kind of case with no narrative
rule over it.
"""
from __future__ import annotations

import secrets

import numpy as np

from apps.api.services.case_fork import (
    _INTEGER_FIELDS,
    _NON_NUMERIC_CASE_FIELDS,
    _SETTABLE_CASE_FIELDS,
    _SETTABLE_SEGMENT_FIELDS,
    _THREE_P,
)
from apps.api.services.engine_refusals import classify
from apps.api.services.valuation_case import (
    NARRATED_FIELDS,
    load_case,
    run_case_payload,
)
from packages.core_finance.distributions import SHAPES, sample, validate
from packages.core_finance.rank_correlation import spearman

METRIC = "value_per_share_diluted"

MIN_RUNS = 1000
MAX_RUNS = 20000

# Below this the conditioning of section 6.1 moves the reported percentiles by
# less than sampling noise at 10,000 runs; above it the surviving sample is
# describing a visibly different question.
REFUSED_FRACTION_CAP = 0.10

_HISTOGRAM_BINS = 32


class SimulateRefused(Exception):
    """A request the caller must change. The message carries a machine-readable
    prefix so a route can map it to a status without parsing prose."""


def _is_suppressed(refused_fraction: float) -> bool:
    """At the cap exactly, the summary statistics are suppressed. Extracted so
    the boundary is testable: no sampling fixture lands on exactly 0.10, and one
    engineered to would be brittle against any engine change."""
    return refused_fraction >= REFUSED_FRACTION_CAP


def _distribution(key: str, field: str, raw: object) -> dict:
    """Validate one distribution against the narrative rule and its own shape."""
    if not isinstance(raw, dict):
        raise SimulateRefused(
            f"invalid_distribution: {key} must be an object with a shape, "
            f"got {type(raw).__name__}"
        )
    shape = raw.get("shape")
    if shape not in SHAPES:
        raise SimulateRefused(
            f"unknown_shape: {key} has shape {shape!r}, expected one of "
            f"{sorted(SHAPES)}"
        )

    narrated = field in NARRATED_FIELDS
    claim = str(raw.get("claim") or "").strip()
    if narrated:
        if not claim:
            raise SimulateRefused(
                f"narrative_required: {key} is a narrated field, so a distribution "
                "over it needs a claim -- a spread asserts more than a point does"
            )
        if str(raw.get("three_p") or "") not in _THREE_P:
            raise SimulateRefused(
                f"narrative_required: {key} needs a three_p of {sorted(_THREE_P)}"
            )
    elif claim:
        raise SimulateRefused(
            f"unexpected_narrative: {key} is not a narrated field, so it takes a "
            "distribution without a claim"
        )

    params = {k: v for k, v in raw.items()
              if k not in ("shape", "claim", "three_p", "evidence_source", "confidence")}
    try:
        validate(shape, params)
    except ValueError as exc:
        raise SimulateRefused(f"invalid_distribution: {key}: {exc}") from exc
    return {"shape": shape, "params": params}


def _plan(case: dict, distributions: dict) -> dict[str, dict]:
    """Canonical key -> {shape, params}, validated against the stored case."""
    planned: dict[str, dict] = {}

    for field, raw in (distributions.get("case") or {}).items():
        if field not in _SETTABLE_CASE_FIELDS or field in _NON_NUMERIC_CASE_FIELDS:
            raise SimulateRefused(
                f"unknown_field: case.{field} is not a settable numeric case column"
            )
        planned[f"case.{field}"] = _distribution(f"case.{field}", field, raw)

    by_name = {segment["name"]: segment for segment in case["segments"]}
    for name, fields in (distributions.get("segments") or {}).items():
        if name not in by_name:
            raise SimulateRefused(
                f"unknown_segment: {name!r} is not a segment of this case; "
                f"it has {sorted(by_name)}"
            )
        for field, raw in fields.items():
            if field not in _SETTABLE_SEGMENT_FIELDS:
                raise SimulateRefused(
                    f"unknown_field: segment.{name}.{field} is not a settable "
                    "segment column"
                )
            key = f"segment.{name}.{field}"
            planned[key] = _distribution(key, field, raw)

    if not planned:
        raise SimulateRefused(
            "no_distributions: a simulation needs at least one distributed input"
        )
    return planned


def _draw(planned: dict[str, dict], runs: int, rng: np.random.Generator) -> dict[str, np.ndarray]:
    """One column of samples per input. INTEGER columns are rounded here.

    Rounding is not cosmetic: `wacc_converge_from` and `ramp_start_year` are
    INTEGER columns, and a float reaching the engine raises `TypeError: can't
    multiply sequence by non-int of type 'float'` three layers down -- a 500,
    and the exact defect ERROR-LOG records against /fork.

    `np.rint` HERE, not just `_native`'s `int()` at the point of use: `rint`
    rounds to the nearest integer where `int()` truncates toward zero. Those
    are different numbers, not different representations of the same one --
    dropping this step would silently bias every sampled INTEGER field low by
    half a unit and make its top value unreachable (measured over
    uniform(3, 7): mean 5.00 rounded against 4.50 truncated). `_native`'s
    conversion exists to give the engine a Python `int` rather than a numpy
    scalar; it does not stand in for the rounding done here.
    """
    drawn: dict[str, np.ndarray] = {}
    for key, plan in planned.items():
        values = sample(plan["shape"], plan["params"], runs, rng)
        field = key.rsplit(".", 1)[1]
        if field in _INTEGER_FIELDS:
            values = np.rint(values)
        drawn[key] = values
    return drawn


def simulate_case(case_id: int, request: dict) -> dict:
    """Sample, run, account, and summarise. Raises CaseNotFound / SimulateRefused."""
    case = load_case(case_id)

    runs = request.get("runs")
    if not isinstance(runs, int) or isinstance(runs, bool) or not MIN_RUNS <= runs <= MAX_RUNS:
        raise SimulateRefused(
            f"invalid_runs: runs must be an integer between {MIN_RUNS} and "
            f"{MAX_RUNS}, got {runs!r}"
        )

    planned = _plan(case, request.get("distributions") or {})

    seed = request.get("seed")
    if seed is None:
        seed = secrets.randbelow(2 ** 31)
    rng = np.random.default_rng(seed)
    drawn = _draw(planned, runs, rng)

    keys = list(drawn)
    values: list[float] = []
    accepted_rows: list[int] = []
    refusals: dict[str, dict] = {}

    for row in range(runs):
        overrides = {key: _native(drawn[key][row], key) for key in keys}
        try:
            values.append(run_case_payload(case, overrides)[METRIC])
            accepted_rows.append(row)
        except ValueError as exc:
            message = str(exc)
            code = classify(message)
            group = refusals.setdefault(code, {"code": code, "count": 0, "message": message})
            group["count"] += 1

    runs_refused = runs - len(values)
    refused_fraction = runs_refused / runs
    result = {
        "case_id": case_id,
        "metric": METRIC,
        "seed": int(seed),
        "runs_requested": runs,
        "runs_valid": len(values),
        "runs_refused": runs_refused,
        "refused_fraction": refused_fraction,
        "refusals": sorted(refusals.values(), key=lambda g: (-g["count"], g["code"])),
    }

    if _is_suppressed(refused_fraction):
        result["suppressed"] = (
            f"refused_fraction {refused_fraction:.4g} >= {REFUSED_FRACTION_CAP}: "
            "the surviving sample describes the distribution of "
            f"{METRIC} conditional on the engine accepting the inputs, not the "
            "distribution the stated inputs describe"
        )
        return result

    observed = np.asarray(values, dtype=float)
    counts, edges = np.histogram(observed, bins=_HISTOGRAM_BINS)
    accepted = np.asarray(accepted_rows, dtype=int)
    result.update({
        "p10": float(np.percentile(observed, 10)),
        "p50": float(np.percentile(observed, 50)),
        "p90": float(np.percentile(observed, 90)),
        "mean": float(observed.mean()),
        "histogram": [
            {"lower": float(edges[i]), "upper": float(edges[i + 1]), "count": int(counts[i])}
            for i in range(len(counts))
        ],
        "association_among_accepted_samples": [
            {"input": key, "spearman": spearman(drawn[key][accepted], observed)}
            for key in keys
        ],
    })
    return result


def _native(value: float, key: str) -> float | int:
    """numpy scalar -> Python scalar, int for the INTEGER columns."""
    if key.rsplit(".", 1)[1] in _INTEGER_FIELDS:
        return int(value)
    return float(value)
