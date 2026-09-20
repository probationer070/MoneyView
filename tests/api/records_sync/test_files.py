"""Record peer files: which files count, validation per kind, atomic writes (spec §4)."""

import json

import pytest

from apps.api.services.records_sync import files
from apps.api.services.records_sync.files import own_file_path, read_peer_files, write_own_file
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone
from apps.api.services.watchlist_sync.files import SyncFolderUnavailable

A, ME = "PC-A-0001", "PC-ME-00ff"
TS = "2026-09-20T10:00:00.000Z"


def _state():
    case = Record("valuation_case", "u1", TS, A,
                  {"case": {"case_name": "Case", "ticker": "AAPL", "as_of_date": "2026-01-01",
                            "base_year": 2026, "target_year": 2031, "riskfree_rate": 0.03,
                            "wacc_initial": 0.09, "wacc_stable": 0.08, "wacc_converge_from": 5,
                            "marginal_tax_rate": 0.21, "nol_balance": 0.0, "roic_stable": 0.12,
                            "terminal_growth": 0.02, "effective_tax_rate": 0.18, "cash": 1.0,
                            "debt": 0.0, "ipo_proceeds": 0.0, "shares_basic": 10.0, "shares_new": 0.0},
                   "segments": [{"name": "core", "base_revenue": 100.0, "base_margin": 0.2,
                                 "tam_target": None, "market_share_target": None,
                                 "revenue_target": 200.0, "margin_target": 0.25,
                                 "sales_to_capital_early": 2.0, "sales_to_capital_late": 2.5,
                                 "ramp_start_year": 1, "initial_growth": 0.2,
                                 "waypoint_gap_fraction": 0.5,
                                 "narratives": [{"input_field": "revenue_target", "claim": "c",
                                                 "evidence_source": None, "confidence": "assumed",
                                                 "three_p": "plausible"}]}]})
    return RecordState(records={("valuation_case", "u1"): case},
                       removed={("user_event", "gone"): RecordTombstone("user_event", "gone", TS, A)})


def _folder(tmp_path):
    folder = tmp_path / "MoneyView"
    folder.mkdir()
    return folder


def test_a_written_file_reads_back_as_the_same_state_with_authors_kept(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, "PC-B-0002", _state(), "2026-09-20T10:00:01.000Z")

    [peer], skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert skipped == []
    assert peer.pc_id == "PC-B-0002"
    assert peer.state == _state(), "a republished record keeps its original author"


def test_this_pcs_own_file_is_never_an_input(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(), "2026-09-20T10:00:01.000Z")
    assert read_peer_files(tmp_path, own_pc_id=ME) == ([], [])


def test_the_watchlist_file_is_not_a_record_file(tmp_path):
    folder = _folder(tmp_path)
    (folder / f"watchlist.{A}.json").write_text("{}", encoding="utf-8")
    assert read_peer_files(tmp_path, own_pc_id=ME) == ([], [])


def test_an_unknown_kind_is_skipped_and_reported(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["kind"] = "something_else"
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and "something_else" in skipped[0].reason


def test_a_payload_column_this_schema_does_not_have_is_an_error_not_ignored(tmp_path):
    # A peer on a newer schema. Guessing would drop a column the owner wrote.
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["payload"]["case"]["brand_new_column"] = 1
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and "brand_new_column" in skipped[0].reason


def test_a_missing_payload_column_is_an_error(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    del payload["records"][0]["payload"]["case"]["ticker"]
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert read_peer_files(tmp_path, own_pc_id=ME)[0] == []


def test_an_impossible_stamp_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["updated_at"] = "2026-13-01T00:00:00.000Z"
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert read_peer_files(tmp_path, own_pc_id=ME)[0] == []


def test_one_bad_file_does_not_poison_the_others(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    (folder / "records.PC-C-0003.json").write_text("{not json", encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [A]
    assert [s.name for s in skipped] == ["records.PC-C-0003.json"]


def test_a_file_whose_pc_id_differs_from_its_name_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    (folder / f"records.{A}.json").rename(folder / f"records.{A}-DESKTOP.json")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"records.{A}-DESKTOP.json"


def test_a_failed_replace_leaves_the_previous_file_intact(tmp_path, monkeypatch):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(), "2026-09-20T10:00:01.000Z")
    before = own_file_path(tmp_path, ME).read_text(encoding="utf-8")

    def refuse(src, dst):
        raise PermissionError("simulated replace failure")

    monkeypatch.setattr(files.os, "replace", refuse)
    with pytest.raises(PermissionError):
        write_own_file(tmp_path, ME, RecordState(), "2026-09-20T10:00:02.000Z")

    assert own_file_path(tmp_path, ME).read_text(encoding="utf-8") == before


def test_writing_a_state_peers_would_reject_raises_and_creates_no_file(tmp_path):
    _folder(tmp_path)
    bad = RecordState(records={("valuation_case", "u1"): Record("valuation_case", "u1", TS, "", {"case": {}, "segments": []})})

    with pytest.raises(ValueError):
        write_own_file(tmp_path, A, bad, "2026-09-20T10:00:01.000Z")

    assert not own_file_path(tmp_path, A).exists()


def test_a_missing_sync_root_is_unavailable_and_is_not_created(tmp_path):
    root = tmp_path / "not-there"
    with pytest.raises(SyncFolderUnavailable):
        read_peer_files(root, own_pc_id=ME)
    assert not root.exists()


def test_a_filename_with_junk_around_it_is_not_read_or_reported(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    good_text = (folder / f"records.{A}.json").read_text(encoding="utf-8")
    (folder / f"records.{A}.json.bak").write_text(good_text, encoding="utf-8")
    (folder / f"backup.records.{A}.json").write_text(good_text, encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [A]
    assert skipped == []


def test_write_own_file_rejects_a_non_finite_value_and_creates_no_file(tmp_path):
    _folder(tmp_path)
    for bad in (float("nan"), float("inf")):
        state = _state()
        state.records[("valuation_case", "u1")].payload["case"]["riskfree_rate"] = bad

        with pytest.raises(ValueError):
            write_own_file(tmp_path, A, state, "2026-09-20T10:00:01.000Z")

        assert not own_file_path(tmp_path, A).exists()


def test_a_literal_nan_token_in_a_peer_file_is_skipped_and_reported(tmp_path):
    # Python's json module reads (and by default writes) the bare NaN token even though it is not
    # valid JSON. This proves the reader rejects it rather than relying on a parse error.
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["payload"]["case"]["riskfree_rate"] = float("nan")
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"records.{A}.json"
