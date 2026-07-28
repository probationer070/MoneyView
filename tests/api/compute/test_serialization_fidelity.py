import enum
import math
from datetime import datetime, timezone

import pytest
from pydantic import BaseModel

from apps.api.compute.serialization import (
    assert_no_decimal_fields,
    dumps_model,
    loads_model,
)
from apps.api.models.schemas import AttributionRequest, AttributionResult


class _Flavor(str, enum.Enum):
    RED = "red"


class _FidelityProbe(BaseModel):
    nan_value: float
    pos_inf: float
    neg_inf: float
    aware_dt: datetime
    naive_dt: datetime
    flavor: _Flavor
    ratios: list[float]


def test_nan_inf_datetime_enum_round_trip_is_stable():
    probe = _FidelityProbe(
        nan_value=float("nan"),
        pos_inf=float("inf"),
        neg_inf=float("-inf"),
        aware_dt=datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc),
        naive_dt=datetime(2026, 7, 24, 12, 0),
        flavor=_Flavor.RED,
        ratios=[1.5, float("nan"), float("inf")],
    )
    restored = loads_model(_FidelityProbe, dumps_model(probe))

    assert math.isnan(restored.nan_value)
    assert restored.pos_inf == float("inf")
    assert restored.neg_inf == float("-inf")
    assert restored.aware_dt == probe.aware_dt
    assert restored.aware_dt.tzinfo is not None
    assert restored.naive_dt == probe.naive_dt
    assert restored.naive_dt.tzinfo is None
    assert restored.flavor is _Flavor.RED
    # non-finite floats survive inside a nested list too
    assert restored.ratios[0] == 1.5
    assert math.isnan(restored.ratios[1])
    assert restored.ratios[2] == float("inf")


def test_dumps_model_output_is_strict_json_no_bare_nan():
    # The wire payload must be strict JSON — NO bare NaN/Infinity tokens, which a
    # strict decoder on the other hop would reject. Non-finite values live in the
    # sentinel object instead.
    probe = _FidelityProbe(
        nan_value=float("nan"), pos_inf=float("inf"), neg_inf=float("-inf"),
        aware_dt=datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc),
        naive_dt=datetime(2026, 7, 24, 12, 0), flavor=_Flavor.RED, ratios=[1.0],
    )
    raw = dumps_model(probe)
    assert "NaN" not in raw
    assert "Infinity" not in raw
    assert "__nonfinite__" in raw


def test_decimal_absence_guard_passes_on_boundary_models():
    # These are the models that cross the boundary in Slice 1.
    assert_no_decimal_fields(AttributionRequest)
    assert_no_decimal_fields(AttributionResult)


def test_decimal_absence_guard_catches_a_decimal_field():
    from decimal import Decimal

    class _Bad(BaseModel):
        price: Decimal

    with pytest.raises(AssertionError):
        assert_no_decimal_fields(_Bad)


def test_decimal_absence_guard_catches_decimal_in_doubly_nested_generic():
    from decimal import Decimal
    from typing import Optional

    class _Bad(BaseModel):
        price: Decimal

    class _Wrapper(BaseModel):
        bads: Optional[list[_Bad]] = None

    with pytest.raises(AssertionError):
        assert_no_decimal_fields(_Wrapper)
