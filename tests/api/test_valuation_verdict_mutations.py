"""Mutation harness: proves the Track B property tests in `test_valuation_verdict.py`
actually detect the defects they claim to, instead of merely reading as safe.

`guideline/sop/test-verification.md` states the principle this file exists to
satisfy: "A test that has only ever been observed passing has not been
verified. It has been observed passing." A property test that never sees its
own subject broken is exactly as trustworthy as one that was never run against
the real code at all -- nothing in a green run tells the two apart. This file
re-derives that evidence on every pytest invocation, rather than relying on a
one-off manual run someone reported and nobody can re-check.

HOW A MUTATION IS APPLIED -- and why not on disk:

The obvious way to mutate a module is to rewrite it, run the tests, and write
it back. Do not: an interrupted run (a crash, a Ctrl-C, an exception between
the write and the restore) leaves the working tree holding a deliberately
broken production module, silently. This harness never writes to
`apps/api/services/valuation_verdict.py`. Instead, for each mutation it:

  1. reads the CURRENT on-disk source text of `valuation_verdict.py` fresh
     (`inspect.getsource`, which re-reads the file rather than trusting a
     stale cache);
  2. applies the mutation as a plain string substitution to that text, in
     memory;
  3. compiles and executes the mutated text into a brand-new `types.ModuleType`
     -- the mutated source's own `import` statements resolve normally, since
     nothing about module resolution changed, only the text of this one file;
  4. monkeypatches the mutated module's `build_verdict` over the *test
     module's* `build_verdict` name (`tests.api.test_valuation_verdict`
     imported it by value with `from ... import build_verdict`, so patching
     `apps.api.services.valuation_verdict.build_verdict` would not be seen by
     the property tests -- they already hold their own reference to the
     pristine function).

Nothing here ever opens `valuation_verdict.py` for writing -- greppable, and
the reason the checks below can be trusted to describe the real module. The
anchor-integrity test at the bottom asserts the mutations still describe the
current source.

Each mutation is also matched against the MESSAGE its property test produces,
not merely against "an AssertionError happened": every property test opens with
a fixture guard (`assert control is not None`, `assert source`,
`assert row["reason"] is None`), and a guard firing for an unrelated reason
would otherwise register as "the mutation was caught" and quietly hollow out
this whole file.
"""

from __future__ import annotations

import inspect
import types

import pytest

from apps.api.services import valuation_verdict as _valuation_verdict_module
from tests.api import test_valuation_verdict as tvv

# --- the mutations ------------------------------------------------------------
#
# Each is (anchor, replacement): `anchor` must appear in the pristine source
# exactly once (checked below, every run) and is replaced with `replacement`.
# Each reintroduces a defect of a class this module has actually shipped; the
# comment on each says which.

# Shared anchor: the block that states the window's calendar span, used by two
# mutations below in different ways.
_WINDOW_SPAN_ANCHOR = '''        span = dated_closes[-len(window):]
        source = f"{source} (window spans {span[0][0]} to {span[-1][0]})"
        source = (
            f"{source}, {len(dated_closes)} of {len(bars_total)} stored bars have a close"
        )
'''

MUTATIONS: dict[str, tuple[str, str]] = {
    # The shipped ND-9 defect (named in
    # test_every_parenthetical_attaches_to_the_clause_it_describes's own
    # docstring): an UNLABELLED span, emitted AFTER the stored-bars clause
    # instead of directly after the window clause it actually describes, so it
    # attaches by position to the wrong noun. Shipped shape: "550 of 800 stored
    # bars have a close (spans 2024-10-25 to 2026-03-09)" -- 550 daily bars
    # across 500 days.
    "bare-span-wrong-noun": (
        _WINDOW_SPAN_ANCHOR,
        '''        source = (
            f"{source}, {len(dated_closes)} of {len(bars_total)} stored bars have a close"
        )
        span = dated_closes[-len(window):]
        source = f"{source} (spans {span[0][0]} to {span[-1][0]})"
''',
    ),
    # A labelled span that correctly names "window", but whose dates cannot
    # hold the count the window clause itself claims (10 days for a 252-bar
    # count). Not a separately dated ERROR-LOG entry -- this is a synthetic
    # construction of the same class B1 exists to catch (a count and the span
    # attached to it disagreeing), approached from the opposite direction of
    # bare-span-wrong-noun: here the label is correct and the arithmetic is
    # wrong, there the arithmetic was fine and the label was misplaced.
    "span-too-short-for-its-count": (
        _WINDOW_SPAN_ANCHOR,
        '''        span = dated_closes[-10:]
        source = f"{source} (window spans {span[0][0]} to {span[-1][0]})"
        source = (
            f"{source}, {len(dated_closes)} of {len(bars_total)} stored bars have a close"
        )
''',
    ),
    # ND-12, "the original defect" per
    # test_a_peer_spike_outside_the_subject_window_cannot_enter_the_mean's
    # docstring: peers sampled over their OWN last 252 NULL-filtered
    # POSITIONS instead of the subject's date range. A sparse peer's 252
    # positions can span years the subject's window never touches, and the
    # resulting mean names no shared period with the subject at all.
    "peers-on-their-own-positions": (
        '''        for peer in peers:
            in_range = [
                close
                for date, close in _dated_closes_from_bars(bars_loader(peer))
                if start <= date <= end
            ]
            if len(in_range) < minimum_peer_closes or max(in_range) <= 0:
                continue
            peer_pcts.append(drawdown_from_peak(in_range)[0])''',
        '''        for peer in peers:
            in_range = _closes_from_bars(bars_loader(peer))[-_DRAWDOWN_BARS:]
            if len(in_range) < minimum_peer_closes or max(in_range) <= 0:
                continue
            peer_pcts.append(drawdown_from_peak(in_range)[0])''',
    ),
    # Drops the peer clause's period entirely rather than naming the wrong
    # one. No specific ERROR-LOG entry for this exact shape -- it is a
    # synthetic variant of the B2 basis-symmetry class (subject and peer
    # clauses must name one shared basis), covering "names none" as distinct
    # from "names a different one" (the next mutation).
    "peer-clause-drops-the-period": (
        'f"peers: {len(peer_pcts)} of {len(peers)} within {start}..{end}"',
        'f"peers: {len(peer_pcts)} of {len(peers)} stored"',
    ),
    # The peer clause names a period that is not the subject's window: the
    # full stored history instead of the 252-bar window actually measured.
    # Also not separately dated in ERROR-LOG -- a synthetic construction of
    # the same cross-basis class ND-12 belongs to, applied to the label/range
    # used for peer sampling rather than to the sampling rule itself.
    "peer-clause-names-a-different-period": (
        "        window_span = dated_closes[-len(window):]",
        "        window_span = dated_closes",
    ),
    # The `252d` defect named in
    # test_the_peer_clause_names_the_same_basis_as_the_subject_clause's own
    # docstring as one of the two real cross-basis defects found: "a `252d`
    # label sat on a window spanning 502 days -- a count of bars wearing the
    # unit of days." A bar COUNT (a NULL-filtered position count) is not a day
    # count, and labelling it as one is false the moment any close was
    # dropped.
    "bar-count-labelled-in-days": (
        'source = f"own window: last {len(window)} of {len(closes)} bars"',
        'source = f"own window: last {len(window)}d of {len(closes)} bars"',
    ),
    # The stale-price clause claims it priced against the NEWEST bar when the
    # newest bar's close is NULL and it actually priced against an older one --
    # the same unearned attribution, on the one clause of the sentence that
    # carries dates without parentheses.
    "stale-price-names-the-wrong-date": (
        'f"price as of {latest_close_date}, latest bar {latest_bar_date}"',
        'f"price as of {latest_bar_date}, latest bar {latest_bar_date}"',
    ),
    # Track A2: reading Basic EPS instead of Diluted. More shares outstanding
    # means a LOWER diluted EPS than basic, hence a HIGHER price/EPS -- the
    # conservative direction for a panel testing undervaluation (DIRECTION,
    # above). Basic is anti-conservative, which is exactly why `_EPS_LABELS`
    # carries only "Diluted EPS" with no fallback.
    "eps-label-reads-basic-not-diluted": (
        '_EPS_LABELS = ("Diluted EPS",)',
        '_EPS_LABELS = ("Basic EPS",)',
    ),
    # Track A2: the trailing-PE row's `source` drops its own `own PE:` clause
    # on the computed branch, leaving only the Damodaran half of the sentence.
    # ND-A, the defect class the drawdown row's `own window: ...; peers: ...`
    # shape exists to prevent: a row naming only what it was compared against
    # leaves its own number unattributed.
    "pe-row-drops-its-own-clause": (
        'f"own PE: {eps_label} {eps:.2f} for FY{period_end}, "',
        'f"{eps_label} {eps:.2f} for FY{period_end}, "',
    ),
}

# The four property tests these mutations are checked against. The fourth is
# the older, narrower span test -- included only in the pristine control
# below, per the task: it is not part of the mutation matrix.
_PROPERTY_TESTS = (
    "test_every_parenthetical_attaches_to_the_clause_it_describes",
    "test_the_peer_clause_names_the_same_basis_as_the_subject_clause",
    "test_the_peer_mean_is_computed_over_the_period_its_clause_names",
    "test_the_stale_price_clause_names_the_dates_it_actually_priced_against",
)
_ALL_PROPERTY_TESTS_FOR_CONTROL = _PROPERTY_TESTS + (
    "test_no_source_string_ever_claims_more_bars_than_its_span_can_hold",
)

# (mutation, property test, expected message fragment) triples that MUST fail.
#
# The fragment is not decoration. Without it the assertion under test is only
# "some AssertionError was raised", and every property test opens with a fixture
# guard that also raises AssertionError -- so a guard tripping for an unrelated
# reason (a peer set that stopped resolving, a refused row) would read as "the
# mutation was caught" and this file would certify a guarantee it had stopped
# checking. That is the same wearing-an-unearned-attribution defect the property
# tests themselves exist to close, so it is closed here too. Each fragment names
# the SPECIFIC diagnosis that mutation should provoke.
_MATRIX = [
    (
        "bare-span-wrong-noun",
        "test_every_parenthetical_attaches_to_the_clause_it_describes",
        "states dates without naming the clause they belong to",
    ),
    (
        "span-too-short-for-its-count",
        "test_every_parenthetical_attaches_to_the_clause_it_describes",
        "the window clause claims",
    ),
    (
        "span-too-short-for-its-count",
        "test_the_peer_clause_names_the_same_basis_as_the_subject_clause",
        "the window clause and the peer clause name different periods",
    ),
    (
        "peers-on-their-own-positions",
        "test_the_peer_mean_is_computed_over_the_period_its_clause_names",
        "a peer spike after the subject's window moved the published peer mean",
    ),
    (
        "peer-clause-drops-the-period",
        "test_the_peer_clause_names_the_same_basis_as_the_subject_clause",
        "the peer clause names no period",
    ),
    (
        "peer-clause-names-a-different-period",
        "test_the_peer_mean_is_computed_over_the_period_its_clause_names",
        "a peer spike before the subject's window moved the published peer mean",
    ),
    (
        "peer-clause-names-a-different-period",
        "test_the_peer_clause_names_the_same_basis_as_the_subject_clause",
        "peers were compared over",
    ),
    (
        "bar-count-labelled-in-days",
        "test_every_parenthetical_attaches_to_the_clause_it_describes",
        "does not follow the window clause it describes",
    ),
    (
        "bar-count-labelled-in-days",
        "test_the_peer_clause_names_the_same_basis_as_the_subject_clause",
        "the subject named no window",
    ),
    (
        "stale-price-names-the-wrong-date",
        "test_the_stale_price_clause_names_the_dates_it_actually_priced_against",
        "but the newest usable close is",
    ),
    (
        "eps-label-reads-basic-not-diluted",
        "test_diluted_eps_is_preferred_over_basic_even_though_both_are_present",
        "used an EPS other than the diluted 7.46",
    ),
    (
        "pe-row-drops-its-own-clause",
        "test_the_pe_row_computes_from_diluted_eps_and_names_both_bases",
        "own PE: Diluted EPS 7.46",
    ),
]


def _pristine_source() -> str:
    """The on-disk text of valuation_verdict.py, re-read every call.

    `inspect.getsource` reads the file named by the module's `__file__`, so
    this reflects whatever is actually checked in right now -- exactly what
    the anchor-integrity test needs, and exactly what must never be written to.
    """
    return inspect.getsource(_valuation_verdict_module)


def _build_mutated_module(source_text: str) -> types.ModuleType:
    """Compile mutated source text into a fresh module object, in memory only.

    `mod.__file__` is set to the real path so tracebacks point somewhere real;
    nothing is ever written through it. The mutated text's own `import`
    statements resolve through the normal import system, since only the text
    of this one module changed.
    """
    path = _valuation_verdict_module.__file__
    mod = types.ModuleType("valuation_verdict_mutation_under_test")
    mod.__file__ = path
    exec(compile(source_text, path, "exec"), mod.__dict__)
    return mod


def _apply_mutation(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    """Rebuild valuation_verdict.py in memory with `name`'s defect reintroduced,
    and monkeypatch it over test_valuation_verdict's OWN `build_verdict` name.

    Patching `apps.api.services.valuation_verdict.build_verdict` would not be
    enough: `test_valuation_verdict.py` did `from ... import build_verdict`,
    binding its own module-level name to the pristine function object at
    import time. The property tests call that bare name, so the patch has to
    land on `tvv.build_verdict`, not on the service module's attribute.
    """
    anchor, replacement = MUTATIONS[name]
    text = _pristine_source()
    count = text.count(anchor)
    assert count == 1, (
        f"anchor for mutation {name!r} matched {count} times in the current "
        f"source, expected exactly 1 -- see "
        f"test_every_mutation_anchor_appears_exactly_once_in_the_current_source"
    )
    mutated_text = text.replace(anchor, replacement)
    mutated_module = _build_mutated_module(mutated_text)
    monkeypatch.setattr(tvv, "build_verdict", mutated_module.build_verdict)


@pytest.mark.parametrize(
    "mutation_name, test_name, expected_fragment",
    _MATRIX,
    ids=[f"{m}--breaks--{t}" for m, t, _ in _MATRIX],
)
def test_mutation_breaks_the_property_test_that_should_catch_it(
    mutation_name, test_name, expected_fragment, monkeypatch
):
    """Each row of the mutation matrix, as its own case.

    A failure here names exactly which (mutation, guarantee) pair broke,
    rather than reporting "the harness failed" -- the whole reason this is
    parametrised per-pair instead of asserted as one big loop.

    The message check is the second half of the guarantee: it is not enough
    that the property test failed, it must have failed FOR THIS REASON. See
    `_MATRIX` for why, and `guideline/sop/test-verification.md` step 4.
    """
    _apply_mutation(monkeypatch, mutation_name)
    target_test = getattr(tvv, test_name)
    with pytest.raises(AssertionError) as excinfo:
        target_test()
    assert expected_fragment in str(excinfo.value), (
        f"{test_name} did fail under {mutation_name!r}, but not for the reason "
        f"this matrix claims: expected a message containing "
        f"{expected_fragment!r}. A fixture guard tripping for an unrelated "
        f"reason also raises AssertionError, and would otherwise pass here "
        f"while proving nothing. Actual message:\n{excinfo.value}"
    )


@pytest.mark.parametrize("test_name", _ALL_PROPERTY_TESTS_FOR_CONTROL)
def test_the_property_tests_pass_on_pristine_source(test_name):
    """The pristine control.

    Without this, the matrix above could "pass" for the wrong reason: if a
    property test were broken in some way unrelated to these mutations (e.g.
    it raised on the pristine source for an unrelated reason), it would also
    raise AssertionError under every mutation and every matrix case would look
    like a catch. This proves each property test is green with nothing broken,
    so the matrix's failures are attributable to the mutations and not to the
    tests being broken some other way. Includes the fourth, narrower span
    test, which the matrix itself does not exercise.
    """
    getattr(tvv, test_name)()


def test_every_mutation_anchor_appears_exactly_once_in_the_current_source():
    """Anchor integrity: every mutation's anchor text must appear exactly once
    in the CURRENT source of valuation_verdict.py.

    This is deliberately brittle. If it fails, that means
    valuation_verdict.py has been rewritten since these anchors were written,
    and it is telling you two things, in order:

      1. The four property tests in test_valuation_verdict.py must be
         RE-VERIFIED BY HAND against the new code -- re-derive, for each one,
         whether it can still fail for the reason its docstring claims. Do not
         assume a rewrite left them meaningful.
      2. Only after that: update this file's anchor and replacement strings to
         match the rewritten source, and re-run the whole file to confirm the
         matrix still catches what it claims to.

    Do NOT "fix" this failure by loosening or removing an anchor to make it
    match again. A looser anchor that matches multiple times, or a
    stringwise-different anchor patched to match, defeats the one thing this
    harness is for: proving a SPECIFIC known-correct mutation still breaks a
    SPECIFIC property test. The brittleness is the point.
    """
    text = _pristine_source()
    for name, (anchor, _replacement) in MUTATIONS.items():
        count = text.count(anchor)
        assert count == 1, (
            f"mutation {name!r}'s anchor matched {count} times in the current "
            f"valuation_verdict.py (expected exactly 1). valuation_verdict.py "
            f"has been rewritten since this harness's anchors were written. "
            f"This is NOT a broken test to fix by loosening the anchor: it "
            f"means the four property tests in test_valuation_verdict.py must "
            f"be re-verified by hand against the new code, and then this "
            f"mutation's anchor and replacement strings in "
            f"test_valuation_verdict_mutations.py must be updated to match. "
            f"See guideline/sop/test-verification.md, 'Mutation anchors are "
            f"meant to be brittle.'"
        )
