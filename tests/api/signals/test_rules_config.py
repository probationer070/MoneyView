from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from apps.api.services.signals import models
from apps.api.services.signals.models import RULES_PATH, load_rules


def write_variant(tmp_path: Path, mutate) -> Path:
    data = yaml.safe_load(RULES_PATH.read_text(encoding="utf-8"))
    mutate(data)
    path = tmp_path / "rules.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return path


def test_shipped_rules_load_with_eight_auto_and_three_manual():
    loaded = load_rules()
    kinds = [r.kind for r in loaded.file.rules]
    assert len(kinds) == 11 and kinds.count("manual") == 3
    assert len(loaded.version) == 12


def test_unknown_series_id_is_rejected(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(series=["DGS99"]))
    with pytest.raises(ValidationError, match="DGS99"):
        load_rules(path)


def test_typo_key_is_rejected(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(treshold=5.5))
    with pytest.raises(ValidationError):
        load_rules(path)


def test_prior_must_sum_to_one(tmp_path):
    path = write_variant(tmp_path, lambda d: d["scenario"]["prior"].update(a=0.5))
    with pytest.raises(ValidationError, match="sum"):
        load_rules(path)


def test_duplicate_rule_ids_are_rejected(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"].append(d["rules"][0]))
    with pytest.raises(ValidationError, match="duplicate"):
        load_rules(path)


def test_version_changes_when_the_file_changes(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(threshold=5.6))
    assert load_rules(path).version != load_rules().version


def test_app_start_fails_on_an_invalid_rules_file(tmp_path, monkeypatch):
    """Stays red until Task 7 wires reload_rules() into lifespan."""
    from apps.api.main import app

    bad = write_variant(tmp_path, lambda d: d["rules"][0].update(series=["DGS99"]))
    monkeypatch.setattr(models, "RULES_PATH", bad)
    with pytest.raises(ValidationError):
        with TestClient(app):
            pass


def test_near_weight_must_be_below_triggered(tmp_path):
    path = write_variant(tmp_path, lambda d: d["scenario"]["weights"].update(near=1.0))
    with pytest.raises(ValidationError, match="near weight"):
        load_rules(path)


def test_floor_and_cap_must_be_feasible_for_three_scenarios(tmp_path):
    path = write_variant(tmp_path, lambda d: d["scenario"].update(floor=0.4))
    with pytest.raises(ValidationError, match="infeasible"):
        load_rules(path)


def test_compound_condition_series_must_be_listed_in_series(tmp_path):
    def mutate(d):
        rule = next(r for r in d["rules"] if r["id"] == "a_labor_core")
        rule["conditions"][0]["series"] = "DGS10"

    path = write_variant(tmp_path, mutate)
    with pytest.raises(ValidationError, match="not listed in series"):
        load_rules(path)


def test_single_series_kinds_take_exactly_one_series(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(series=["DGS10", "PAYEMS"]))
    with pytest.raises(ValidationError, match="exactly one series"):
        load_rules(path)


def test_compound_rule_needs_at_least_two_conditions(tmp_path):
    def mutate(d):
        rule = next(r for r in d["rules"] if r["id"] == "a_labor_core")
        rule["conditions"] = rule["conditions"][:1]

    path = write_variant(tmp_path, mutate)
    with pytest.raises(ValidationError, match="conditions"):
        load_rules(path)


def test_rule_series_cannot_be_empty(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(series=[]))
    with pytest.raises(ValidationError, match="at least 1"):
        load_rules(path)


def test_likelihood_ratios_must_be_positive(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0]["lr"].update(a=0))
    with pytest.raises(ValidationError):
        load_rules(path)


def test_prior_probabilities_must_be_positive(tmp_path):
    path = write_variant(tmp_path, lambda d: d["scenario"]["prior"].update(a=0.0, c=0.55))
    with pytest.raises(ValidationError):
        load_rules(path)
