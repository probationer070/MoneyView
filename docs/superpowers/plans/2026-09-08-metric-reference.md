# The Metric Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `docs/metrics/` — seven family files documenting every reported metric that carries material interpretive ambiguity, each entry citing the implementation it describes.

**Architecture:** A discovery task first turns the spec's candidate list into a source-backed inventory. A parser/checker is built next, so every family file is verified as it lands rather than retrofitted. Then the families are written, smallest first, with the two highest-misreading-risk families done early. Nothing in this plan changes application behaviour.

**Tech Stack:** Markdown. One Python script (`scripts/check_metric_docs.py`) with a pytest test. Python 3.11, stdlib only — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-metric-reference-design.md`

## Global Constraints

- **This is a documentation deliverable. No application code changes.** Spec §8: "If writing an entry reveals a defect, the entry records it and the fix is its own work." Discovering a bug is a finding to report, never a licence to edit `apps/` or `packages/`.
- **The 50 entries in the spec are a CANDIDATE inventory, not an assertion that all 50 exist as distinct implementation sites.** Confirm the enumeration against source before writing any entry.
- **Do not expand scope during discovery.** A genuinely new candidate found while confirming goes on a separate follow-up list, not into this plan's inventory.
- **Every entry carries all eight fields** (spec §3). An entry missing one is incomplete, not merely terse.
- **`How it is calculated here` describes the implementation, not the textbook** — sign convention, denominator, annualisation, fallback logic, guards. Where the two differ, document the implementation and flag the divergence.
- **`Common misreading` is required, not implied**, and must be a misreading a person could actually have.
- **No formula without a `file:line` citation. No coverage figure that was not measured.**
- **`docs/metrics/` does not exist yet** (verified 2026-09-08); every file in it is new.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/metrics/inventory.md` | The source-backed confirmation of the 50 candidates. Task 1's deliverable; the input to every later task. |
| `scripts/check_metric_docs.py` | Parses `docs/metrics/*.md`, verifies every `Source:` citation resolves, every named symbol is defined in the cited file, and every entry carries all eight fields. |
| `tests/scripts/test_check_metric_docs.py` | Tests the checker, including that it FAILS on a bad citation. |
| `docs/metrics/README.md` | Index of the seven families and the entry template. |
| `docs/metrics/price-signals.md` | 5 entries |
| `docs/metrics/attribution-and-uncertainty.md` | 7 entries |
| `docs/metrics/verdict-panel.md` | 6 entries |
| `docs/metrics/discount-rates-and-returns.md` | 11 entries |
| `docs/metrics/fundamental-quality.md` | 7 entries |
| `docs/metrics/dcf-mechanics.md` | 9 entries |
| `docs/metrics/industry-benchmarks.md` | 5 entries |
| `docs/INDEX.md` | One row (modify). |

**Deliberate deviation from the agreed order, with its reason.** The agreed sequence put the mechanical checks fourth, after the entries. This plan builds them second, before any entry is written. Writing 50 entries and then discovering the citation format is unparseable means retrofitting 50 entries; building the checker first means each family is verified as it lands. The checker's own test is what proves it works. If you disagree, Tasks 2 and 3–6 can be swapped without touching their content.

---

## The entry format

Every entry in every family file uses exactly this shape. The checker parses it,
so the field names and the `Source:` line are load-bearing, not decoration.

```markdown
### `metric_name`

Source: `packages/core_finance/price_signals.py:19` — `drawdown_from_peak`

**What it is.** One sentence a non-specialist can hold.

**Why this metric.** What it answers that a neighbouring metric does not.

**How it is calculated here.** The implementation's semantics: sign convention,
denominator and window, annualisation, fallback, guards.

**What it affects.** What downstream consumes it.

**Where it is shown.** Endpoint and screen, or "HTTP-only, no UI".

**How to read it.** Unit, direction and sign, and the reading NOT to make.

**Common misreading.** The plausible wrong reading, stated as a wrong reading.

**Current state (YYYY-MM-DD).** What it does today; what it refuses and why.
```

---

### Task 1: Confirm the enumeration against source

**Files:**
- Create: `docs/metrics/inventory.md`

**Interfaces:**
- Consumes: the candidate list in `docs/superpowers/specs/2026-09-08-metric-reference-design.md` §2.
- Produces: `docs/metrics/inventory.md`, a table every later task reads to know what to write and where the implementation lives.

**Confirm the enumeration against source before writing any documentation. The
50 entries in the spec are the candidate inventory, not an assertion that all 50
currently exist as distinct implementation sites.**

- [ ] **Step 1: Read the candidate list**

Read §2 of the spec. It names seven families and their counts: `price-signals` 5,
`discount-rates-and-returns` 11, `fundamental-quality` 7, `dcf-mechanics` 9,
`verdict-panel` 6, `industry-benchmarks` 5, `attribution-and-uncertainty` 7.

The specific candidates are the public functions and reported fields in:
`packages/core_finance/` (`price_signals.py`, `expected_return.py`,
`hurdle_rate.py`, `beta.py`, `corporate_statement_metrics.py`, `dcf.py`,
`segment_valuation.py`, `industry_benchmark.py`, `risk_analysis.py`,
`shapley.py`, `rank_correlation.py`, `distributions.py`), plus
`apps/api/services/valuation_verdict.py`, `apps/api/services/case_diff.py`,
`apps/api/services/case_simulate.py`, and the reported fields in
`apps/api/models/schema_parts/decision.py`.

- [ ] **Step 2: Locate each candidate in source**

For each candidate, find the actual implementation and record:

- the file and line where it is computed
- whether it is a **distinct** interpretive ambiguity, a **duplicate** of another
  candidate, or **not present** in the current implementation

Use `grep -n "^def <name>" <file>` for functions and
`grep -rn "<field_name>" apps/api/services/` for reported fields.

- [ ] **Step 3: Confirm the three classes the narrow test would miss**

These need confirming explicitly, because a formula-shaped search finds nothing
for them and would wrongly conclude they need no entry:

| Class | Candidates to confirm | Where to look |
| --- | --- | --- |
| Thresholds | `three_p`, `REFUSED_FRACTION_CAP`, `SHAPLEY_INPUT_CAP` | `apps/api/services/case_fork.py`, `case_simulate.py`, `case_diff.py` |
| Normalisations | `volume_ratio`, benchmark `fade` | `packages/core_finance/price_signals.py`, `industry_benchmark.py` |
| Association measures | Spearman `association` | `packages/core_finance/rank_correlation.py` |

For each, record what the threshold/normalisation/measure **does operationally** —
not a formula, because there isn't one to find.

- [ ] **Step 4: Write the inventory**

Create `docs/metrics/inventory.md`:

```markdown
# Metric Reference — Source Inventory

Confirmed <DATE> against the working tree. This table is the authority for what
gets an entry. The spec's 50 were candidates; this is what the code actually has.

| Metric | Family | Source | Status |
| --- | --- | --- | --- |
| `drawdown` | price-signals | `packages/core_finance/price_signals.py:19` `drawdown_from_peak` | distinct |
| ... | ... | ... | ... |

## Dropped candidates

| Candidate | Why |
| --- | --- |
| ... | duplicate of `<other>` / not present in the implementation |

## Follow-up candidates (NOT in this plan's scope)

Genuinely new metrics found while confirming, recorded rather than absorbed.

| Candidate | Source | Why it may deserve an entry |
| --- | --- | --- |
```

- [ ] **Step 5: Report the delta**

State plainly in your report: how many of the 50 were confirmed distinct, how
many were duplicates, how many were absent, and how many follow-up candidates you
found and did **not** add. A count identical to 50 is a suspicious result, not a
clean one — say so if you get it.

- [ ] **Step 6: Commit**

```bash
git add docs/metrics/inventory.md
git commit -m "docs: confirm the metric inventory against source"
```

---

### Task 2: The citation checker

**Files:**
- Create: `scripts/check_metric_docs.py`
- Test: `tests/scripts/test_check_metric_docs.py`

**Interfaces:**
- Consumes: nothing from Task 1 (it reads whatever `docs/metrics/*.md` exist).
- Produces: `check_metric_docs(docs_dir: Path, repo_root: Path) -> list[str]` returning a list of human-readable problems, empty when clean. A `main()` that prints them and exits 1 if any.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/test_check_metric_docs.py`:

```python
from pathlib import Path

import pytest

from scripts.check_metric_docs import check_metric_docs

# The eight field labels as LITERALS, deliberately not imported from the module
# under test: comparing the checker's output against the same constant it
# iterates is tautological -- drop a field from the constant and both sides drop
# it together, so the assertion could never fail for the defect it is named
# after. `tests/scripts/test_reset_snapshots.py` establishes this pattern.
REQUIRED_FIELDS = (
    "What it is",
    "Why this metric",
    "How it is calculated here",
    "What it affects",
    "Where it is shown",
    "How to read it",
    "Common misreading",
    "Current state",
)


def _entry(source_line: str, omit: str = "") -> str:
    fields = "\n\n".join(
        f"**{name}.** text" for name in REQUIRED_FIELDS if name != omit
    )
    return f"### `example`\n\nSource: {source_line}\n\n{fields}\n"


def _write(tmp_path: Path, body: str) -> tuple[Path, Path]:
    repo = tmp_path / "repo"
    (repo / "docs" / "metrics").mkdir(parents=True)
    (repo / "pkg").mkdir()
    (repo / "pkg" / "thing.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    (repo / "docs" / "metrics" / "family.md").write_text(body, encoding="utf-8")
    return repo / "docs" / "metrics", repo


def test_a_clean_entry_reports_no_problems(tmp_path):
    docs, repo = _write(tmp_path, _entry("`pkg/thing.py:2` -- `b`"))
    assert check_metric_docs(docs, repo) == []


def test_a_citation_to_a_missing_file_is_reported(tmp_path):
    docs, repo = _write(tmp_path, _entry("`pkg/gone.py:2` -- `b`"))
    problems = check_metric_docs(docs, repo)
    assert len(problems) == 1
    assert "pkg/gone.py" in problems[0]


def test_a_citation_past_the_end_of_the_file_is_reported(tmp_path):
    """The check that earns the script: a citation resolving to a file but not
    to a line is exactly what a moved function looks like."""
    docs, repo = _write(tmp_path, _entry("`pkg/thing.py:99` -- `b`"))
    problems = check_metric_docs(docs, repo)
    assert len(problems) == 1
    assert "99" in problems[0]


@pytest.mark.parametrize("missing", REQUIRED_FIELDS)
def test_an_entry_missing_any_required_field_is_reported(tmp_path, missing):
    docs, repo = _write(tmp_path, _entry("`pkg/thing.py:2` -- `b`", omit=missing))
    problems = check_metric_docs(docs, repo)
    assert len(problems) == 1
    assert missing in problems[0]


def test_a_source_naming_a_symbol_that_does_not_exist_is_reported(tmp_path):
    """Spec section 7's second check. A citation can resolve to a real file at a
    real line and still document something that has been renamed away -- lines
    move, so `path:line` alone proves nothing about the symbol."""
    docs, repo = _write(tmp_path, _entry("`pkg/thing.py:2` -- `renamed_away`"))
    problems = check_metric_docs(docs, repo)
    assert len(problems) == 1
    assert "renamed_away" in problems[0]


def test_a_source_line_without_a_symbol_is_reported(tmp_path):
    docs, repo = _write(tmp_path, _entry("`pkg/thing.py:2`"))
    problems = check_metric_docs(docs, repo)
    assert len(problems) == 1
    assert "Source" in problems[0]


def test_an_entry_with_no_source_line_is_reported(tmp_path):
    body = "### `example`\n\n" + "\n\n".join(
        f"**{name}.** text" for name in REQUIRED_FIELDS
    )
    docs, repo = _write(tmp_path, body)
    problems = check_metric_docs(docs, repo)
    assert len(problems) == 1
    assert "Source" in problems[0]


def test_the_inventory_file_is_not_treated_as_an_entry_file(tmp_path):
    """inventory.md and README.md are tables and prose, not entries. Checking
    them for the eight fields would report a problem on every run and train the
    reader to ignore the output."""
    docs, repo = _write(tmp_path, _entry("`pkg/thing.py:2` -- `b`"))
    (docs / "inventory.md").write_text("# Inventory\n\n| a | b |\n", encoding="utf-8")
    (docs / "README.md").write_text("# Metrics\n\nprose\n", encoding="utf-8")
    assert check_metric_docs(docs, repo) == []
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/scripts/test_check_metric_docs.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.check_metric_docs'`.

- [ ] **Step 3: Write the checker**

Create `scripts/check_metric_docs.py`:

```python
"""Verify that docs/metrics entries cite code that exists and carry every field.

A reference citing a moved function is the documentation form of the defect this
repository keeps recording: a statement wearing an authority it no longer has.
The check is mechanical because it can be; the judgement of whether a "common
misreading" is one a person could actually have stays with a human reviewer.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_FIELDS = (
    "What it is",
    "Why this metric",
    "How it is calculated here",
    "What it affects",
    "Where it is shown",
    "How to read it",
    "Common misreading",
    "Current state",
)

# Files that are prose or tables rather than entries.
NOT_ENTRY_FILES = {"README.md", "inventory.md"}

_ENTRY = re.compile(r"^### .+?$", re.MULTILINE)
_SOURCE = re.compile(
    r"^Source:\s*`([^`:]+):(\d+)`\s*(?:--|—)\s*`([A-Za-z_][A-Za-z0-9_]*)`",
    re.MULTILINE,
)


def _problems_for_entry(entry: str, heading: str, doc: Path, repo_root: Path) -> list[str]:
    problems: list[str] = []
    where = f"{doc.name} :: {heading}"

    match = _SOURCE.search(entry)
    if match is None:
        problems.append(f"{where}: no `Source:` line")
    else:
        rel, line_text = match.group(1), match.group(2)
        target = repo_root / rel
        if not target.exists():
            problems.append(f"{where}: Source cites {rel}, which does not exist")
        else:
            line = int(line_text)
            body = target.read_text(encoding="utf-8")
            total = len(body.splitlines())
            if not 1 <= line <= total:
                problems.append(
                    f"{where}: Source cites {rel}:{line}, but that file has "
                    f"{total} lines"
                )
            # Spec section 7's SECOND check: the named symbol must exist. A
            # citation resolving to a real file at a real line says nothing
            # about whether the thing being documented is still there -- lines
            # move, and a renamed function leaves the citation valid and the
            # entry wrong.
            symbol = match.group(3)
            defined = re.search(
                rf"^\s*(?:def|class)\s+{re.escape(symbol)}"
                rf"|^\s*{re.escape(symbol)}\s*[:=]",
                body,
                re.MULTILINE,
            )
            if defined is None:
                problems.append(
                    f"{where}: Source names `{symbol}`, which is not defined "
                    f"in {rel}"
                )

    for field in REQUIRED_FIELDS:
        if f"**{field}." not in entry:
            problems.append(f"{where}: missing required field '{field}'")
    return problems


def check_metric_docs(docs_dir: Path, repo_root: Path) -> list[str]:
    """Return a list of problems; empty means clean."""
    problems: list[str] = []
    for doc in sorted(docs_dir.glob("*.md")):
        if doc.name in NOT_ENTRY_FILES:
            continue
        text = doc.read_text(encoding="utf-8")
        starts = [m.start() for m in _ENTRY.finditer(text)]
        headings = [m.group(0).strip() for m in _ENTRY.finditer(text)]
        for index, start in enumerate(starts):
            end = starts[index + 1] if index + 1 < len(starts) else len(text)
            problems.extend(
                _problems_for_entry(text[start:end], headings[index], doc, repo_root)
            )
    return problems


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    problems = check_metric_docs(repo_root / "docs" / "metrics", repo_root)
    for problem in problems:
        print(problem)
    print(f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/scripts/test_check_metric_docs.py -q`
Expected: PASS. Report the count you observe.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_metric_docs.py tests/scripts/test_check_metric_docs.py
git commit -m "test: verify metric-doc citations resolve and entries are complete"
```

- [ ] **Step 6: Mutation — the line-range check**

In `check_metric_docs.py`, change `if not 1 <= line <= total:` to `if False:`.

Run: `python -m pytest tests/scripts/test_check_metric_docs.py -q`
Expected: `test_a_citation_past_the_end_of_the_file_is_reported` FAILS. **Restore.**

- [ ] **Step 7: Mutation — the symbol check**

In `check_metric_docs.py`, change `if defined is None:` to `if False:`.

Run: `python -m pytest tests/scripts/test_check_metric_docs.py -q`
Expected: `test_a_source_naming_a_symbol_that_does_not_exist_is_reported` FAILS.
**Restore.**

- [ ] **Step 8: Mutation — the field check**

Change `if f"**{field}." not in entry:` to `if False:`.

Run: `python -m pytest tests/scripts/test_check_metric_docs.py -q`
Expected: all eight `test_an_entry_missing_any_required_field_is_reported`
parametrizations FAIL. **Restore**, re-run green.

---

### Task 3: The index, the template, and `price-signals`

**Files:**
- Create: `docs/metrics/README.md`, `docs/metrics/price-signals.md`

**Interfaces:**
- Consumes: `docs/metrics/inventory.md` (Task 1); `scripts/check_metric_docs.py` (Task 2).
- Produces: the worked template every later family file copies.

The smallest family goes first so the template is proven on five entries before
it is applied to eleven.

- [ ] **Step 1: Write the README**

Create `docs/metrics/README.md` listing the seven families with their entry
counts and a one-line description each, then the entry template verbatim from
this plan's "The entry format" section, then this paragraph:

```markdown
## What earns an entry

A field earns an entry when it carries **material interpretive ambiguity** --
when a competent reader could form a wrong belief about what the number means.
That is broader than "the calculation had a defensible alternative", which would
drop three classes: thresholds (no competing formula, the question is what the
threshold does), normalisations (uncontroversial formula, contested denominator),
and association measures (trivial to compute, easy to read as a contribution).

Identifiers, names, dates, sources, counts and raw statement passthroughs get no
entry: there is no method to explain.
```

- [ ] **Step 2: Write the five `price-signals` entries**

Create `docs/metrics/price-signals.md` with one entry per confirmed candidate in
that family, using the format exactly. The confirmed sources from Task 1 are
authoritative; if the inventory disagrees with the spec, follow the inventory.

Two entries whose content is already established and must say at least this:

`drawdown` — `packages/core_finance/price_signals.py:19` `drawdown_from_peak`.
The docstring states "Fractional decline from the running peak to the last
close" and "`pct` is `<= 0`". The peak is the maximum over **the window the
caller supplied**, so the choice of "previous peak" belongs to the caller and is
not guessed by the function. **Common misreading:** read as a positive loss
percentage; `-0.094` is a 9.4% decline, not a 9.4% gain and not 0.094%.

`volume_ratio` — `packages/core_finance/price_signals.py:35`. Mean volume over
the last `recent` bars divided by the mean over `baseline` bars; returns `None`
when either window is non-positive, when there are fewer bars than the larger
window, or when the baseline mean is `<= 0`. **Common misreading:** read as a
proportion; `1.195` is `×1.20`, not `+19.5%` and not `119.5%`.

- [ ] **Step 3: Run the checker**

Run: `python scripts/check_metric_docs.py`
Expected: `0 problem(s)`. If it reports any, fix the entry — never the checker.

- [ ] **Step 4: Commit**

```bash
git add docs/metrics/README.md docs/metrics/price-signals.md
git commit -m "docs: metric reference index and price signals"
```

---

### Task 4: `attribution-and-uncertainty` and `verdict-panel`

**Files:**
- Create: `docs/metrics/attribution-and-uncertainty.md` (7), `docs/metrics/verdict-panel.md` (6)

**Interfaces:**
- Consumes: `docs/metrics/inventory.md`; the template in `docs/metrics/README.md`.

These two go early because they carry the highest misreading risk in the set:
they are where a number most easily wears a basis it has not earned.

- [ ] **Step 1: Write `attribution-and-uncertainty.md`**

Content that must appear, because it is established and load-bearing:

- **Shapley contribution** (`packages/core_finance/shapley.py`) — exact and
  order-independent, weight `s!(n-s-1)!/n!`, contributions sum to
  `metric(changed) - metric(base)` so there is no residual row.
  **Common misreading:** read as "the effect of changing this input alone",
  which is the *sequential* answer; Shapley averages over all orderings, and on
  the measured fixture the two differ by half the interaction term.
- **Spearman association** (`packages/core_finance/rank_correlation.py`) —
  monotonic association among **accepted** samples, ties take the average rank,
  `None` for a constant input because that is *not measurable* rather than
  *measured and unrelated*. **Common misreading:** read as a contribution; it is
  unitless and sums to nothing, unlike `/diff`'s per-share contributions.
- **`three_p`** (`apps/api/services/case_fork.py`) — a three-valued epistemic
  label (`possible`/`plausible`/`probable`), **never defaulted**, that gates
  storage: a changed narrated field cannot be persisted without one.
  **Common misreading:** read as a confidence score to be averaged or compared.
- **`REFUSED_FRACTION_CAP`** and **`SHAPLEY_INPUT_CAP`** — thresholds that
  **refuse rather than degrade**. Above the Shapley cap `/diff` refuses; it never
  falls back to a cheaper method, because two responses of identical shape
  computed differently cannot be compared.

- [ ] **Step 2: Write `verdict-panel.md`**

`dcf_gap` is the entry that most needs care. **Common misreading:** read as a
return over a horizon. It is a dimensionless valuation gap with no time dimension
at all, and must never be subtracted from or ranked against an annualised return.

Also record the panel's framing: `direction` is a **fixed constant string**
identical for every ticker, not a computed verdict, and the backend deliberately
computes no rollup across the four rows because they are in four different units.

- [ ] **Step 3: Run the checker and commit**

```bash
python scripts/check_metric_docs.py     # expect 0 problem(s)
git add docs/metrics/attribution-and-uncertainty.md docs/metrics/verdict-panel.md
git commit -m "docs: attribution, uncertainty, and the verdict panel"
```

---

### Task 5: `discount-rates-and-returns` and `fundamental-quality`

**Files:**
- Create: `docs/metrics/discount-rates-and-returns.md` (11), `docs/metrics/fundamental-quality.md` (7)

**Interfaces:**
- Consumes: `docs/metrics/inventory.md`; the template.

- [ ] **Step 1: Write `discount-rates-and-returns.md`**

Sources: `packages/core_finance/expected_return.py` (market expected return, CAPM
expected return, DCF-implied return, expected-return spread),
`packages/core_finance/hurdle_rate.py` (`calculate_crp`, `calculate_wacc`,
`decompose_hurdle_rate`, `wacc_sensitivity`), `packages/core_finance/beta.py`
(`unlever_beta`, `relever_beta`, `bottom_up_beta`).

`ERROR-LOG.md` (2026-08-03) records that `dcf_implied_return` was computed as
`f(price, price)` and pinned at `0.0` for every ticker, propagating into
`stock_expected_return` and `expected_return_spread`. The entries for those three
must state the dependency chain, because it is what made one defect become three
wrong columns.

- [ ] **Step 2: Write `fundamental-quality.md`**

Sources: `packages/core_finance/corporate_statement_metrics.py` — `calculate_nopat`,
`calculate_invested_capital`, `average_invested_capital_result`,
`build_roic_records`, `assess_roic_quality`, `annual_growth_rates`,
`assess_growth_quality`, `stable_tax_result`.

The quality *assessments* are the interpretive risk here: they are judgements
about whether a computed figure is trustworthy, not the figures themselves. Each
entry must say what the assessment rejects and on what grounds.

- [ ] **Step 3: Run the checker and commit**

```bash
python scripts/check_metric_docs.py     # expect 0 problem(s)
git add docs/metrics/discount-rates-and-returns.md docs/metrics/fundamental-quality.md
git commit -m "docs: discount rates, returns, and fundamental quality"
```

---

### Task 6: `dcf-mechanics` and `industry-benchmarks`

**Files:**
- Create: `docs/metrics/dcf-mechanics.md` (9), `docs/metrics/industry-benchmarks.md` (5)

**Interfaces:**
- Consumes: `docs/metrics/inventory.md`; the template.

- [ ] **Step 1: Write `dcf-mechanics.md`**

Sources: `packages/core_finance/dcf.py` (`calculate_fcff`,
`calculate_terminal_value`, `calculate_npv`, `calculate_net_debt`,
`calculate_equity_value`, `calculate_intrinsic_value_per_share`) and
`packages/core_finance/segment_valuation.py` (the segment revenue path,
sales-to-capital reinvestment, `terminal_capital_intensity_change`).

**Link to `docs/dcf-valuation.md` rather than duplicating it.** That document
already explains DCF from first principles; these entries say what THIS
implementation does differently, and where its guards refuse.

- [ ] **Step 2: Write `industry-benchmarks.md`**

Sources: `packages/core_finance/industry_benchmark.py` (`resolve_benchmark`,
`fade`, `screen_row`, `screen_value`, `column_by_key`) plus the conservative case
in `apps/api/services/company_baseline.py`.

`fade` is a normalisation: the formula is uncontroversial and the choice of what
it fades toward, and how fast, is not. The entry must say both.

- [ ] **Step 3: Run the checker and commit**

```bash
python scripts/check_metric_docs.py     # expect 0 problem(s)
git add docs/metrics/dcf-mechanics.md docs/metrics/industry-benchmarks.md
git commit -m "docs: DCF mechanics and industry benchmarks"
```

---

### Task 7: Index the reference and review the misreadings

**Files:**
- Modify: `docs/INDEX.md`

**Interfaces:**
- Consumes: every file from Tasks 1–6.

- [ ] **Step 1: Add the row to `docs/INDEX.md`**

Add one row pointing at `docs/metrics/README.md`, in the same style as the
existing rows.

- [ ] **Step 2: Run the full mechanical check**

Run: `python scripts/check_metric_docs.py`
Expected: `0 problem(s)`.

Run: `python -m pytest tests/scripts/test_check_metric_docs.py -q`
Expected: PASS.

- [ ] **Step 3: The manual interpretive review — deliberately not automated**

Read every `Common misreading` field in every family file and ask of each: **is
this a misreading a person could actually have?**

A field reading "a reader might think this is something else" satisfies the
checker and teaches nothing. A good one names the *specific* other quantity the
metric is mistakable for, as the worked examples do: `dcf_gap` for an annualised
return, `volume_ratio` for a percentage, Spearman association for a Shapley
contribution.

This cannot be scripted, and no attempt should be made to script it. Report how
many fields you rewrote in this pass — zero is a suspicious result.

- [ ] **Step 4: Report the final counts**

State: entries written per family, total, how many differ from the spec's
candidate 50, and the follow-up candidates recorded in `inventory.md` that this
plan deliberately did not absorb.

- [ ] **Step 5: Commit**

```bash
git add docs/INDEX.md docs/metrics/
git commit -m "docs: index the metric reference"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §2 inclusion rule, three classes | Task 1 Step 3 confirms all three explicitly; Task 3 Step 1 states the rule in the README |
| §2 the candidate list is not truth | Task 1, whose whole deliverable is the confirmation |
| §3 the eight-field template | Task 2's checker enforces presence; Task 3 establishes it in prose |
| §3.3 implementation semantics, not textbook | Global Constraints; called out per family in Tasks 3–6 |
| §3.7 common misreading required | Checker enforces the field exists; Task 7 Step 3 judges whether it is real |
| §4 the unit rule | Task 3 (`drawdown`, `volume_ratio`), Task 4 (`dcf_gap`) |
| §5 structure | File Structure table; one task per family pair |
| §6 what the reference will not do | Task 6 Step 1 links to `docs/dcf-valuation.md` rather than duplicating |
| §7 two mechanical checks (citation resolves; symbol exists) | Task 2, both mutation-verified in Steps 6–8 |
| §7 the third check stays manual | Task 7 Step 3, with an explicit instruction not to script it |
| §8 out of scope | Global Constraints: no application code changes |

**Type consistency:** `check_metric_docs(docs_dir: Path, repo_root: Path) -> list[str]`
is defined in Task 2 and called with exactly that signature in its own tests and
in `main()`. `REQUIRED_FIELDS` is defined once in the script and deliberately
re-stated as literals in the test, following `tests/scripts/test_reset_snapshots.py`.

**One deviation from the agreed order, stated in File Structure:** the mechanical
checks are built second rather than fourth, so each family file is verified as it
lands. Tasks 2 and 3–6 can be swapped without changing their content if you
prefer the original order.

**A gap this self-review caught and closed.** The first draft implemented only
spec §7's first check — that a citation resolves — and wrote the second up as a
"known limitation", while the coverage table above claimed both were done. That
is the failure this plan exists to prevent, occurring in the plan itself. The
`Source:` line already carries the symbol name, so the second check is
implementable rather than a limitation, and Task 2 now implements it: a citation
that resolves to a real file at a real line but names a symbol that is not
defined there is reported. Mutation-verified in Task 2 Step 7.

**The limitation that genuinely remains:** the symbol check confirms the symbol
is defined *somewhere in the cited file*, not that it is defined at the cited
line. Pinning the line exactly would make every entry break on any edit above it,
which is the same brittleness that made a `code -> {file:line}` map the wrong
trade for the refusal-code table. The line number is a reading aid; the file and
symbol are the assertion.
