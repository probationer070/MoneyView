import numpy as np
import pytest

from packages.core_finance.distributions import SHAPES, sample, validate


def test_the_three_shapes_are_the_whole_set():
    """A fourth shape is a design decision, not an implementation detail: the
    spec rejects lognormal explicitly because truncation against the engine's
    bounds governs the tails here far more than tail shape does."""
    assert SHAPES == frozenset({"triangular", "normal", "uniform"})


def test_a_uniform_sample_stays_inside_its_band():
    rng = np.random.default_rng(42)
    drawn = sample("uniform", {"low": 0.05, "high": 0.09}, 5000, rng)
    assert drawn.shape == (5000,)
    assert drawn.min() >= 0.05
    assert drawn.max() <= 0.09


def test_a_triangular_sample_concentrates_at_its_mode():
    """The mode is what distinguishes triangular from uniform. Without it the
    shape is only a band, and the caller's stated 'most likely' is discarded."""
    rng = np.random.default_rng(42)
    drawn = sample("triangular", {"low": 0.0, "mode": 0.9, "high": 1.0}, 20000, rng)
    assert drawn.min() >= 0.0
    assert drawn.max() <= 1.0
    # Mass sits near the mode, not at the midpoint a uniform would give.
    # Measured 0.720 at this seed; a uniform over the same band gives 0.50, so
    # the threshold discriminates while leaving room for sampling noise.
    assert (drawn > 0.5).mean() > 0.65


def test_a_normal_sample_recovers_its_parameters():
    rng = np.random.default_rng(42)
    drawn = sample("normal", {"mean": 0.28, "sd": 0.03}, 20000, rng)
    assert drawn.mean() == pytest.approx(0.28, abs=0.002)
    assert drawn.std() == pytest.approx(0.03, abs=0.002)


def test_the_same_seed_gives_the_same_draw():
    """A simulation nobody can reproduce cannot be reviewed."""
    a = sample("normal", {"mean": 0.0, "sd": 1.0}, 100, np.random.default_rng(7))
    b = sample("normal", {"mean": 0.0, "sd": 1.0}, 100, np.random.default_rng(7))
    assert np.array_equal(a, b)


@pytest.mark.parametrize("shape,params,message", [
    ("lognormal", {"mean": 1.0, "sd": 1.0}, "unknown shape"),
    ("normal", {"mean": 0.1}, "needs parameters"),
    ("normal", {"mean": 0.1, "sd": 0.0}, "sd must be positive"),
    ("normal", {"mean": 0.1, "sd": -1.0}, "sd must be positive"),
    ("uniform", {"low": 0.5, "high": 0.5}, "low must be less than high"),
    ("uniform", {"low": 0.9, "high": 0.1}, "low must be less than high"),
    ("triangular", {"low": 0.1, "mode": 0.5, "high": 0.1}, "low must be less than high"),
    ("triangular", {"low": 0.1, "mode": 0.9, "high": 0.5}, "mode must lie between"),
    ("triangular", {"low": 0.1, "mode": 0.05, "high": 0.5}, "mode must lie between"),
    ("normal", {"mean": "abc", "sd": 0.1}, "must be a number"),
    ("normal", {"mean": True, "sd": 0.1}, "must be a number"),
    ("normal", {"mean": 0.1, "sd": float("nan")}, "must be finite"),
    ("normal", {"mean": float("nan"), "sd": 0.1}, "must be finite"),
    ("normal", {"mean": 0.1, "sd": float("inf")}, "must be finite"),
    ("uniform", {"low": float("nan"), "high": 1.0}, "must be finite"),
    ("uniform", {"low": 0.0, "high": float("inf")}, "must be finite"),
    ("triangular", {"low": 0.0, "mode": float("nan"), "high": 1.0}, "must be finite"),
])
def test_invalid_parameters_are_refused_by_name(shape, params, message):
    """Refused HERE, where the caller can still be told which parameter is
    wrong. A bad sd reaching numpy raises a bare ValueError from a library
    frame, and a bool reaching the engine becomes 1.0 -- a stored assumption
    nobody typed."""
    with pytest.raises(ValueError, match=message):
        validate(shape, params)


def test_a_valid_distribution_validates_silently():
    validate("triangular", {"low": 0.07, "mode": 0.074, "high": 0.085})
    validate("normal", {"mean": 0.28, "sd": 0.03})
    validate("uniform", {"low": 1.0, "high": 2.0})


def test_a_nan_parameter_never_reaches_the_draw():
    """Without the finiteness check this returned an array of NaN and raised
    nothing -- a silent wrong answer, which is worse than any error. The point
    is not that validate refuses it; it is that no draw ever happens."""
    rng = np.random.default_rng(42)
    with pytest.raises(ValueError, match="must be finite"):
        sample("normal", {"mean": 0.1, "sd": float("nan")}, 100, rng)
