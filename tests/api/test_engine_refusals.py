import ast
import pathlib

import pytest

from apps.api.services.engine_refusals import REFUSAL_CODES, classify
from apps.api.services.case_diff import METRIC, run_case_payload
from apps.api.services.valuation_case import create_case, load_case
from tests.api.test_case_fork import _parent_payload


@pytest.fixture()
def parent() -> dict:
    return load_case(create_case(_parent_payload()))


# (overrides, expected code). Each entry drives the REAL engine and asserts the
# message it produces maps to the named code.
_CONDITIONS = [
    ({"case.wacc_stable": 0.030, "case.terminal_growth": 0.030},
     "terminal_spread_not_positive"),
    ({"case.roic_stable": 0.050, "case.wacc_stable": 0.090},
     "roic_below_wacc"),
    ({"case.terminal_growth": 0.090}, "terminal_growth_above_riskfree"),
    ({"case.shares_basic": 0.0}, "non_positive_rate"),
    ({"case.marginal_tax_rate": 25.0}, "rate_out_of_unit_interval"),
    ({"case.nol_balance": -1.0}, "negative_balance"),
    ({"case.wacc_converge_from": 999}, "horizon_incoherent"),
    # Brief specifies 1.0e12 here; corrected to 1.0e30 -- see task-3-report.md.
    # With the real _parent_payload fixture (base_revenue=1000.0), 1.0e12 gives
    # ratio 1e9, well inside the reachable range up to ~9.9e23 at the engine's
    # explosive-growth bound, so it does NOT raise at all.
    ({"segment.Core.revenue_target": 1.0e30}, "target_revenue_unreachable"),
    # Fix round 1: five more conditions the review found with no row, all
    # reachable through fields the /simulate sampler draws directly
    # (roic_stable, terminal_growth, target_year, ramp_start_year).
    ({"case.roic_stable": 0.70}, "roic_above_marginal_return"),
    ({"case.terminal_growth": -0.20}, "roic_below_growth_magnitude"),
    ({"case.target_year": 2000}, "horizon_incoherent"),
    # Fix round 2: these two used to both map to the single `ramp_incoherent`
    # bucket; relabeled to the split codes below.
    ({"segment.Core.ramp_start_year": 0}, "ramp_start_year_below_one"),
    ({"segment.Core.ramp_start_year": 50}, "ramp_conflicts_with_base_revenue"),
    # Fix round 2 additions. `curve_conflicts_with_ramp` needs a growth curve
    # (initial_growth or waypoint_gap_fraction) combined with a delayed ramp
    # start -- neither field alone reaches it, since both guards are gated on
    # `ramp_start_year > 1` (or base_revenue == 0). Smallest combination that
    # triggers it: pin initial_growth and delay the ramp by one year.
    ({"segment.Core.initial_growth": 0.1, "segment.Core.ramp_start_year": 2},
     "curve_conflicts_with_ramp"),
    # `ramp_leaves_no_years` needs a zero-base segment (so revenue_path takes
    # the ramp branch at all) whose ramp start leaves fewer than one year to
    # reach the target within the 10-year horizon.
    ({"segment.Core.base_revenue": 0.0, "segment.Core.ramp_start_year": 11},
     "ramp_leaves_no_years"),
    ({"case.wacc_stable": -2.0}, "wacc_below_negative_one"),
    # Fix round 3.
    ({"segment.Core.initial_growth": -2.0}, "initial_growth_below_negative_one"),
    ({"segment.Core.waypoint_gap_fraction": 1.5}, "waypoint_gap_fraction_out_of_range"),
    # Found via the structural test: a stored segment's waypoint_gap_fraction
    # combined with a sampled target_year that moves the horizon off 10 years.
    ({"segment.Core.waypoint_gap_fraction": 0.4, "case.target_year": 2033},
     "gap_curve_wrong_horizon"),
    # Found via the structural test: both curve-selecting fields set at once.
    ({"segment.Core.waypoint_gap_fraction": 0.4, "segment.Core.initial_growth": 0.1},
     "two_curves_conflict"),
]


@pytest.mark.parametrize("overrides,expected", _CONDITIONS)
def test_every_engine_condition_maps_to_its_code(parent, overrides, expected):
    """Completeness is TESTED, not assumed. Codes are assigned by matching engine
    text, so an engine message reworded next month would silently degrade its
    group to `other` and no other test would notice. This drives each condition
    through the real engine and asserts the code."""
    with pytest.raises(ValueError) as caught:
        run_case_payload(parent, overrides)[METRIC]
    assert classify(str(caught.value)) == expected


@pytest.mark.parametrize("overrides,_expected", _CONDITIONS)
def test_no_engine_condition_falls_through_to_other(parent, overrides, _expected):
    """The complement of the test above, stated separately so the failure names
    the right problem: a message reaching `other` means the table needs a row,
    not that a code is wrong."""
    with pytest.raises(ValueError) as caught:
        run_case_payload(parent, overrides)[METRIC]
    assert classify(str(caught.value)) != "other"


def test_an_unrecognised_message_is_other_not_a_guess():
    assert classify("something the engine has never said") == "other"


def test_the_first_matching_row_wins_and_the_table_is_ordered():
    """Order is DEFENSIVE INSURANCE, not currently load-bearing.

    This docstring used to claim the two rows could collide because both
    messages contain "must exceed". They cannot: the markers are
    "must exceed wacc_stable" and "terminal spread is not positive", and neither
    message contains the other's -- reordering the table leaves both classifying
    correctly, and `test_no_raise_site_matches_two_markers` asserts that no
    message anywhere matches two markers. The assertion stays because order
    WOULD become load-bearing if either marker were ever weakened."""
    codes = [code for code, _ in REFUSAL_CODES]
    assert codes.index("roic_below_wacc") < codes.index("terminal_spread_not_positive")


# The engine sources this table must cover. engine_refusals.py's docstring has
# claimed since its first commit that the rows were derived from raise sites in
# BOTH of these; parsing both makes that claim true rather than narrowing the
# claim to the one file the test used to read.
_ENGINE_SOURCES = (
    "packages/core_finance/segment_valuation.py",
    "packages/core_finance/dcf.py",
)


def _raise_message_fragments(
    path: str,
) -> tuple[list[tuple[int, list[str]]], list[tuple[int, str]]]:
    """Split a file's `raise ValueError(...)` sites into the readable and the
    unreadable, as `(readable, unreadable)`.

    `readable` is (line number, literal fragments). An f-string's interpolations
    are dropped and its literal parts kept separately -- checking per-fragment
    rather than joined, so no marker can accidentally match across an
    interpolation boundary.

    `unreadable` is (line number, the argument rendered back to source) for every
    site that HAS an argument yet yields no string literal: `+` concatenation,
    `%` formatting, `.format()`, or a message assembled into a variable first.
    These are REPORTED, not skipped. A message this parser cannot read is a
    message no marker can be checked against, which makes such a site exactly as
    unclassified as one with no row -- and it used to fall through `parts = []`
    into silence. `raise ValueError` and `raise ValueError()` carry no message at
    all and are neither readable nor reported.

    The callee test accepts a bare `ValueError(...)` and any attribute form
    ending in ValueError (`builtins.ValueError(...)`), which the previous
    `func.id` check saw only the first of.
    """
    tree = ast.parse(pathlib.Path(path).read_text(encoding="utf-8"))
    readable: list[tuple[int, list[str]]] = []
    unreadable: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call)):
            continue
        func = node.exc.func
        callee = getattr(func, "id", None) or getattr(func, "attr", None) or ""
        if not callee.endswith("ValueError") or not node.exc.args:
            continue
        arg = node.exc.args[0]
        if isinstance(arg, ast.JoinedStr):
            parts = [v.value for v in arg.values
                     if isinstance(v, ast.Constant) and isinstance(v.value, str)]
        elif isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            parts = [arg.value]
        else:
            parts = []
        if parts:
            readable.append((node.lineno, parts))
        else:
            unreadable.append((node.lineno, ast.unparse(arg)))
    return readable, unreadable


# Raise sites deliberately NOT classified, keyed by (file name, line number).
# Three headed tiers, and they are NOT equivalent -- an entry's tier says how
# much weight its exclusion can bear.
#
# TIER 1 -- dead given the engine's own invariants. No input this module can
# produce reaches these, because an earlier guard on the same call path has
# already rejected it. They stop being dead only if one of those upstream guards
# is weakened, which is a code change, not a sampler change.
_DEAD_GIVEN_ENGINE_INVARIANTS = {
    ("segment_valuation.py", 570): (
        "tax_path's rate_schedule/ebit length-mismatch guard. Its one call site "
        "(run_case, segment_valuation.py:921) always builds rate_schedule via "
        "tax_rate_path with the identical horizon n that produced ebit "
        "(segment_valuation.py:915-920), so the two lengths cannot diverge "
        "through any override run_case_payload exposes -- there is no input that "
        "controls rate_schedule's length independently of ebit's. Defensive "
        "guard against a hypothetical future caller of tax_path with a "
        "hand-built schedule, not a case-input validation."
    ),
    ("segment_valuation.py", 811): (
        "marginal_roic's empty-segments guard. run_case (segment_valuation.py:890) "
        "already raises 'a valuation case needs at least one segment' before "
        "marginal_roic is ever called (segment_valuation.py:927), and "
        "create_case refuses to store a case with no segments in the first "
        "place -- run_case_payload can only override fields of a stored case's "
        "EXISTING segments, never remove a segment from the list. Reachable only "
        "by calling marginal_roic() directly with an empty list, bypassing "
        "run_case entirely."
    ),
    ("segment_valuation.py", 822): (
        "marginal_roic's non-positive-capital guard. total_capital sums "
        "revenue_i / sales_to_capital_late_i across segments; revenue_i > 0 is "
        "already guaranteed by revenue_path's own target-revenue guard "
        "(segment_valuation.py:407-408, run for every segment before "
        "marginal_roic is called) and sales_to_capital_late_i > 0 by "
        "SegmentSpec.__post_init__ (segment_valuation.py:129-133). With at "
        "least one segment (see line 811's entry above), a sum of strictly "
        "positive terms cannot be <= 0 through any override this module "
        "exposes."
    ),
    ("segment_valuation.py", 890): (
        "run_case's own empty-segments guard. create_case (valuation_case.py) "
        "refuses to store a case with no segments, and run_case_payload only "
        "overrides fields of a stored case's EXISTING segments -- it copies "
        "base_case['segments'] and mutates entries by name, never adds or "
        "removes one. No numeric override can make an already-valid stored "
        "case's segment list empty."
    ),
    ("dcf.py", 117): (
        "calculate_intrinsic_value_per_share's non-positive-share-count guard. "
        "Reached from segment_valuation.py with diluted shares derived from "
        "shares_basic + shares_new, and CaseSpec.__post_init__ already "
        "guarantees shares_basic > 0 and shares_new >= 0, so the divisor cannot "
        "reach zero on this path. A zero or negative shares_basic is refused "
        "upstream and classified as non_positive_rate, which is why no sampled "
        "share count arrives here."
    ),
}

# TIER 2 -- reachable only by NULLING a field that is already set. Mechanically
# reachable through the very interface /simulate will call: run_case_payload's
# override loop does no None validation of its own, so `{"case.x": None}` does
# reach these. They rest on an assumption about a sampler that DOES NOT EXIST
# YET -- that it perturbs distributions over already-set numeric fields and
# never removes one -- not on an engine invariant. If /simulate ever gains a
# "what if this were never set" draw, every entry here needs a row instead.
_REACHABLE_ONLY_BY_NULLING = {
    ("segment_valuation.py", 114): (
        "SegmentSpec's None-value guard for its required fields (name, "
        "base_revenue, base_margin, margin_target, sales_to_capital_early, "
        "sales_to_capital_late, ramp_start_year). A None here means a field was "
        "REMOVED, not that a number moved to an implausible value -- distinct "
        "from every magnitude guard this table classifies."
    ),
    ("segment_valuation.py", 183): (
        "target_revenue()'s None-value guard: fires only when revenue_target "
        "is None AND (tam_target is None or market_share_target is None). "
        "create_case's _validate_by_engine (valuation_case.py) runs this exact "
        "engine path at write time, so any STORED case already has one of "
        "these three endpoint fields resolvable -- reaching this guard needs "
        "revenue_target to be NULLED on a segment that already has it set. "
        "Verified live that nulling it does reach this raise."
    ),
    ("segment_valuation.py", 678): (
        "CaseSpec's None-value guard for its required fields (base_year, "
        "target_year, riskfree_rate, wacc_initial, wacc_stable, "
        "wacc_converge_from, marginal_tax_rate, nol_balance, roic_stable, cash, "
        "debt, ipo_proceeds, shares_basic, shares_new). Same shape as line 114."
    ),
}

# TIER 3 -- not on this engine's call path at all. Neither an invariant nor an
# assumption about the sampler: segment_valuation.py never calls this code.
_NOT_ON_THE_SEGMENT_VALUATION_PATH = {
    ("dcf.py", 54): (
        "calculate_terminal_value's WACC-vs-growth guard. segment_valuation.py "
        "does not import it -- its dcf import pulls only calculate_equity_value "
        "and calculate_intrinsic_value_per_share -- so no /simulate draw can "
        "reach this raise. It is reached through multi_stage_dcf and "
        "corporate_dcf.py, a separate engine with its own callers. The "
        "equivalent condition on THIS path is segment_valuation's own terminal "
        "spread guard, which has a row (terminal_spread_not_positive)."
    ),
}

_UNCLASSIFIED_BY_DESIGN = {
    **_DEAD_GIVEN_ENGINE_INVARIANTS,
    **_REACHABLE_ONLY_BY_NULLING,
    **_NOT_ON_THE_SEGMENT_VALUATION_PATH,
}


def test_every_engine_raise_site_is_classified_or_explicitly_excluded():
    """Completeness by CONSTRUCTION rather than by imagination.

    GUARANTEES: for every `raise ValueError(...)` written literally in
    _ENGINE_SOURCES, either some row's marker matches one of its literal message
    fragments, or its (file, line) is in _UNCLASSIFIED_BY_DESIGN with a written
    reason. A site whose message cannot be read statically (`+` concatenation,
    `%`, `.format()`, a variable) fails here in the same breath as a site with no
    row, because a message that cannot be read cannot be checked against a
    marker. Allowlist entries must themselves still name real raise sites, so an
    entry left behind by an edit above it fails rather than quietly excusing a
    line that has moved.

    DOES NOT GUARANTEE: (a) that a matching marker is the RIGHT code -- matching
    is by substring, so a new site whose message happens to contain an existing
    marker is absorbed under that code silently, which is precisely what the old
    single `ramp_incoherent` row did; (b) anything about files outside
    _ENGINE_SOURCES; (c) anything about `raise err` where the exception object
    was built on an earlier line -- that is a Raise whose exc is not a Call, and
    it is skipped; (d) anything about non-ValueError exceptions, or about
    ValueErrors raised out of numpy or the stdlib on engine input.
    """
    problems: list[str] = []
    seen: set[tuple[str, int]] = set()

    for source in _ENGINE_SOURCES:
        name = pathlib.PurePath(source).name
        readable, unreadable = _raise_message_fragments(source)

        for line, rendered in unreadable:
            seen.add((name, line))
            if (name, line) in _UNCLASSIFIED_BY_DESIGN:
                continue
            problems.append(
                f"{name}:{line} raises a ValueError whose message cannot be read "
                f"statically: {rendered}. A message this test cannot read is a "
                "message no row can be checked against. Use an inline string or "
                "an f-string, or add the line to _UNCLASSIFIED_BY_DESIGN with "
                "the reason it needs no row."
            )

        for line, fragments in readable:
            seen.add((name, line))
            if (name, line) in _UNCLASSIFIED_BY_DESIGN:
                continue
            matched = any(marker in fragment
                          for fragment in fragments
                          for _, marker in REFUSAL_CODES)
            if not matched:
                problems.append(
                    f"{name}:{line} raises a message no row matches: "
                    f"{fragments!r}. Add a row, or add the line to "
                    "_UNCLASSIFIED_BY_DESIGN with the reason it is unreachable."
                )

    for key in sorted(_UNCLASSIFIED_BY_DESIGN):
        if key not in seen:
            problems.append(
                f"_UNCLASSIFIED_BY_DESIGN excuses {key[0]}:{key[1]}, which is no "
                "longer a raise ValueError site. Line numbers shift when the "
                "file above them is edited; re-point the entry at the line the "
                "site moved to, or delete it."
            )

    assert not problems, "\n".join(problems)


def test_a_raise_whose_message_cannot_be_read_is_reported_not_skipped(tmp_path):
    """The guard above is itself guarded.

    Its whole value depends on _raise_message_fragments REPORTING what it cannot
    parse instead of dropping it, and a green structural run cannot tell those
    two apart -- exactly the blind spot the structural test exists to end, one
    level up. A fixture module rather than a temporary edit to the real engine,
    so there is nothing to restore afterwards.
    """
    fixture = tmp_path / "raises_fixture.py"
    fixture.write_text(
        "import builtins\n"
        "\n"
        "\n"
        "def f(x):\n"
        "    if x:\n"
        '        raise ValueError("cannot reach a target of " + str(x))\n'
        '    raise builtins.ValueError(f"plain {x} message")\n',
        encoding="utf-8",
    )

    readable, unreadable = _raise_message_fragments(str(fixture))

    # The `+`-concatenated site is reported, and is NOT quietly sitting among
    # the sites that did get checked against the table.
    assert [line for line, _ in unreadable] == [6]
    assert "str(x)" in unreadable[0][1]
    assert 6 not in [line for line, _ in readable]

    # The attribute form is recognised as a ValueError at all, which the old
    # bare-`func.id` callee check did not manage.
    assert readable == [(7, ["plain ", " message"])]


# code -> how many engine raise sites that code currently claims. Measured, not
# assumed: `_raise_message_fragments` produces it, and the test below recomputes
# it live.
_EXPECTED_SITE_COUNTS = {
    "curve_conflicts_with_ramp": 2,
    "gap_curve_wrong_horizon": 1,
    "horizon_incoherent": 3,
    "initial_growth_below_negative_one": 1,
    "negative_balance": 6,
    "non_positive_rate": 7,
    "ramp_conflicts_with_base_revenue": 1,
    "ramp_leaves_no_years": 1,
    "ramp_start_year_below_one": 1,
    "rate_out_of_unit_interval": 2,
    "roic_above_marginal_return": 1,
    "roic_below_growth_magnitude": 1,
    "roic_below_wacc": 1,
    "target_revenue_unreachable": 2,
    "terminal_growth_above_riskfree": 1,
    "terminal_spread_not_positive": 1,
    "two_curves_conflict": 1,
    "wacc_below_negative_one": 1,
    "waypoint_gap_fraction_out_of_range": 1,
}


def _live_site_counts() -> tuple[dict[str, int], list[tuple[str, int, list[str]]]]:
    """Per-code raise-site counts, and any site matching more than one marker."""
    counts: dict[str, int] = {}
    multi: list[tuple[str, int, list[str]]] = []
    for source in _ENGINE_SOURCES:
        readable, _ = _raise_message_fragments(source)
        for line, fragments in readable:
            hits = {code for code, marker in REFUSAL_CODES
                    for fragment in fragments if marker in fragment}
            if len(hits) > 1:
                multi.append((source, line, sorted(hits)))
            for code in hits:
                counts[code] = counts.get(code, 0) + 1
    return counts, multi


def test_each_code_claims_the_number_of_raise_sites_it_is_expected_to():
    """Closes the escape the structural test cannot see on its own.

    That test catches an engine message matched by NO row. It cannot catch one
    matched by the WRONG row: a new raise whose message happens to contain an
    existing marker is absorbed silently, and since /simulate counts refusals BY
    GROUP, a mis-grouped site corrupts the very number this table produces. That
    is what the old bare-token `ramp_start_year` row did to five distinct guards.

    Counting sites per code catches it -- absorption moves a count 1 -> 2 -- and
    unlike a code -> {file:line} map it is immune to line drift, so it costs one
    integer edit exactly when someone adds a raise site, which is the moment a
    human should look at the grouping anyway."""
    counts, _ = _live_site_counts()
    assert counts == _EXPECTED_SITE_COUNTS


def test_no_raise_site_matches_two_markers():
    """The ordering test asserts the table's order; this asserts order cannot
    matter. If no message matches two markers, first-match-wins is insurance
    rather than behaviour -- which is what `engine_refusals`'s own comment says,
    and what the docstring on the ordering test used to deny."""
    _, multi = _live_site_counts()
    assert multi == []
