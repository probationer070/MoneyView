import warnings

import numpy as np
import pytest

from packages.core_finance.rank_correlation import spearman


def test_a_monotonic_nonlinear_relation_is_exactly_one():
    """The discriminating test. On a MONOTONIC NONLINEAR relation Spearman is
    exactly 1 while Pearson is not, which is the whole reason the spec chose
    Spearman: the engine is nonlinear, and Pearson would rank a strongly curved
    driver below a weakly linear one. On a LINEAR fixture the two agree, so a
    linear test could not tell them apart -- the same trap the Shapley work hit
    twice."""
    x = np.arange(1.0, 51.0)
    y = x ** 3
    assert spearman(x, y) == pytest.approx(1.0)
    pearson = np.corrcoef(x, y)[0, 1]
    assert pearson < 0.95  # measured 0.9186: the two genuinely differ here


def test_a_decreasing_relation_is_minus_one():
    x = np.arange(1.0, 21.0)
    assert spearman(x, -x) == pytest.approx(-1.0)


def test_ties_take_the_average_rank():
    """A sampled INTEGER field produces many ties. Ranking ties by position
    instead of averaging invents an ordering the data does not have.

    Only x carries the tie here, and that is the point: a fixture where BOTH
    sides tie in the same places is satisfied by positional ranking too, because
    it hands both sides the same spurious ordering and the coefficient is 1.0
    either way. Measured: 0.948683 with average ranks, exactly 1.0 with
    positional ranks."""
    x = np.array([1.0, 1.0, 2.0, 3.0])
    y = np.array([10.0, 20.0, 30.0, 40.0])
    assert spearman(x, y) == pytest.approx(0.948683, abs=1e-6)

    # Hand-check: x average ranks are 1.5, 1.5, 3, 4 against y ranks 1, 2, 3, 4.
    # Centred: (-1, -1, 0.5, 1.5) and (-1.5, -0.5, 0.5, 1.5).
    # numerator 4.5; denominator sqrt(4.5 * 5.0) = 4.743416; 4.5 / 4.743416.
    assert spearman(x, y) == pytest.approx(4.5 / (4.5 * 5.0) ** 0.5, abs=1e-9)


def test_a_constant_input_is_none_not_zero():
    """None means 'not measurable'; 0.0 would claim 'measured, no association'.
    A degenerate distribution -- low == high after rounding to an integer
    field -- produces exactly this."""
    assert spearman(np.full(10, 3.0), np.arange(10.0)) is None
    assert spearman(np.arange(10.0), np.full(10, 3.0)) is None


def test_it_matches_a_hand_computed_case():
    """Hand-computed so the test does not merely agree with the implementation.
    x ranks 1,2,3,4,5; y ranks 2,1,4,3,5. d = -1,1,-1,1,0; sum d^2 = 4.
    rho = 1 - 6*4 / (5*(25-1)) = 1 - 24/120 = 0.8.

    This pins the coefficient's arithmetic, not the Spearman-vs-Pearson choice:
    these y values are a permutation of a linearly spaced set, so Pearson on
    the raw values also comes out to 0.8 here.
    test_a_monotonic_nonlinear_relation_is_exactly_one is the only test that
    separates Spearman from Pearson."""
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    y = np.array([20.0, 10.0, 40.0, 30.0, 50.0])
    assert spearman(x, y) == pytest.approx(0.8)


def test_nan_in_x_raises():
    """A NaN is not silently ranked. np.argsort sorts it to the end and
    np.unique treats it as its own value, so without this guard a NaN would be
    assigned the largest rank and folded into the coefficient -- measured,
    one NaN in a 4-element array returned 0.4 rather than raising."""
    x = np.array([1.0, np.nan, 3.0, 4.0])
    y = np.array([1.0, 2.0, 3.0, 4.0])
    with pytest.raises(ValueError, match="must be finite"):
        spearman(x, y)


def test_nan_in_y_raises():
    x = np.array([1.0, 2.0, 3.0, 4.0])
    y = np.array([1.0, np.nan, 3.0, 4.0])
    with pytest.raises(ValueError, match="must be finite"):
        spearman(x, y)


def test_infinity_raises():
    x = np.array([1.0, np.inf, 3.0, 4.0])
    y = np.array([1.0, 2.0, 3.0, 4.0])
    with pytest.raises(ValueError, match="must be finite"):
        spearman(x, y)


def test_empty_input_is_none_with_no_warning():
    """Zero valid samples is a real outcome /simulate can reach when every
    draw is refused. None is the right answer, but the empty-slice arithmetic
    on the way there must not emit a numpy RuntimeWarning -- a run configured
    with -W error would fail on it otherwise."""
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        result = spearman(np.array([]), np.array([]))
    assert result is None
