import math

import pytest

from packages.core_finance.shapley import shapley_contributions


def test_linear_model_returns_marginal_effects():
    """A linear function's Shapley values ARE its marginal effects, so the
    expected numbers are computable by hand rather than by running another
    implementation and trusting it."""
    f = lambda x: 3 * x["a"] + 5 * x["b"] - 2 * x["c"]
    base = {"a": 1.0, "b": 1.0, "c": 1.0}
    changed = {"a": 2.0, "b": 3.0, "c": 0.5}

    got = shapley_contributions(base, changed, f)

    assert got["a"] == pytest.approx(3.0)     # 3 * (2 - 1)
    assert got["b"] == pytest.approx(10.0)    # 5 * (3 - 1)
    assert got["c"] == pytest.approx(1.0)     # -2 * (0.5 - 1)


def test_nonlinear_model_splits_the_interaction_evenly():
    """THE test for this module. On f(a,b) = a*b the interaction term is real,
    and this is where Shapley differs from applying changes in sequence:

        shapley        a=6.0   b=8.0
        sequential a,b a=2.0   b=12.0
        sequential b,a a=10.0  b=4.0

    Hand-computed: phi_a = 1/2[(3*1 - 1*1) + (3*5 - 1*5)] = 1/2[2 + 10] = 6
                   phi_b = 1/2[(1*5 - 1*1) + (3*5 - 3*1)] = 1/2[4 + 12] = 8

    The LINEAR fixture above cannot catch a sequential implementation -- every
    method agrees on a linear function -- so without this test the suite would
    pass unchanged if Shapley were replaced by sequential attribution.
    """
    f = lambda x: x["a"] * x["b"]
    base = {"a": 1.0, "b": 1.0}
    changed = {"a": 3.0, "b": 5.0}

    got = shapley_contributions(base, changed, f)

    assert got["a"] == pytest.approx(6.0)
    assert got["b"] == pytest.approx(8.0)
    assert sum(got.values()) == pytest.approx(14.0)   # f(3,5) - f(1,1)


def test_contributions_are_invariant_to_key_order():
    """Order-independence is the property the whole design rests on. Sequential
    attribution fails this; Shapley cannot."""
    f = lambda x: x["a"] * x["b"] + x["c"] ** 2
    base = {"a": 1.0, "b": 2.0, "c": 1.0}
    changed = {"a": 4.0, "b": 3.0, "c": 2.0}

    forward = shapley_contributions(base, changed, f)
    reversed_keys = shapley_contributions(
        {k: base[k] for k in reversed(list(base))},
        {k: changed[k] for k in reversed(list(changed))},
        f,
    )

    for key in forward:
        assert forward[key] == pytest.approx(reversed_keys[key], rel=1e-12)


def test_contributions_conserve_the_total_difference():
    f = lambda x: 120.0 * (1 + x["a"]) ** 2 * (1 + x["b"]) / (1 + x["c"])
    base = {"a": 0.05, "b": 0.10, "c": 0.20}
    changed = {"a": 0.08, "b": 0.04, "c": 0.11}

    got = shapley_contributions(base, changed, f)
    total = f(changed) - f(base)

    assert math.isclose(sum(got.values()), total, rel_tol=1e-7, abs_tol=1e-9)


def test_an_unchanged_key_is_not_a_player():
    """Only CHANGED keys are players. A key whose value is identical in both
    dicts contributes nothing and must not appear -- it would be a zero row
    implying an assumption was examined when it never moved."""
    f = lambda x: x["a"] + x["b"]
    got = shapley_contributions({"a": 1.0, "b": 2.0}, {"a": 5.0, "b": 2.0}, f)
    assert set(got) == {"a"}


def test_no_changed_keys_returns_nothing():
    f = lambda x: x["a"]
    assert shapley_contributions({"a": 1.0}, {"a": 1.0}, f) == {}
