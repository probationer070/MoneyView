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
