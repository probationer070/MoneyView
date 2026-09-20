"""Per-record merge rules (spec §5). Pure: no I/O, no database."""

import itertools

import pytest

from apps.api.services.records_sync.kinds import KINDS
from apps.api.services.records_sync.merge import (
    Record,
    RecordState,
    RecordTombstone,
    merge_record_states,
)

CASE = "valuation_case"


def rec(uid="u1", ts="2026-09-20T10:00:00.000Z", by="PC-A-0001", name="Case", kind=CASE):
    return Record(kind=kind, uid=uid, updated_at=ts, updated_by=by,
                  payload={"case": {"case_name": name}, "segments": []})


def tomb(uid="u1", ts="2026-09-20T11:00:00.000Z", by="PC-B-0002", kind=CASE):
    return RecordTombstone(kind=kind, uid=uid, removed_at=ts, removed_by=by)


def state(records=(), removed=()):
    return RecordState(records={(r.kind, r.uid): r for r in records},
                       removed={(t.kind, t.uid): t for t in removed})


def test_every_kind_declares_a_table_and_an_identity():
    for name, kind in KINDS.items():
        assert kind.name == name
        assert kind.table and kind.uid_column, name
        assert kind.columns, name


def test_a_later_edit_wins():
    merged = merge_record_states([state([rec(name="old")]),
                                  state([rec(ts="2026-09-20T10:05:00.000Z", name="new")])])
    assert merged.records[(CASE, "u1")].payload["case"]["case_name"] == "new"


def test_the_payload_is_replaced_whole_never_merged_field_by_field():
    first = rec(name="A")
    first.payload["segments"] = [{"name": "one"}, {"name": "two"}]
    second = rec(ts="2026-09-20T10:05:00.000Z", name="A")
    second.payload["segments"] = [{"name": "one"}]

    merged = merge_record_states([state([first]), state([second])])

    assert merged.records[(CASE, "u1")].payload["segments"] == [{"name": "one"}], \
        "a segment removed on the winning PC must not survive from the losing copy"


def test_a_newer_remote_removal_deletes_an_older_local_record():
    merged = merge_record_states([state([rec(ts="2026-09-20T10:00:00.000Z")]),
                                  state(removed=[tomb(ts="2026-09-20T10:00:00.001Z")])])
    assert (CASE, "u1") not in merged.records
    assert (CASE, "u1") in merged.removed


def test_an_older_remote_removal_does_not_delete_a_newer_local_record():
    merged = merge_record_states([state([rec(ts="2026-09-20T10:00:00.001Z")]),
                                  state(removed=[tomb(ts="2026-09-20T10:00:00.000Z")])])
    assert (CASE, "u1") in merged.records


def test_an_equal_key_keeps_the_record_because_only_a_greater_remove_key_removes():
    at, by = "2026-09-20T10:00:00.000Z", "PC-A-0001"
    merged = merge_record_states([state([rec(ts=at, by=by)]),
                                  state(removed=[tomb(ts=at, by=by)])])
    assert (CASE, "u1") in merged.records


def test_an_equal_timestamp_is_decided_by_the_larger_author():
    a = rec(by="PC-A-0001", name="zz-from-a")   # content alone would pick this one
    c = rec(by="PC-C-0003", name="from-c")
    assert merge_record_states([state([a]), state([c])]).records[(CASE, "u1")].payload["case"]["case_name"] == "from-c"


def test_the_same_uid_in_two_kinds_is_two_records():
    merged = merge_record_states([state([rec(uid="x", kind="user_event"),
                                         rec(uid="x", kind="investment_decision")])])
    assert set(merged.records) == {("user_event", "x"), ("investment_decision", "x")}


def test_a_tombstone_is_kept_even_when_a_newer_add_wins():
    merged = merge_record_states([state(removed=[tomb(ts="2026-09-20T11:00:00.000Z")]),
                                  state([rec(ts="2026-09-20T12:00:00.000Z")])])
    assert (CASE, "u1") in merged.records
    assert merged.removed[(CASE, "u1")].removed_at == "2026-09-20T11:00:00.000Z"


def test_the_result_does_not_depend_on_read_order():
    versions = [rec(ts="2026-09-20T10:00:00.000Z", by="PC-A-0001", name="a"),
                rec(ts="2026-09-20T10:00:00.002Z", by="PC-B-0002", name="b"),
                rec(ts="2026-09-20T10:00:00.001Z", by="PC-C-0003", name="c")]
    winners = {merge_record_states(state([v]) for v in order).records[(CASE, "u1")].payload["case"]["case_name"]
               for order in itertools.permutations(versions)}
    assert winners == {"b"}


def test_baseline_records_from_two_pcs_merge_as_a_union():
    from apps.api.services.peer_sync.model import BASELINE_TS

    a = state([rec(uid="a", ts=BASELINE_TS, by="PC-A-0001")])
    b = state([rec(uid="b", ts=BASELINE_TS, by="PC-B-0002")])
    assert set(merge_record_states([a, b]).records) == {(CASE, "a"), (CASE, "b")}
