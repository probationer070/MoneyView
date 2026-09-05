"""Sample a stated distribution over one valuation input.

Three shapes, and no more. `lognormal` is deliberately absent: truncation
against the engine's own bounds governs the tails of these inputs far more than
tail shape does, and a shape nobody has asked for is a shape nobody has
justified.

Parameters are validated HERE rather than at the point of use, because a bad
`sd` reaching numpy raises a bare ValueError from a library frame that names
neither the field nor the parameter, and the caller cannot act on it.
"""
from __future__ import annotations

import math
from typing import Mapping

import numpy as np

SHAPES = frozenset({"triangular", "normal", "uniform"})

_REQUIRED: dict[str, tuple[str, ...]] = {
    "triangular": ("low", "mode", "high"),
    "normal": ("mean", "sd"),
    "uniform": ("low", "high"),
}


def _number(shape: str, name: str, value: object) -> float:
    # bool first: isinstance(True, int) is True in Python, so an unguarded
    # bool silently becomes 1.0 -- a parameter nobody typed.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(
            f"{shape} parameter {name} must be a number, got {type(value).__name__}"
        )
    number = float(value)
    # Finiteness is checked HERE rather than left to the comparisons below,
    # because every ordinary comparison against NaN is False: `sd <= 0` and
    # `low >= high` both pass it silently, and the draw then returns an array
    # of NaN with no exception at all.
    if not math.isfinite(number):
        raise ValueError(
            f"{shape} parameter {name} must be finite, got {number}"
        )
    return number


def validate(shape: str, params: Mapping[str, object]) -> None:
    """Raise ValueError naming the offending shape or parameter. Silent if valid."""
    if shape not in SHAPES:
        raise ValueError(f"unknown shape {shape!r}, expected one of {sorted(SHAPES)}")

    required = _REQUIRED[shape]
    missing = [name for name in required if name not in params]
    if missing:
        raise ValueError(
            f"{shape} needs parameters {list(required)}, missing {missing}"
        )

    values = {name: _number(shape, name, params[name]) for name in required}

    if shape == "normal":
        if values["sd"] <= 0:
            raise ValueError(f"normal sd must be positive, got {values['sd']}")
        return

    if values["low"] >= values["high"]:
        raise ValueError(
            f"{shape} low must be less than high, got low={values['low']} "
            f"high={values['high']}"
        )
    if shape == "triangular" and not (
        values["low"] <= values["mode"] <= values["high"]
    ):
        raise ValueError(
            f"triangular mode must lie between low and high, got "
            f"low={values['low']} mode={values['mode']} high={values['high']}"
        )


def sample(
    shape: str,
    params: Mapping[str, object],
    size: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Draw `size` values. Validates first: an unvalidated draw is how a bad
    parameter reaches numpy and comes back as a library-frame error."""
    validate(shape, params)
    if shape == "normal":
        return rng.normal(float(params["mean"]), float(params["sd"]), size)
    if shape == "uniform":
        return rng.uniform(float(params["low"]), float(params["high"]), size)
    return rng.triangular(
        float(params["low"]), float(params["mode"]), float(params["high"]), size
    )
