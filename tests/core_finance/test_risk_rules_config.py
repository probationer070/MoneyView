import re
from pathlib import Path

import pytest

from apps.api.services.risk.rules import RULES_PATH, load_rules
from packages.core_finance.risk_signals.config import RiskRules


def _variant(tmp_path: Path, old: str, new: str) -> Path:
    text = RULES_PATH.read_text(encoding="utf-8")
    assert old in text
    path = tmp_path / "rules.yaml"
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    return path


def test_checked_in_rules_load():
    loaded = load_rules()
    assert re.fullmatch(r"[0-9a-f]{8}", loaded.version)
    assert loaded.rules.price.drop_pct == 4.0
    assert loaded.rules.price.down_days == 2
    assert loaded.rules.warnings_required == 3
    assert loaded.rules.open_gate.cap_share_pct == 20.0
    assert loaded.rules.theme_exit.quiet_days == 5


def test_unknown_key_rejected(tmp_path):
    path = _variant(tmp_path, "price: {drop_pct: 4.0,", "price: {extra: 1, drop_pct: 4.0,")
    with pytest.raises(ValueError, match="extra"):
        load_rules(path)


def test_unknown_theme_rejected(tmp_path):
    path = _variant(tmp_path, "excluded_themes: [defensives_other]", "excluded_themes: [nope]")
    with pytest.raises(ValueError, match="nope"):
        load_rules(path)


def test_unknown_series_rejected(tmp_path):
    path = _variant(tmp_path, "series: DGS10", "series: NOTFRED")
    with pytest.raises(ValueError, match="NOTFRED"):
        load_rules(path)


def test_non_positive_number_rejected(tmp_path):
    path = _variant(tmp_path, "quiet_days: 5", "quiet_days: 0")
    with pytest.raises(ValueError, match="quiet_days"):
        load_rules(path)


def test_version_changes_with_content(tmp_path):
    base = load_rules().version
    path = _variant(tmp_path, "min_members: 3", "min_members: 4")
    assert load_rules(path).version != base


def test_no_w6(tmp_path):
    assert "w6" not in RiskRules.model_fields
    path = _variant(tmp_path, "w7:", "w6: {x: 1}\nw7:")
    with pytest.raises(ValueError, match="w6"):
        load_rules(path)


def test_malformed_yaml_raises_value_error(tmp_path):
    path = tmp_path / "rules.yaml"
    path.write_text("price: {drop_pct: 4.0\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_rules(path)


def test_cpi_known_day_bounded(tmp_path):
    path = _variant(tmp_path, "cpi_known_day: 15", "cpi_known_day: 29")
    with pytest.raises(ValueError, match="cpi_known_day"):
        load_rules(path)


def test_labels_are_short():
    labels = load_rules().rules.labels
    for warning_id, label in labels:
        assert len(label.ko) <= 20, warning_id
        assert len(label.en) <= 20, warning_id
