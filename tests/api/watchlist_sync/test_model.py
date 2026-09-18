"""Pure merge rules (spec §1, Merge; §3, Testing: merge function)."""

import itertools
from datetime import datetime, timezone

from apps.api.services.watchlist_sync.model import (
    BASELINE_TS,
    SyncRow,
    SyncState,
    Tombstone,
    format_ts,
    merge_states,
    next_stamp,
)


def row(ticker="AAPL", ts="2026-09-18T10:00:00.000Z", by="PC-A-0001", group="custom", weight=0.1, name="Apple"):
    return SyncRow(ticker=ticker, name=name, sector="Technology", group_name=group, weight=weight,
                   updated_at=ts, updated_by=by)


def tomb(ticker="AAPL", ts="2026-09-18T11:00:00.000Z", by="PC-B-0002"):
    return Tombstone(ticker=ticker, removed_at=ts, removed_by=by)


def state(rows=(), removed=()):
    return SyncState(rows={r.ticker: r for r in rows}, removed={t.ticker: t for t in removed})


def test_format_is_utc_milliseconds_with_z():
    moment = datetime(2026, 9, 18, 20, 0, 0, 123456, tzinfo=timezone.utc)
    assert format_ts(moment) == "2026-09-18T20:00:00.123Z"


def test_stamps_strictly_increase_even_within_one_millisecond():
    moment = datetime(2000, 1, 1, tzinfo=timezone.utc)
    first, second = next_stamp(moment), next_stamp(moment)
    assert second > first


def test_a_later_edit_wins():
    merged = merge_states([state([row(group="custom")]), state([row(ts="2026-09-18T10:05:00.000Z", group="total")])])
    assert merged.rows["AAPL"].group_name == "total"


def test_remove_then_re_add_keeps_the_ticker_and_the_ineffective_tombstone():
    merged = merge_states([state(removed=[tomb(ts="2026-09-18T11:00:00.000Z")]),
                           state([row(ts="2026-09-18T12:00:00.000Z")])])
    assert "AAPL" in merged.rows
    assert merged.removed["AAPL"].removed_at == "2026-09-18T11:00:00.000Z", "the older tombstone is kept"


def test_remove_then_edit_revives_the_ticker():
    merged = merge_states([state(removed=[tomb(ts="2026-09-18T11:00:00.000Z")]),
                           state([row(ts="2026-09-18T11:30:00.000Z", weight=0.3)])])
    assert merged.rows["AAPL"].weight == 0.3


def test_a_newer_remote_removal_deletes_an_older_local_row():
    local = state([row(ts="2026-09-18T10:00:00.000Z")])
    remote = state(removed=[tomb(ts="2026-09-18T10:00:00.001Z")])
    assert "AAPL" not in merge_states([local, remote]).rows


def test_an_older_remote_removal_does_not_delete_a_newer_local_row():
    local = state([row(ts="2026-09-18T10:00:00.001Z")])
    remote = state(removed=[tomb(ts="2026-09-18T10:00:00.000Z")])
    assert "AAPL" in merge_states([local, remote]).rows


def test_an_equal_timestamp_is_decided_by_the_larger_author():
    # The content tie-break alone would pick "zz-from-a"; only the author makes C win.
    a = row(by="PC-A-0001", group="zz-from-a")
    c = row(by="PC-C-0003", group="from-c")
    assert merge_states([state([a]), state([c])]).rows["AAPL"].group_name == "from-c"


def test_republishing_a_change_does_not_change_the_winner():
    a = row(by="PC-A-0001", group="from-a", ts="2026-09-18T10:00:00.000Z")
    c = row(by="PC-C-0003", group="from-c", ts="2026-09-18T10:00:00.000Z")
    before = merge_states([state([a]), state([c])])
    # B imported A's change and republished it: same author, same time, in a third file.
    after = merge_states([state([a]), state([a]), state([c])])
    assert before.rows["AAPL"] == after.rows["AAPL"]


def test_three_way_conflict_converges_regardless_of_order():
    versions = [row(ts="2026-09-18T10:00:00.000Z", by="PC-A-0001", group="a"),
                row(ts="2026-09-18T10:00:00.002Z", by="PC-B-0002", group="b"),
                row(ts="2026-09-18T10:00:00.001Z", by="PC-C-0003", group="c")]
    winners = {merge_states(state([v]) for v in order).rows["AAPL"].group_name for order in itertools.permutations(versions)}
    assert winners == {"b"}


def test_baseline_rows_from_two_pcs_merge_as_a_union():
    a = state([row("AAPL", ts=BASELINE_TS, by="PC-A-0001")])
    b = state([row("NVDA", ts=BASELINE_TS, by="PC-B-0002")])
    assert set(merge_states([a, b]).rows) == {"AAPL", "NVDA"}


def test_a_real_change_beats_a_baseline_row():
    base = state([row(ts=BASELINE_TS, by="PC-Z-ffff", group="old")])
    real = state([row(ts="2026-01-01T00:00:00.000Z", by="PC-A-0001", group="new")])
    assert merge_states([base, real]).rows["AAPL"].group_name == "new"
