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


def test_surge_values_load():
    rules = load_rules().rules
    s = rules.surge
    assert (s.ema, s.accel_lag, s.live_window_rows, s.leaders) == (10, 3, 400, 5)
    assert (s.magnitude.window, s.magnitude.std_window, s.magnitude.std_min, s.magnitude.z) == (5, 60, 40, 2.0)
    assert (s.accel.quantile_window, s.accel.quantile_min, s.accel.rank) == (250, 120, 0.95)
    assert (s.breadth.window, s.breadth.min_pct) == (5, 60.0)
    assert (s.rsi.period, s.rsi.cross, s.rsi.within, s.rsi.overheated) == (14, 60.0, 5, 80.0)
    assert (s.event.gap, s.event.stall, s.event.high_window) == (10, 10, 20)
    assert (s.gate.cap_share_pct, s.gate.sox_opens) == (20.0, True)
    assert rules.movers.count == 5
    labels = rules.surge_labels
    assert (labels.magnitude.ko, labels.magnitude.en) == ("상승 크기", "Move size")
    assert (labels.accel.ko, labels.accel.en) == ("기울기 급변", "Slope acceleration")
    assert (labels.breadth.ko, labels.breadth.en) == ("폭", "Breadth")
    assert (labels.rsi.ko, labels.rsi.en) == ("RSI", "RSI")
    for component_id, label in labels:
        assert len(label.ko) <= 20 and len(label.en) <= 20, component_id
    for component_id, text in rules.surge_rule_text:
        assert text.ko and text.en, component_id


def test_surge_unknown_key_rejected(tmp_path):
    path = _variant(tmp_path, "magnitude: {window: 5,", "magnitude: {extra: 1, window: 5,")
    with pytest.raises(ValueError, match="extra"):
        load_rules(path)


def test_rank_bounded(tmp_path):
    for bad in ("1.5", "1.0", "0.0"):
        path = _variant(tmp_path, "rank: 0.95", f"rank: {bad}")
        with pytest.raises(ValueError, match="rank"):
            load_rules(path)


def test_version_changes_with_surge_section(tmp_path):
    base = load_rules().version
    path = _variant(tmp_path, "std_min: 40", "std_min: 41")
    assert load_rules(path).version != base


def test_rsi_cross_below_overheated(tmp_path):
    path = _variant(tmp_path, "cross: 60.0", "cross: 80.0")
    with pytest.raises(ValueError, match="cross"):
        load_rules(path)


def test_live_window_covers_accel_warmup(tmp_path):
    path = _variant(tmp_path, "live_window_rows: 400", "live_window_rows: 259")
    with pytest.raises(ValueError, match="live_window_rows"):
        load_rules(path)
    load_rules(_variant(tmp_path, "live_window_rows: 400", "live_window_rows: 260"))


def test_surge_percent_must_be_positive(tmp_path):
    path = _variant(tmp_path, "min_pct: 60.0", "min_pct: 0")
    with pytest.raises(ValueError, match="min_pct"):
        load_rules(path)
