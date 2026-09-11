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
                rf"^\s*(?:def|class)\s+{re.escape(symbol)}\b"
                rf"|^\s*{re.escape(symbol)}\s*[:=](?!=)",
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
