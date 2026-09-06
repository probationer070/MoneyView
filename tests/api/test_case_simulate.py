import math

import numpy as np
import pytest

from apps.api.services.case_simulate import (
    MAX_RUNS,
    METRIC,
    MIN_RUNS,
    REFUSED_FRACTION_CAP,
    SimulateRefused,
    _draw,
    _is_suppressed,
    _native,
    _plan,
    simulate_case,
)
from apps.api.services.valuation_case import create_case, load_case, run_case_payload
from packages.core_finance.rank_correlation import spearman
from tests.api.test_case_fork import _parent_payload


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def _narrow(runs: int = 1000, seed: int = 42) -> dict:
    """A distribution tight enough that every draw is runnable."""
    return {
        "runs": runs,
        "seed": seed,
        "distributions": {"case": {"wacc_stable": {
            "shape": "uniform", "low": 0.073, "high": 0.075,
        }}},
    }


def test_the_bounds_are_named_constants():
    assert (MIN_RUNS, MAX_RUNS, REFUSED_FRACTION_CAP) == (1000, 20000, 0.10)


def test_a_clean_run_reports_percentiles_and_accounting(parent_id):
    result = simulate_case(parent_id, _narrow())
    assert result["runs_requested"] == 1000
    assert result["runs_valid"] + result["runs_refused"] == result["runs_requested"]
    assert result["runs_refused"] == 0
    assert result["p10"] < result["p50"] < result["p90"]
    assert result["metric"] == "value_per_share_diluted"
    assert len(result["histogram"]) > 0


def test_the_seed_is_always_reported_and_reproduces_the_run(parent_id):
    """A simulation nobody can reproduce cannot be reviewed."""
    first = simulate_case(parent_id, _narrow(seed=7))
    second = simulate_case(parent_id, _narrow(seed=7))
    assert first["seed"] == 7
    assert (first["p10"], first["p50"], first["p90"]) == (
        second["p10"], second["p50"], second["p90"])


def test_an_absent_seed_is_generated_and_reported(parent_id):
    request = _narrow()
    del request["seed"]
    result = simulate_case(parent_id, request)
    assert isinstance(result["seed"], int)


def test_the_accounting_identity_holds_when_samples_are_refused(parent_id):
    """A band wide enough to straddle the engine's terminal-spread guard. The
    identity is what makes silent dropping impossible to hide."""
    result = simulate_case(parent_id, {
        "runs": 2000, "seed": 42,
        "distributions": {"case": {"wacc_stable": {
            "shape": "uniform", "low": 0.020, "high": 0.090}}},
    })
    assert result["runs_refused"] > 0
    assert result["runs_valid"] + result["runs_refused"] == result["runs_requested"]
    assert sum(group["count"] for group in result["refusals"]) == result["runs_refused"]


def test_above_the_threshold_the_numbers_are_omitted_not_nulled(parent_id):
    """Absent keys, never null and never zero: a refusal is content, not a zero
    wearing a value's clothes."""
    result = simulate_case(parent_id, {
        "runs": 2000, "seed": 42,
        "distributions": {"case": {"terminal_growth": {
            "shape": "uniform", "low": 0.020, "high": 0.200}}},
    })
    assert result["refused_fraction"] >= REFUSED_FRACTION_CAP
    for omitted in ("p10", "p50", "p90", "mean", "histogram",
                    "association_among_accepted_samples"):
        assert omitted not in result
    assert "conditional on the engine accepting" in result["suppressed"]
    assert result["refusals"]


def test_below_the_threshold_the_association_is_named_for_its_conditioning(parent_id):
    """The name carries the conditioning so it survives being pasted into a
    spreadsheet away from the disclosure."""
    result = simulate_case(parent_id, _narrow())
    rows = result["association_among_accepted_samples"]
    assert [row["input"] for row in rows] == ["case.wacc_stable"]
    assert rows[0]["spearman"] < 0  # a higher discount rate lowers value


def test_a_sampled_integer_field_reaches_the_engine_as_an_int(parent_id):
    """wacc_converge_from is an INTEGER column. A float there raises
    `TypeError: can't multiply sequence by non-int of type 'float'` three layers
    down -- a 500, and the exact defect ERROR-LOG records for /fork."""
    result = simulate_case(parent_id, {
        "runs": 1000, "seed": 42,
        "distributions": {"case": {"wacc_converge_from": {
            "shape": "uniform", "low": 3.0, "high": 7.0}}},
    })
    assert result["runs_refused"] == 0
    assert result["runs_valid"] == 1000


def test_an_unknown_case_field_is_refused(parent_id):
    with pytest.raises(SimulateRefused, match="unknown_field"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "case": {"not_a_column": {"shape": "normal", "mean": 1.0, "sd": 0.1}}}})


def test_a_non_numeric_column_is_refused(parent_id):
    """ticker and as_of_date identify the case rather than value it."""
    with pytest.raises(SimulateRefused, match="unknown_field"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "case": {"as_of_date": {"shape": "normal", "mean": 1.0, "sd": 0.1}}}})


def test_an_unknown_segment_is_refused(parent_id):
    with pytest.raises(SimulateRefused, match="unknown_segment"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "segments": {"Cor": {"margin_target": {
                "shape": "normal", "mean": 0.28, "sd": 0.01,
                "claim": "c", "three_p": "possible"}}}}})


def test_an_unknown_shape_is_refused(parent_id):
    with pytest.raises(SimulateRefused, match="unknown_shape"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "case": {"wacc_stable": {"shape": "lognormal", "mean": 0.07, "sd": 0.01}}}})


def test_incoherent_parameters_are_refused(parent_id):
    with pytest.raises(SimulateRefused, match="invalid_distribution"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "case": {"wacc_stable": {"shape": "uniform", "low": 0.09, "high": 0.07}}}})


@pytest.mark.parametrize("runs", [999, 20001, 0, -5])
def test_runs_outside_the_band_is_refused(parent_id, runs):
    with pytest.raises(SimulateRefused, match="invalid_runs"):
        simulate_case(parent_id, {"runs": runs, "distributions": {
            "case": {"wacc_stable": {"shape": "normal", "mean": 0.074, "sd": 0.001}}}})


def test_no_distributions_is_refused(parent_id):
    with pytest.raises(SimulateRefused, match="no_distributions"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {}})


def test_a_narrated_field_needs_a_claim_and_three_p(parent_id):
    """The narrative rule applies unchanged: a distribution asserts MORE than a
    point estimate, so it needs a stated basis, not less of one."""
    with pytest.raises(SimulateRefused, match="narrative_required"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "segments": {"Core": {"margin_target": {
                "shape": "normal", "mean": 0.28, "sd": 0.01}}}}})


def test_a_claim_on_an_unnarrated_field_is_refused(parent_id):
    with pytest.raises(SimulateRefused, match="unexpected_narrative"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "case": {"wacc_stable": {
                "shape": "normal", "mean": 0.074, "sd": 0.001,
                "claim": "c", "three_p": "possible"}}}})


def test_the_suppression_boundary_is_inclusive():
    """No sampling fixture lands on exactly REFUSED_FRACTION_CAP -- the
    omission fixture above hits 0.8825 -- so the boundary is pinned directly
    against the extracted decision rather than against a brittle sample."""
    assert _is_suppressed(REFUSED_FRACTION_CAP) is True
    assert _is_suppressed(REFUSED_FRACTION_CAP - 0.0001) is False
    assert _is_suppressed(REFUSED_FRACTION_CAP + 0.01) is True


def test_a_sampled_integer_field_is_rounded_not_truncated():
    """`_native`'s int() truncates toward zero, so without `_draw`'s rint every
    sampled INTEGER field would be biased low by half a unit and its top value
    would never occur. Measured over uniform(3, 7): mean 5.00 rounded against
    4.50 truncated, distinct values [3,4,5,6,7] against [3,4,5,6]."""
    drawn = _draw(
        {"case.wacc_converge_from": {"shape": "uniform",
                                     "params": {"low": 3.0, "high": 7.0}}},
        20000, np.random.default_rng(42),
    )
    values = drawn["case.wacc_converge_from"]
    assert np.array_equal(values, np.rint(values))   # integral, not truncated
    assert values.mean() == pytest.approx(5.0, abs=0.05)
    assert set(np.unique(values).tolist()) == {3.0, 4.0, 5.0, 6.0, 7.0}


def test_a_non_finite_engine_result_is_counted_not_raised(parent_id):
    """cash and ipo_proceeds are each finite and pass distributions.validate, but
    their SUM overflows float64 inside the engine's equity bridge -- the engine
    returns successfully with inf, which reaches np.histogram as a bare
    ValueError ("autodetected range ... is not finite") if not caught here. Every
    draw in this band overflows, so the response is suppressed like any other
    all-refused run rather than 500ing."""
    result = simulate_case(parent_id, {
        "runs": 1000, "seed": 42,
        "distributions": {"case": {
            "cash": {"shape": "uniform", "low": 9.9e307, "high": 1.0e308},
            "ipo_proceeds": {"shape": "uniform", "low": 9.9e307, "high": 1.0e308},
        }},
    })
    assert result["runs_refused"] == 1000
    assert result["refused_fraction"] == 1.0
    assert "suppressed" in result
    codes = {group["code"] for group in result["refusals"]}
    assert "non_finite_result" in codes


def test_the_accounting_identity_holds_for_non_finite_results(parent_id):
    result = simulate_case(parent_id, {
        "runs": 1000, "seed": 42,
        "distributions": {"case": {
            "cash": {"shape": "uniform", "low": 9.9e307, "high": 1.0e308},
            "ipo_proceeds": {"shape": "uniform", "low": 9.9e307, "high": 1.0e308},
        }},
    })
    assert result["runs_valid"] + result["runs_refused"] == result["runs_requested"]


def test_a_partly_non_finite_run_reports_over_the_survivors_and_says_so(parent_id):
    """The subtlest state this service produces: some draws overflow, the
    refused fraction stays under the cap, and the percentiles are therefore
    computed over the survivors -- conditional on acceptance, as spec section 8
    describes. The conditioning is not hidden: refused_fraction and the refusal
    group both report it. Measured at this seed: 966 finite, 34 non-finite."""
    result = simulate_case(parent_id, {
        "runs": 1000, "seed": 42,
        "distributions": {"case": {
            "cash": {"shape": "uniform", "low": 1e307, "high": 1e308},
            "ipo_proceeds": {"shape": "uniform", "low": 1e307, "high": 1e308},
        }},
    })

    assert result["runs_refused"] > 0
    assert result["refused_fraction"] < REFUSED_FRACTION_CAP
    assert result["runs_valid"] + result["runs_refused"] == result["runs_requested"]

    # Below the cap, the summary IS reported -- over the survivors only.
    assert "p50" in result
    assert result["runs_valid"] < result["runs_requested"]

    # And the conditioning is visible rather than implied.
    assert [group["code"] for group in result["refusals"]] == ["non_finite_result"]


def test_the_association_pairs_each_output_with_the_draw_that_produced_it(parent_id):
    """The reported association is only meaningful if each sampled value is
    paired with the output THAT draw produced. An off-by-correspondence bug --
    right array length, wrong pairing -- leaves every other assertion in this
    file green while silently reporting an association between values that never
    met. Recomputed here from an independent replay of the same seeded draw."""
    request = {
        "runs": 1000, "seed": 42,
        "distributions": {"case": {
            "cash": {"shape": "uniform", "low": 1e307, "high": 1e308},
            "ipo_proceeds": {"shape": "uniform", "low": 1e307, "high": 1e308},
        }},
    }
    result = simulate_case(parent_id, request)

    # Independent replay: same seed, same draws, run the engine ourselves.
    case = load_case(parent_id)
    planned = _plan(case, request["distributions"])
    drawn = _draw(planned, request["runs"], np.random.default_rng(request["seed"]))
    key = next(iter(drawn))
    accepted_x, observed = [], []
    for row in range(request["runs"]):
        overrides = {k: _native(drawn[k][row], k) for k in drawn}
        try:
            value = run_case_payload(case, overrides)[METRIC]
        except ValueError:
            continue
        if not math.isfinite(value):
            continue
        accepted_x.append(drawn[key][row])
        observed.append(value)

    expected = spearman(np.asarray(accepted_x), np.asarray(observed))
    reported = {row["input"]: row["spearman"]
                for row in result["association_among_accepted_samples"]}
    assert reported[key] == pytest.approx(expected, rel=1e-12)

    # The same replay pins each reported quantile to the quantile it is NAMED
    # for. Spec section 10's first row -- "return the mean where p50 is asked
    # for" -- passed 335 tests before this assertion existed, because the only
    # other check on p10/p50/p90 was that they are in ascending order, which any
    # monotone triple satisfies. A percentile is a specific number, not a
    # position in a sorted list of three.
    survivors = np.asarray(observed, dtype=float)
    assert result["p10"] == pytest.approx(float(np.percentile(survivors, 10)), rel=1e-12)
    assert result["p50"] == pytest.approx(float(np.percentile(survivors, 50)), rel=1e-12)
    assert result["p90"] == pytest.approx(float(np.percentile(survivors, 90)), rel=1e-12)

    # This fixture's survivors are near 1e306, so their SUM overflows while
    # every percentile stays finite. `mean` is therefore omitted -- not null --
    # and the response says which figure went and why. Each summary figure is
    # kept or dropped on its own merit rather than as a block.
    assert "mean" not in result
    assert not math.isfinite(float(survivors.mean()))
    assert "mean" in result["not_finite"]
    assert len(accepted_x) == result["runs_valid"]


def test_confidence_absent_on_a_narrated_field_is_accepted(parent_id):
    """confidence defaults the same way case_fork._unwrap defaults it: only a
    SUPPLIED value is validated, an absent one is fine."""
    result = simulate_case(parent_id, {
        "runs": 1000, "seed": 42,
        "distributions": {"segments": {"Core": {"margin_target": {
            "shape": "normal", "mean": 0.28, "sd": 0.01,
            "claim": "c", "three_p": "possible"}}}},
    })
    assert result["runs_requested"] == 1000


def test_a_supplied_invalid_confidence_is_refused(parent_id):
    with pytest.raises(SimulateRefused, match="narrative_required"):
        simulate_case(parent_id, {"runs": 1000, "distributions": {
            "segments": {"Core": {"margin_target": {
                "shape": "normal", "mean": 0.28, "sd": 0.01,
                "claim": "c", "three_p": "possible",
                "confidence": "totally_not_a_real_value"}}}}})


def test_max_runs_is_accepted_by_the_bounds_check(parent_id):
    """Proves MAX_RUNS clears the runs bound without paying for 20,000 samples:
    an empty distributions dict fails on no_distributions, not invalid_runs."""
    with pytest.raises(SimulateRefused, match="no_distributions"):
        simulate_case(parent_id, {"runs": MAX_RUNS, "distributions": {}})


def test_a_distribution_whose_draws_overflow_is_refused(parent_id):
    """Finite PARAMETERS do not imply finite DRAWS: normal(1e308, 1e308) yields
    infinities from parameters `distributions.validate` accepts, because the
    overflow happens in the draw rather than in the stated numbers.

    Before this guard nothing owned that gap -- distributions.py owns parameters
    and the sampling loop owns engine RESULTS -- so an infinite draw reached
    `_native`'s int() as an uncaught OverflowError, or was accepted by the engine
    and later raised inside `spearman`. Both were 500s on a well-formed request.
    Refused rather than counted: a distribution whose draws overflow is one the
    caller got wrong, which is a property of the request, not an unlucky sample.
    """
    with pytest.raises(SimulateRefused, match="invalid_distribution"):
        simulate_case(parent_id, {
            "runs": 1000, "seed": 42,
            "distributions": {"case": {"wacc_converge_from": {
                "shape": "normal", "mean": 1e308, "sd": 1e308}}},
        })


def test_the_other_overflow_path_is_refused_too(parent_id):
    """The second 500 the review found, via a different field: infinite draws
    the ENGINE accepts (value -> 0.0, finite) land in accepted_rows and reach
    `spearman`, which refuses non-finite input. Same guard closes both."""
    with pytest.raises(SimulateRefused, match="invalid_distribution"):
        simulate_case(parent_id, {
            "runs": 1000, "seed": 42,
            "distributions": {"case": {"shares_basic": {
                "shape": "normal", "mean": 1.79e308, "sd": 1e306}}},
        })
