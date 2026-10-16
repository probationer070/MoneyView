import json
from datetime import date
from pathlib import Path

import pytest

from apps.api.services.webscrap.Collector.FREDCollector import FredFetchError, parse_observations
from packages.core_finance.macro_signals.rules import Observation

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "fred"
AS_OF = date(2026, 10, 10)   # Saturday, ISO 2026-W41


@pytest.fixture
def fixture_source():
    def make(missing=frozenset()):
        def source(series_id: str, start: date) -> list[Observation]:
            path = FIXTURES / f"{series_id}.json"
            if series_id in missing or not path.exists():
                raise FredFetchError(f"{series_id}: fixture missing")
            rows = parse_observations(json.loads(path.read_text(encoding="utf-8")))
            return [Observation(date.fromisoformat(d), v) for d, v in rows if date.fromisoformat(d) >= start]
        return source
    return make
