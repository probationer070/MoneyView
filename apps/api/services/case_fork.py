"""Fork a stored valuation case with changed assumptions.

Everything a fork does not mention is copied from the parent. Everything it does
mention is validated first, then applied. The result goes through `create_case`,
so the narrative rule and the engine's runnability gate apply to a fork exactly
as they apply to any other case -- a fork endpoint that bypassed them would be
the hole in the guarantee that every stored case is runnable.
"""
from __future__ import annotations

from apps.api.services.valuation_case import (
    _CASE_COLUMNS,
    _SEGMENT_COLUMNS,
    NARRATED_FIELDS,
    create_case,
    load_case,
)

# Set by the caller, never copied: a fork's name is new and its parent is the
# case it came from.
_UNSETTABLE_CASE_FIELDS = frozenset({"case_name", "parent_case_id"})
_SETTABLE_CASE_FIELDS = frozenset(_CASE_COLUMNS) - _UNSETTABLE_CASE_FIELDS
_SETTABLE_SEGMENT_FIELDS = frozenset(_SEGMENT_COLUMNS) - {"name"}


class ForkRefused(Exception):
    """A fork the caller must change. The message carries a machine-readable
    prefix so a route can map it to a status without parsing prose."""


_THREE_P = frozenset({"possible", "plausible", "probable"})


def _unwrap(field: str, raw: object) -> tuple[float, str | None, str, str, str]:
    """Return (value, claim, evidence_source, confidence, three_p) for one override.

    A narrated field arrives as an object carrying its claim; an unnarrated one
    arrives as a bare scalar. Mixing them up is refused rather than guessed at.
    """
    narrated = field in NARRATED_FIELDS
    if isinstance(raw, dict):
        if not narrated:
            raise ForkRefused(
                f"unexpected_narrative: {field} is not a narrated field, so it takes "
                "a bare value rather than a claim"
            )
        if "value" not in raw:
            raise ForkRefused(f"narrative_required: {field} override has no 'value'")
        claim = str(raw.get("claim") or "").strip()
        if not claim:
            raise ForkRefused(
                f"narrative_required: {field} is a narrated field, so changing it "
                "needs a claim -- the parent's claim describes a different number"
            )
        three_p = str(raw.get("three_p") or "")
        if three_p not in _THREE_P:
            # NOT defaulted: three_p is an epistemic claim about the assumption,
            # and picking one for the caller asserts a confidence nobody stated.
            raise ForkRefused(
                f"narrative_required: {field} needs a three_p of "
                f"{sorted(_THREE_P)}, got {three_p!r}"
            )
        return (
            raw["value"],
            claim,
            str(raw.get("evidence_source") or "fork"),
            str(raw.get("confidence") or "assumed"),
            three_p,
        )
    if narrated:
        raise ForkRefused(
            f"narrative_required: {field} is a narrated field, so changing it needs "
            "a claim -- the parent's claim describes a different number"
        )
    return raw, None, "", "", ""


def effective_changes(parent: dict, overrides: dict) -> dict[str, tuple[float, float]]:
    """Canonical key -> (parent value, requested value), for CHANGED fields only.

    Validation happens here, before anything is counted: an override equal to the
    parent's stored value is discarded rather than counted, because the
    attribution cap and `changed_input_count` describe changed dimensions, not
    request keys.
    """
    changes: dict[str, tuple[float, float]] = {}

    for field, raw in (overrides.get("case") or {}).items():
        if field not in _SETTABLE_CASE_FIELDS:
            raise ForkRefused(f"unknown_field: case.{field} is not a settable case column")
        value, _, _, _, _ = _unwrap(field, raw)
        if value != parent[field]:
            changes[f"case.{field}"] = (parent[field], value)

    by_name = {segment["name"]: segment for segment in parent["segments"]}
    for segment_name, fields in (overrides.get("segments") or {}).items():
        if segment_name not in by_name:
            raise ForkRefused(
                f"unknown_segment: {segment_name!r} is not a segment of this case; "
                f"it has {sorted(by_name)}"
            )
        segment = by_name[segment_name]
        for field, raw in fields.items():
            if field not in _SETTABLE_SEGMENT_FIELDS:
                raise ForkRefused(
                    f"unknown_field: segment.{segment_name}.{field} is not a settable "
                    "segment column"
                )
            value, _, _, _, _ = _unwrap(field, raw)
            if value != segment[field]:
                changes[f"segment.{segment_name}.{field}"] = (segment[field], value)

    return changes


def fork_case(case_id: int, case_name: str, overrides: dict) -> int:
    """Persist a copy of `case_id` with `overrides` applied. Returns the new id.

    Raises `CaseNotFound` for an unknown parent, `ForkRefused` for a request the
    caller must change, and `ValueError` from `create_case` when the engine
    refuses the resulting case.
    """
    parent = load_case(case_id)
    changes = effective_changes(parent, overrides)
    if not changes:
        raise ForkRefused(
            "no_effective_change: the fork changes nothing -- every override "
            "already matches the parent's stored value"
        )

    payload = {field: parent[field] for field in _CASE_COLUMNS}
    payload["case_name"] = case_name
    payload["parent_case_id"] = case_id
    for field, raw in (overrides.get("case") or {}).items():
        payload[field], _, _, _, _ = _unwrap(field, raw)

    payload["segments"] = []
    for segment in parent["segments"]:
        copy = {field: segment[field] for field in _SEGMENT_COLUMNS}
        narratives = {n["input_field"]: dict(n) for n in segment["narratives"]}
        for field, raw in (overrides.get("segments") or {}).get(segment["name"], {}).items():
            value, claim, source, confidence, three_p = _unwrap(field, raw)
            copy[field] = value
            if claim is not None:
                # Replace, never inherit: the parent's claim describes the value
                # this override just superseded.
                narratives[field] = {
                    "input_field": field,
                    "claim": claim,
                    "evidence_source": source,
                    "confidence": confidence,
                    "three_p": three_p,
                }
        copy["narratives"] = [narratives[k] for k in sorted(narratives)]
        payload["segments"].append(copy)

    return create_case(payload)
