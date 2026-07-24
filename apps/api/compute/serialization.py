"""The single serializer that crosses the compute boundary (spec §A-3).

One shared serialization policy is used on BOTH ends so a value encoded by one
process is decoded identically by the other. It builds on pydantic
(`model_dump(mode="python")` / `model_validate`) plus stdlib `json`.

JSON has no NaN/Inf: raw pydantic `model_dump_json()` coerces non-finite floats
to `null`, and `model_validate_json()` then rejects `null` for a float field
(verified pydantic 2.12.5). So non-finite floats are mapped to a shared sentinel
object `{"__nonfinite__": "nan"|"inf"|"-inf"}` on the way out and restored on the
way in. This is one shared policy, NOT a per-endpoint encoder — the same two
functions are the only serializer on either side of the hop. No orjson.
"""
from __future__ import annotations

import enum
import json
import math
from datetime import date, datetime
from decimal import Decimal
from typing import TypeVar, get_args, get_origin

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

_NONFINITE_KEY = "__nonfinite__"


def _encode(obj: object) -> object:
    """Make a pydantic `mode="python"` dump strictly JSON-safe.

    pydantic's python dump preserves float('nan')/inf and leaves datetime/enum as
    Python objects; convert each leaf to a JSON-native form. Non-finite floats
    become the shared sentinel so they survive the round trip.
    """
    if isinstance(obj, float):
        if math.isnan(obj):
            return {_NONFINITE_KEY: "nan"}
        if math.isinf(obj):
            return {_NONFINITE_KEY: "inf" if obj > 0 else "-inf"}
        return obj
    if isinstance(obj, enum.Enum):
        return _encode(obj.value)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, (list, tuple)):
        return [_encode(item) for item in obj]
    if isinstance(obj, dict):
        return {key: _encode(value) for key, value in obj.items()}
    return obj


def _decode(obj: object) -> object:
    if isinstance(obj, dict):
        if len(obj) == 1 and _NONFINITE_KEY in obj:
            token = obj[_NONFINITE_KEY]
            mapping = {"nan": float("nan"), "inf": float("inf"), "-inf": float("-inf")}
            if token not in mapping:
                raise ValueError(f"unknown non-finite sentinel token: {token!r}")
            return mapping[token]
        return {key: _decode(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_decode(item) for item in obj]
    return obj


def dumps_model(model: BaseModel) -> str:
    # allow_nan=False: every non-finite float was already sentinel-encoded, so if
    # one slips through json.dumps raises instead of emitting a bare NaN token.
    return json.dumps(_encode(model.model_dump(mode="python")), allow_nan=False)


def loads_model(model_type: type[T], raw: str) -> T:
    return model_type.model_validate(_decode(json.loads(raw)))


def _annotation_mentions_decimal(annotation: object) -> bool:
    if annotation is Decimal:
        return True
    return any(_annotation_mentions_decimal(arg) for arg in get_args(annotation))


def assert_no_decimal_fields(model_type: type[BaseModel], _seen: set | None = None) -> None:
    """Recursively assert no field on model_type (or nested BaseModels) is Decimal."""
    seen = _seen if _seen is not None else set()
    if model_type in seen:
        return
    seen.add(model_type)
    for name, field in model_type.model_fields.items():
        annotation = field.annotation
        assert not _annotation_mentions_decimal(annotation), (
            f"{model_type.__name__}.{name} uses Decimal — not allowed across the compute boundary"
        )
        for arg in (annotation, *get_args(annotation)):
            origin = get_origin(arg) or arg
            if isinstance(origin, type) and issubclass(origin, BaseModel):
                assert_no_decimal_fields(origin, seen)
