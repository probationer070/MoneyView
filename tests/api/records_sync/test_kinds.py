"""The kind registry matches the live schema, and states its identity rules explicitly (spec §1,
§3). Opens a real, per-test-isolated database via the usual get_db() fixture (tests/conftest.py's
autouse _isolated_db).
"""

from apps.api.services.db import get_db
from apps.api.services.records_sync.kinds import KIND_PREFERENCES, KIND_VALUATION_CASE, KINDS


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


def test_parent_case_id_never_travels():
    # parent_case_id points at a LOCAL row id, so it must never be a payload column: a peer's
    # value would name a different case here.
    assert "parent_case_id" not in KINDS[KIND_VALUATION_CASE].columns


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
