"""Attribute the difference between a forked case and its parent, per input.

The metric is `value_per_share_diluted` -- the same number
`valuation_verdict`'s dcf_gap row consumes, so the two layers agree about what
"the valuation" is.
"""
from __future__ import annotations

import math

from apps.api.services.case_fork import _NON_NUMERIC_CASE_FIELDS, effective_changes
from apps.api.services.valuation_case import (
    _CASE_COLUMNS,
    _SEGMENT_COLUMNS,
    NARRATED_FIELDS,
    load_case,
    run_case_payload,
    run_stored_case,
)
from packages.core_finance.shapley import shapley_contributions

METRIC = "value_per_share_diluted"

# 2^12 = 4096 engine runs, about 16 s at the measured 3.98 ms per run: the edge
# of a tolerable synchronous request. Named so the number has one home and its
# rationale travels with it.
SHAPLEY_INPUT_CAP = 12


class DiffRefused(Exception):
    """A diff that cannot be produced. The message carries a machine-readable
    prefix so a route can map it without parsing prose."""


def _canonical_sort_key(key: str) -> tuple:
    """case.* before segment.*, then segment name, then column order."""
    if key.startswith("case."):
        column = key.split(".", 1)[1]
        return (0, _CASE_COLUMNS.index(column), "", 0)
    _, segment_name, column = key.split(".", 2)
    return (1, 0, segment_name, _SEGMENT_COLUMNS.index(column))


def diff_case(case_id: int) -> dict:
    """Shapley attribution of `case_id`'s value difference from its parent."""
    case = load_case(case_id)
    parent_id = case["parent_case_id"]
    if parent_id is None:
        raise DiffRefused(
            f"no_parent: case {case_id} has no parent, so there is nothing to "
            "attribute a difference against"
        )
    parent = load_case(parent_id)

    # Rebuild the overrides the fork applied, as a plain scalar map: the child's
    # stored values ARE the requested ones, so `effective_changes` re-derives the
    # same canonical keys the fork produced.
    overrides = {
        "case": {
            field: case[field]
            for field in _CASE_COLUMNS
            if field not in ("case_name", "parent_case_id")
            and field not in _NON_NUMERIC_CASE_FIELDS
            and case[field] != parent[field]
        },
        "segments": {},
    }
    parent_segments = {s["name"]: s for s in parent["segments"]}
    for segment in case["segments"]:
        original = parent_segments.get(segment["name"])
        if original is None:
            continue
        changed = {
            field: segment[field]
            for field in _SEGMENT_COLUMNS
            if field != "name" and segment[field] != original[field]
        }
        if changed:
            overrides["segments"][segment["name"]] = changed

    changes = effective_changes(parent, _as_bare_scalars(overrides))
    if not changes:
        raise DiffRefused(
            f"no_effective_change: case {case_id} holds the same values as its parent"
        )
    if len(changes) > SHAPLEY_INPUT_CAP:
        raise DiffRefused(
            f"too_many_changed_inputs: {len(changes)} inputs changed, the attribution "
            f"cap is {SHAPLEY_INPUT_CAP}"
        )

    def _metric(inputs: dict) -> float:
        try:
            return run_case_payload(parent, inputs)[METRIC]
        except ValueError as exc:
            # Shapley evaluates every one of the 2^k coalitions, including
            # combinations neither stored case holds. When the engine refuses
            # one, the attribution cannot be computed -- and computing it from
            # the coalitions that DID run would silently drop a term and break
            # conservation. Refuse, naming the engine's own words.
            raise DiffRefused(
                f"unrunnable_coalition: attributing this difference requires "
                f"valuing a combination the engine refuses -- {exc}"
            ) from exc

    base = {key: frm for key, (frm, _) in changes.items()}
    changed_values = {key: to for key, (_, to) in changes.items()}
    contributions = shapley_contributions(base, changed_values, _metric)

    parent_value = _metric(base)
    case_value = _metric(changed_values)

    stored_value = run_stored_case(case_id)[METRIC]
    if not math.isclose(case_value, stored_value, rel_tol=1e-7, abs_tol=1e-9):
        # The reconstruction is only an attribution if it lands on the case it
        # claims to explain. When it does not, the two cases do not share a
        # structure -- a dropped or added segment, most likely -- and every
        # contribution below would be an exact-looking number about a case that
        # does not exist.
        raise DiffRefused(
            f"not_a_fork: case {case_id}'s stored value {stored_value} is not "
            f"reproduced by applying its differences to case {parent_id} "
            f"({case_value}); the two cases do not share a structure"
        )

    return {
        "case_id": case_id,
        "parent_case_id": parent_id,
        "metric": METRIC,
        "parent_value_per_share_diluted": parent_value,
        "case_value_per_share_diluted": case_value,
        "total_difference": case_value - parent_value,
        "method": "shapley",
        "changed_input_count": len(changes),
        "contributions": [
            {
                "input": key,
                "from": changes[key][0],
                "to": changes[key][1],
                "contribution": contributions[key],
            }
            for key in sorted(changes, key=_canonical_sort_key)
        ],
    }


def _as_bare_scalars(overrides: dict) -> dict:
    """`effective_changes` accepts narrated fields only as {value, claim} objects.
    Re-deriving changes from two STORED cases needs no claim -- both already
    passed narrative validation when they were written -- so wrap each scalar
    with a placeholder claim that is never persisted."""
    wrapped = {"case": dict(overrides["case"]), "segments": {}}
    for name, fields in overrides["segments"].items():
        wrapped["segments"][name] = {
            # Only NARRATED fields take the object form. Wrapping an unnarrated
            # one (ramp_start_year) would trip `unexpected_narrative` and crash
            # the diff on a fork that legitimately changed it.
            field: ({"value": value, "claim": "stored", "three_p": "probable"}
                    if field in NARRATED_FIELDS else value)
            for field, value in fields.items()
        }
    return wrapped
