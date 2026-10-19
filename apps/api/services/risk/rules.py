"""Loader for risk/rules.yaml: strict validation plus a content-hash version.

Theme-id and FRED-series checks live here because core_finance must not import apps.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError

from apps.api.services.risk.constants import RISK_FRED_SERIES
from apps.api.services.watchlist_themes import theme_ids
from packages.core_finance.risk_signals.config import RiskRules

RULES_PATH = Path(__file__).with_name("rules.yaml")


@dataclass(frozen=True)
class LoadedRules:
    rules: RiskRules
    version: str


def _series_in(rules: RiskRules) -> list[tuple[str, str]]:
    return [
        ("w1.series", rules.w1.series),
        ("w1.proxy.series", rules.w1.proxy.series),
        ("w2.series", rules.w2.series),
        ("w3.series", rules.w3.series),
        ("w4.series", rules.w4.series),
        ("w5.cpi_series", rules.w5.cpi_series),
        ("w5.pce_series", rules.w5.pce_series),
    ]


def load_rules(path: Path | None = None) -> LoadedRules:
    raw = (path or RULES_PATH).read_bytes()
    # Hash the LF form so a CRLF checkout (core.autocrlf) yields the same version.
    normalized = raw.replace(b"\r\n", b"\n")
    try:
        rules = RiskRules.model_validate(yaml.safe_load(normalized))
    except ValidationError as exc:
        raise ValueError(f"invalid risk rules: {exc}") from exc
    known_themes = theme_ids()
    for key in ("semis_themes", "excluded_themes"):
        unknown = [t for t in getattr(rules, key) if t not in known_themes]
        if unknown:
            raise ValueError(f"{key}: unknown theme ids {unknown}")
    for key, series in _series_in(rules):
        if series not in RISK_FRED_SERIES:
            raise ValueError(f"{key}: unknown FRED series {series!r}")
    return LoadedRules(rules, hashlib.sha256(normalized).hexdigest()[:8])


_current: LoadedRules | None = None


def reload_rules() -> LoadedRules:
    global _current
    _current = load_rules()
    return _current


def get_rules() -> LoadedRules:
    return _current or reload_rules()
