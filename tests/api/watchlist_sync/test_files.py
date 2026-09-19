"""Peer files (spec §1: which files count, atomic writes, failure behaviour)."""

import json
import os

import pytest

from apps.api.services.watchlist_sync import files
from apps.api.services.watchlist_sync.files import (
    SyncFolderUnavailable,
    own_file_path,
    read_peer_files,
    write_own_file,
)
from apps.api.services.watchlist_sync.model import SyncRow, SyncState, Tombstone

A, B, C, ME = "PC-A-0001", "PC-B-0002", "PC-C-0003", "PC-ME-00ff"


def _state(ticker="AAPL", by=A, ts="2026-09-18T10:00:00.000Z"):
    return SyncState(
        rows={ticker: SyncRow(ticker, "Apple", "Technology", "custom", 0.1, ts, by)},
        removed={"MSFT": Tombstone("MSFT", "2026-09-18T09:00:00.000Z", by)},
    )


def _folder(tmp_path):
    folder = tmp_path / "MoneyView"
    folder.mkdir()
    return folder


def test_a_written_file_reads_back_as_the_same_state_with_authors_kept(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, B, _state(by=A), "2026-09-18T10:00:01.000Z")

    [peer], skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert skipped == []
    assert peer.pc_id == B and peer.written_at == "2026-09-18T10:00:01.000Z"
    assert peer.state == _state(by=A), "a republished row keeps its original author"


def test_this_pcs_own_file_is_never_an_input(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")

    assert read_peer_files(tmp_path, own_pc_id=ME) == ([], [])


def test_invalid_json_is_skipped_and_reported_not_treated_as_empty(tmp_path):
    folder = _folder(tmp_path)
    (folder / f"watchlist.{A}.json").write_text("{not json", encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == []
    assert [s.name for s in skipped] == [f"watchlist.{A}.json"]


def test_an_unsupported_format_version_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["format_version"] = 2
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and "format_version" in skipped[0].reason


def test_a_file_whose_pc_id_differs_from_its_name_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    (folder / f"watchlist.{A}.json").rename(folder / f"watchlist.{A}-DESKTOP.json")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{A}-DESKTOP.json"


def test_own_filename_with_foreign_content_is_reported_not_used(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    (folder / f"watchlist.{A}.json").rename(folder / f"watchlist.{ME}.json")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{ME}.json"


def test_tmp_files_and_conflict_copies_are_ignored(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    good = (folder / f"watchlist.{A}.json").read_text(encoding="utf-8")
    (folder / f"watchlist.{B}.json.tmp").write_text(good.replace(A, B), encoding="utf-8")
    (folder / f"watchlist.{C} (1).json").write_text(good.replace(A, C), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [A] and skipped == []


def test_one_bad_peer_does_not_poison_the_others(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state("AAPL", by=A), "2026-09-18T10:00:01.000Z")
    write_own_file(tmp_path, C, _state("NVDA", by=C), "2026-09-18T10:00:01.000Z")
    (folder / f"watchlist.{B}.json").write_text("[]", encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert sorted(p.pc_id for p in peers) == [A, C]
    assert [s.name for s in skipped] == [f"watchlist.{B}.json"]


def test_a_failed_replace_leaves_the_previous_file_intact(tmp_path, monkeypatch):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")
    before = own_file_path(tmp_path, ME).read_text(encoding="utf-8")

    def refuse(src, dst):
        raise PermissionError("simulated replace failure")

    monkeypatch.setattr(files.os, "replace", refuse)
    with pytest.raises(PermissionError):
        write_own_file(tmp_path, ME, _state("NVDA", by=ME), "2026-09-18T10:00:02.000Z")

    assert own_file_path(tmp_path, ME).read_text(encoding="utf-8") == before
    json.loads(before)


def test_a_missing_sync_root_is_unavailable_and_is_not_created(tmp_path):
    root = tmp_path / "not-there"
    with pytest.raises(SyncFolderUnavailable):
        read_peer_files(root, own_pc_id=ME)
    with pytest.raises(SyncFolderUnavailable):
        write_own_file(root, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")
    assert not root.exists()


def test_the_moneyview_subfolder_is_created_inside_an_existing_root(tmp_path):
    write_own_file(tmp_path, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")
    assert own_file_path(tmp_path, ME).parent == tmp_path / "MoneyView"
    assert read_peer_files(tmp_path, own_pc_id="PC-OTHER-1111")[0][0].pc_id == ME


# --- Fix round 1 (I1-I4) ---


def test_an_overflowing_weight_is_skipped_beside_a_good_peer(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, C, _state("NVDA", by=C), "2026-09-18T10:00:01.000Z")
    huge_weight = "9" * 400
    text = (
        '{"format_version": 1, "pc_id": "%s", "written_at": "2026-09-18T10:00:01.000Z", '
        '"watchlist": [{"ticker": "AAPL", "name": "Apple", "sector": "Technology", '
        '"group_name": "custom", "weight": %s, "updated_at": "2026-09-18T10:00:00.000Z", '
        '"updated_by": "%s"}], "removed": []}' % (A, huge_weight, A)
    )
    (folder / f"watchlist.{A}.json").write_text(text, encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [C]
    assert [s.name for s in skipped] == [f"watchlist.{A}.json"]


def test_deeply_nested_json_is_skipped_and_reported(tmp_path):
    folder = _folder(tmp_path)
    (folder / f"watchlist.{A}.json").write_text("[" * 100000, encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == []
    assert [s.name for s in skipped] == [f"watchlist.{A}.json"]


def test_a_non_list_watchlist_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["watchlist"] = {}
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{A}.json"


def test_a_missing_removed_key_is_skipped_beside_a_good_peer(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, C, _state("NVDA", by=C), "2026-09-18T10:00:01.000Z")
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    del payload["removed"]
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [C]
    assert [s.name for s in skipped] == [f"watchlist.{A}.json"]


def test_watchlist_as_a_number_is_skipped_beside_a_good_peer(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, C, _state("NVDA", by=C), "2026-09-18T10:00:01.000Z")
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["watchlist"] = 5
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [C]
    assert [s.name for s in skipped] == [f"watchlist.{A}.json"]


def test_a_row_with_an_empty_updated_by_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["watchlist"][0]["updated_by"] = ""
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{A}.json"


def test_writing_an_invalid_state_raises_and_creates_no_file(tmp_path):
    _folder(tmp_path)
    bad_state = SyncState(
        rows={"AAPL": SyncRow("AAPL", "Apple", "Technology", "custom", 0.1, "2026-09-18T10:00:00.000Z", "")},
        removed={},
    )

    with pytest.raises(ValueError):
        write_own_file(tmp_path, A, bad_state, "2026-09-18T10:00:01.000Z")

    assert not own_file_path(tmp_path, A).exists()


@pytest.mark.parametrize(
    ("section", "field", "stamp"),
    [
        ("watchlist", "updated_at", "2026-13-01T00:00:00.000Z"),   # month 13
        ("watchlist", "updated_at", "2026-02-30T00:00:00.000Z"),   # no such day
        ("removed", "removed_at", "9999-12-31T23:59:59.999Z"),     # no room for +1 ms after it
    ],
)
def test_a_well_shaped_but_impossible_stamp_is_skipped(tmp_path, section, field, stamp):
    # These match the timestamp pattern, and before this check they were imported. The next local
    # edit or delete of that ticker then passed them to next_stamp(after=...), which raised, so the
    # route returned 500 and the ticker could not be changed on any PC that imported the file.
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload[section][0][field] = stamp
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{A}.json"


def test_the_seed_stamp_is_still_accepted(tmp_path):
    from apps.api.services.watchlist_sync.model import SEED_TS

    _folder(tmp_path)
    write_own_file(tmp_path, A, _state(ts=SEED_TS), "2026-09-18T10:00:01.000Z")

    [peer], skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert skipped == [] and peer.state.rows["AAPL"].updated_at == SEED_TS
