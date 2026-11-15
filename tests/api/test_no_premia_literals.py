"""No rf / ERP / CRP literal outside the seed (plan 2026-11-16 S2a).

The premia live in `market_assumptions`; a constant in a service is a second source that drifts.
`scan()` takes the files so tests/api/test_statement_metrics_assumptions_mutations.py can plant a literal
in memory and require the guard to name the file.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN_DIRS = ("apps/api", "packages/core_finance")
FORBIDDEN_NUMBERS = (0.042, 0.055)
FORBIDDEN_NAMES = ("DEFAULT_RISK_FREE_RATE", "DEFAULT_EQUITY_RISK_PREMIUM", "KOREA_COUNTRY_RISK_PREMIUM")
# The seed, plus entries that are not premia.
ALLOWED = {
    "apps/api/services/db.py": "the seed",
    "apps/api/services/valuation_seed.py": "the seed",
    "apps/api/routes/monte_carlo.py": "0.055 is one expected-return sample, not a premium",
}


def _python_files():
    for directory in SCAN_DIRS:
        yield from (ROOT / directory).rglob("*.py")


def scan(sources: dict[str, str]) -> list[str]:
    """`path -> source` in, one 'path:line what' string per forbidden literal or name out."""
    hits = []
    for path, source in sources.items():
        if path in ALLOWED:
            continue
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Constant) and isinstance(node.value, float) and node.value in FORBIDDEN_NUMBERS:
                hits.append(f"{path}:{node.lineno} literal {node.value}")
            names = []
            if isinstance(node, ast.Name):
                names.append(node.id)
            elif isinstance(node, ast.Attribute):
                names.append(node.attr)
            elif isinstance(node, ast.alias):
                names.append(node.name)
            elif isinstance(node, ast.arg):
                names.append(node.arg)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.append(node.name)
            hits.extend(f"{path}:{getattr(node, 'lineno', 0)} name {n}" for n in names if n in FORBIDDEN_NAMES)
    return hits


def current_sources() -> dict[str, str]:
    return {p.relative_to(ROOT).as_posix(): p.read_text(encoding="utf-8") for p in _python_files()}


def test_no_premia_literals_outside_the_seed():
    assert scan(current_sources()) == []
