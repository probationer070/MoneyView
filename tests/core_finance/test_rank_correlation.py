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
    instead of averaging invents an ordering the data does not have, and the
    coefficient then depends on input order."""
    x = np.array([1.0, 1.0, 2.0, 2.0, 3.0])
    y = np.array([5.0, 5.0, 7.0, 7.0, 9.0])
    assert spearman(x, y) == pytest.approx(1.0)
    shuffled = np.array([1.0, 2.0, 1.0, 3.0, 2.0])
    shuffled_y = np.array([5.0, 7.0, 5.0, 9.0, 7.0])
    assert spearman(shuffled, shuffled_y) == pytest.approx(1.0)


def test_a_constant_input_is_none_not_zero():
    """None means 'not measurable'; 0.0 would claim 'measured, no association'.
    A degenerate distribution -- low == high after rounding to an integer
    field -- produces exactly this."""
    assert spearman(np.full(10, 3.0), np.arange(10.0)) is None
    assert spearman(np.arange(10.0), np.full(10, 3.0)) is None


def test_it_matches_a_hand_computed_case():
    """Hand-computed so the test does not merely agree with the implementation.
    x ranks 1,2,3,4,5; y ranks 2,1,4,3,5. d = -1,1,-1,1,0; sum d^2 = 4.
    rho = 1 - 6*4 / (5*(25-1)) = 1 - 24/120 = 0.8."""
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    y = np.array([20.0, 10.0, 40.0, 30.0, 50.0])
    assert spearman(x, y) == pytest.approx(0.8)
