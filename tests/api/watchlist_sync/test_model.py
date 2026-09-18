"""Pure merge rules (spec §1, Merge; §3, Testing: merge function)."""

import itertools
from datetime import datetime, timedelta, timezone

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
    # A non-UTC offset converts to UTC, not just re-labels the same clock time.
    offset_moment = datetime(2026, 9, 18, 12, 0, 0, 999999, tzinfo=timezone(timedelta(hours=9)))
    assert format_ts(offset_moment) == "2026-09-18T03:00:00.999Z"
    # microsecond=999999 truncates to ".999Z", not rounds up.
    truncated_moment = datetime(2026, 9, 18, 20, 0, 0, 999999, tzinfo=timezone.utc)
    assert format_ts(truncated_moment) == "2026-09-18T20:00:00.999Z"


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


def test_the_add_remove_boundary_is_a_strictly_greater_remove_key():
    # All three cases share one timestamp, so only the author (not the timestamp) can decide,
    # and the exact tie must resolve to "present" -- only a strictly greater remove_key removes.
    ts = "2026-09-18T10:00:00.000Z"
    larger_author_removal = merge_states([state([row(by="PC-A-0001", ts=ts)]),
                                          state(removed=[tomb(by="PC-C-0003", ts=ts)])])
    assert "AAPL" not in larger_author_removal.rows
    smaller_author_removal = merge_states([state([row(by="PC-C-0003", ts=ts)]),
                                           state(removed=[tomb(by="PC-A-0001", ts=ts)])])
    assert "AAPL" in smaller_author_removal.rows
    equal_keys = merge_states([state([row(by="PC-B-0002", ts=ts)]),
                               state(removed=[tomb(by="PC-B-0002", ts=ts)])])
    assert "AAPL" in equal_keys.rows


def test_an_equal_timestamp_is_decided_by_the_larger_author():
    # The content tie-break alone would pick "zz-from-a"; only the author makes C win.
    a = row(by="PC-A-0001", group="zz-from-a")
    c = row(by="PC-C-0003", group="from-c")
    assert merge_states([state([a]), state([c])]).rows["AAPL"].group_name == "from-c"


def test_republishing_a_change_does_not_change_the_winner():
    a = row(by="PC-A-0001", group="from-a", ts="2026-09-18T10:00:00.000Z")
    c = row(by="PC-C-0003", group="from-c", ts="2026-09-18T10:00:00.000Z")
    no_duplicate = merge_states([state([a]), state([c])]).rows["AAPL"]
    assert no_duplicate.group_name == "from-c"
    # B imported A's change and republished it: same author, same time, in a third file.
    # However the three files are read, republishing a is not allowed to change the winner.
    for order in itertools.permutations([state([a]), state([a]), state([c])]):
        merged = merge_states(order).rows["AAPL"]
        assert merged.group_name == "from-c"
        assert merged == no_duplicate


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
