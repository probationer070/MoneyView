# Test Verification SOP

Purpose: establish that a test is trusted only after it has been shown to FAIL
on a deliberately broken implementation. A passing test is not evidence.

This applies to every test, but it is mandatory for the class of test that
asserts on an assembled string, a label, a source, or any other *attribution* —
the class that `apps/api/services/valuation_verdict.py` needed ten review rounds
to get right.

## The Principle

**A test that has only ever been observed passing has not been verified. It has
been observed passing.**

Those are different claims. A test can pass because the code is correct, or
because the test does not actually reach the thing it names. Nothing in a green
run distinguishes the two. The only evidence that separates them is a run in
which the test FAILS for the intended reason, against an implementation broken
on purpose.

This is why the checked-in mutation harness exists
(`tests/api/test_valuation_verdict_mutations.py`): it re-derives that evidence
on every run, instead of relying on someone having checked once and said so.

### Why the control is deliberately author-independent

The operating assumption behind this SOP is that **the competence of whoever
wrote the code — a contributor, or any given model at any given version — is not
observable from inside this repository, and may change without notice.** Model
behavior in particular can shift between releases and between products, and a
session cannot measure its own comprehension; a model that has misread the task
will report success in the same tone as one that has not.

So do not build the gate on the author. Build it on execution:

- A test written by a strong author that fails the mutation matrix is **bad**.
- A test written by a weak author that passes the mutation matrix is **good**.

The matrix does not need to know which case it is looking at, which is exactly
what makes it hold when the answer is unknowable. Reviewing *harder* does not
substitute — the miss recorded in `ERROR-LOG.md` on 2026-09-03 was made and then
missed again on re-reading by the same author; only executing the mutation
exposed it.

## Read First

- The test module you are changing
- `guideline/sop/build-error-resolver.md` (for the `ERROR-LOG.md` record)
- `guideline/sop/code-reviewer.md`

## Process

1. Write the test. Confirm it passes on the pristine source.
2. Write down, in one sentence, the specific defect this test exists to catch.
3. **Reintroduce that defect, in memory**, in the smallest edit that produces
   it. Prefer a defect the code actually shipped once — `ERROR-LOG.md` is the
   catalogue. Read the module's source text, substitute, compile it into a fresh
   `types.ModuleType`, and patch the mutated `build_verdict` (or equivalent) over
   the name the TEST module holds — it imported the function by value, so
   patching the service module's attribute would not be seen.
   `tests/api/test_valuation_verdict_mutations.py` is the worked example.

   Do NOT rewrite the module on disk and restore it afterwards. A crash, a
   Ctrl-C, or an exception between the write and the restore leaves the working
   tree holding a deliberately broken production module, silently — and the
   check that would reveal it is weak (see step 5). If you genuinely cannot
   mutate in memory, say so in the test's docstring and restore in a `finally`.
4. Run the test. It MUST fail, and the failure message MUST name the real cause.
   A test that fails with an unhelpful message is half-verified: it will fire in
   six months at someone who cannot tell what it means. Assert on that message,
   not merely on "it raised" — every test has fixture guards that raise the same
   exception type, and one of those tripping is not evidence of anything.
5. Confirm the test passes again with no mutation applied, and that the source is
   untouched. On this repo use `git diff --ignore-cr-at-eol --stat <file>` and
   expect NO entry for it: `core.autocrlf=true` with no `.gitattributes` means a
   plain `git diff --stat` can hide, or invent, a whole-file difference that is
   only line endings.
6. Record the mutation in the module's mutation harness so steps 3-5 are
   repeatable by someone who was not there.

## Rules

- **Never report a test as verified on the strength of a passing run.** Say
  which mutation it was shown to catch, or say it is unverified. "All tests
  pass" answers a different question than "this test works".
- **A string assertion is not a verification of the number it describes.** If a
  label and the computation it describes are produced by separate code paths, a
  test that reads only the label cannot see them diverge. Assert a computed
  consequence: construct an input the named basis cannot reach, and assert the
  published figure does not move.
- **Derive fixture constants from the module's constants; never mirror their
  current values.** A fixture tuned to today's value of a module constant can
  stop reaching what it probes when that constant changes, and then the test
  passes while asserting nothing -- green, silent, and worthless. Derive the
  value, and assert the precondition that makes the fixture valid, so a changed
  constant fails loudly and names the reason instead of going quiet. Observed
  2026-09-03: `test_the_peer_mean_is_computed_over_the_period_its_clause_names`
  planted its probe at a hardcoded day chosen for a 252-bar window; at 100 bars
  that day fell outside the window the probe had to reach, and the test passed
  having tested nothing. The mutation harness caught it -- which is the layering
  working as intended, and not a reason to rely on it.

- **Mutation anchors are meant to be brittle.** When a mutation's anchor text no
  longer matches the source, that is the harness demanding the tests be
  re-verified against the rewritten code — it is not a broken harness to be
  repaired by loosening the anchor.
- **Do not grade your own work in the same pass that produced it**, and do not
  let a subagent do so either. The author states what was run; a separate step
  judges whether that is sufficient.
- Restore the source after every mutation run. A mutation left applied is a
  false green on everything else.

## When This Is Overkill

Skip the mutation step for a test whose failure mode is already obvious and
whose subject is a pure function with no attribution layer — an arithmetic
identity, a parser round-trip. The cost is real; spend it where a test could
plausibly assert nothing. If you are unsure whether a test can fail, that
uncertainty is the answer: run the mutation.
