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

# TEXT columns (db.py). They identify the case rather than value it: a fork
# is the same company, and neither is an attributable input, so neither is
# settable and neither is a Shapley player. Excluded HERE, once, because
# defining "a changed input" by subtraction in two modules is what let a
# string reach _as_number and 500 the endpoint.
_NON_NUMERIC_CASE_FIELDS = frozenset({"ticker", "as_of_date"})

_SETTABLE_CASE_FIELDS = (
    frozenset(_CASE_COLUMNS) - _UNSETTABLE_CASE_FIELDS - _NON_NUMERIC_CASE_FIELDS
)
_SETTABLE_SEGMENT_FIELDS = frozenset(_SEGMENT_COLUMNS) - {"name"}


class ForkRefused(Exception):
    """A fork the caller must change. The message carries a machine-readable
    prefix so a route can map it to a status without parsing prose."""


_THREE_P = frozenset({"possible", "plausible", "probable"})

# db.py's segment_narrative table: CHECK(confidence IN
# ('confirmed','derived','assumed')), the same shape of constraint as
# three_p's. Unlike three_p, confidence IS defaulted (see _unwrap) -- the spec
# permits defaulting it, since it is not itself an epistemic claim about the
# assumption -- but a SUPPLIED value must still be one of these three, or it
# reaches sqlite as a raw CHECK constraint failure instead of a refusal the
# caller can branch on.
_CONFIDENCE = frozenset({"confirmed", "derived", "assumed"})

# INTEGER columns (db.py:496,497,501,555). A float here reaches the engine
# as a sequence multiplier or a range bound and raises TypeError three
# layers down, so the shape is checked where the caller can still be told.
_INTEGER_FIELDS = frozenset({
    "base_year", "target_year", "wacc_converge_from", "ramp_start_year",
})


def _as_number(field: str, value: object) -> float:
    """Reject a non-numeric leaf without forcing its type.

    Some settable fields (`ramp_start_year`) are engine-side integers used in
    arithmetic (`[0.0] * lead`) that rejects a float multiplier -- coercing
    every leaf to `float` here would turn a legitimate `ramp_start_year: 2`
    into `2.0` and 500 downstream. Validating without converting keeps an
    int an int and a float a float; only `bool` and non-numeric values are
    refused.

    For a field in `_INTEGER_FIELDS` a float is accepted only when it carries
    no fraction -- JSON does not distinguish `6` from `6.0`, and a client that
    sends the latter means the former -- and is converted to `int` so it
    reaches the engine as the whole number it is. `6.5` is a number but not a
    year, so it is refused rather than silently truncated.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ForkRefused(
            f"not_a_number: {field} must be a number, got {type(value).__name__}"
        )
    if field in _INTEGER_FIELDS:
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        raise ForkRefused(
            f"not_a_number: {field} is a whole-number field, got {value!r}"
        )
    return value


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
        # `in raw` rather than `or`: an ABSENT confidence defaults, but a
        # supplied empty string, null or 0 is a value the caller typed and is
        # refused rather than quietly replaced with "assumed".
        confidence = "assumed" if "confidence" not in raw else str(raw["confidence"])
        if confidence not in _CONFIDENCE:
            # Defaulting is fine (see _CONFIDENCE); a SUPPLIED value that is
            # not one of the three is refused here, before sqlite's CHECK ever
            # sees it -- the same treatment three_p already gets.
            raise ForkRefused(
                f"narrative_required: {field} needs a confidence of "
                f"{sorted(_CONFIDENCE)}, got {confidence!r}"
            )
        return (
            _as_number(field, raw["value"]),
            claim,
            str(raw.get("evidence_source") or "fork"),
            confidence,
            three_p,
        )
    if narrated:
        raise ForkRefused(
            f"narrative_required: {field} is a narrated field, so an override of it "
            "must be an object carrying a claim, not a bare value"
        )
    return _as_number(field, raw), None, "", "", ""


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
        if f"case.{field}" not in changes:
            # Dropping it stores nothing false: the parent's claim (or, for an
            # unnarrated field, the parent's stored value) already describes
            # this exact value, so there is nothing here to apply.
            continue
        payload[field], _, _, _, _ = _unwrap(field, raw)

    payload["segments"] = []
    for segment in parent["segments"]:
        copy = {field: segment[field] for field in _SEGMENT_COLUMNS}
        narratives = {n["input_field"]: dict(n) for n in segment["narratives"]}
        for field, raw in (overrides.get("segments") or {}).get(segment["name"], {}).items():
            if f"segment.{segment['name']}.{field}" not in changes:
                # Dropping it stores nothing false: the parent's claim already
                # describes this exact value, so rewriting the narrative here
                # would attach a fresh sentence to a field /diff reports as
                # unchanged.
                continue
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
