import pathlib
import re

import pytest

from packages.core_finance.refusals import ENGINE_REFUSAL_CODES

# The reader's sentence for each engine refusal lives in `valuation.refusal` of the
# message catalogs. A code without an entry falls back to the English backend text in
# Korean mode, so every engine code needs a key in both catalogs.
_MESSAGES = pathlib.Path(__file__).resolve().parents[2] / "apps" / "web" / "lib" / "i18n" / "messages"


def _refusal_keys(catalog: str) -> set[str]:
    """The keys of `valuation.refusal` in a message catalog, read from the TypeScript source."""
    lines = (_MESSAGES / catalog).read_text(encoding="utf-8").splitlines()
    start = lines.index("  valuation: {")
    open_line = next(i for i in range(start, len(lines)) if lines[i] == "    refusal: {")
    close_line = next(i for i in range(open_line + 1, len(lines)) if lines[i] == "    },")
    return {
        match.group(1)
        for line in lines[open_line + 1:close_line]
        if (match := re.match(r'^      ([a-z_]+): "', line))
    }


@pytest.mark.parametrize("catalog", ["en.ts", "ko.ts"])
def test_every_engine_refusal_code_has_a_reader_sentence(catalog):
    """Each code in ENGINE_REFUSAL_CODES has a `valuation.refusal.<code>` entry in the catalog."""
    missing = sorted(ENGINE_REFUSAL_CODES - _refusal_keys(catalog))
    assert missing == [], f"{catalog} has no valuation.refusal entry for: {missing}"
