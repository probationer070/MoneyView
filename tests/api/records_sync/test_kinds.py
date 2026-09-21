"""The kind registry matches the live schema, and states its identity rules explicitly (spec §1,
§3). Opens a real, per-test-isolated database via the usual get_db() fixture (tests/conftest.py's
autouse _isolated_db).
"""

from apps.api.services.db import get_db
from apps.api.services.records_sync.kinds import (
    KIND_PREFERENCES,
    KIND_VALUATION_CASE,
    KINDS,
    PARENT_UID_KEY,
    payload_columns,
)


def _columns(conn, table):
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def _assert_child_matches_schema(conn, child):
    columns = _columns(conn, child.table)
    assert columns, f"{child.table} has no columns -- does it exist?"
    assert child.parent_column in columns, f"{child.table}.{child.parent_column}"
    for name in child.columns:
        assert name in columns, f"{child.table}.{name}"
    for grandchild in child.children:
        _assert_child_matches_schema(conn, grandchild)


def test_every_kind_matches_the_live_schema():
    with get_db() as conn:
        for kind in KINDS.values():
            columns = _columns(conn, kind.table)
            assert columns, f"{kind.table} has no columns -- does it exist?"
            for name in kind.columns:
                assert name in columns, f"{kind.table}.{name}"
            assert kind.uid_column in columns, f"{kind.table}.{kind.uid_column}"
            for child in kind.children:
                _assert_child_matches_schema(conn, child)


def test_parent_case_id_never_travels_but_the_parents_uid_does():
    # parent_case_id points at a LOCAL row id, so it must never be a payload column: a peer's
    # value would name a different case here. The parent's sync_uid travels in its place.
    case = KINDS[KIND_VALUATION_CASE]
    assert "parent_case_id" not in payload_columns(case)
    assert PARENT_UID_KEY in payload_columns(case)
    assert case.lineage_column == "parent_case_id"


def test_exactly_one_kind_is_a_singleton_identified_across_pcs_by_singleton_uid():
    singletons = {name: kind for name, kind in KINDS.items() if kind.singleton_uid is not None}
    assert set(singletons) == {KIND_PREFERENCES}
    assert singletons[KIND_PREFERENCES].singleton_uid == "portfolio_preferences"


def test_the_uid_column_is_a_payload_column_only_when_the_identity_is_natural():
    for name, kind in KINDS.items():
        if kind.generates_uid:
            assert kind.uid_column not in kind.columns, name
        elif kind.singleton_uid is None:
            assert kind.uid_column in kind.columns, name


def test_every_real_column_is_declared_or_explicitly_excluded():
    # The registry is otherwise checked in one direction only (every declared column exists in
    # the schema). This is the reverse check: a real column added to one of these tables later,
    # but not added here, would otherwise silently never sync, with no test failing.
    excluded = {
        "id",              # surrogate local primary key (valuation_case, investment_decision, user_event, segment)
        "sync_uid",        # generated cross-PC identity, written by backfill_uids -- not a payload column
        "case_id",         # segment's local parent pointer
        "segment_id",      # segment_narrative's local parent pointer
        "parent_case_id",  # valuation_case's local fork pointer; travels as parent_uid instead (spec §4)
        "singleton_id",    # portfolio_preferences' local row locator; singleton_uid is the real identity
    }

    def _check(conn, table, declared):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        undeclared = columns - declared - excluded
        assert not undeclared, f"{table} has undeclared columns {undeclared}"

    def _check_child(conn, child):
        _check(conn, child.table, set(child.columns))
        for grandchild in child.children:
            _check_child(conn, grandchild)

    with get_db() as conn:
        for kind in KINDS.values():
            _check(conn, kind.table, set(kind.columns))
            for child in kind.children:
                _check_child(conn, child)
