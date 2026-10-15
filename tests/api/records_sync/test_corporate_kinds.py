"""corporate_metrics and corporate_companies sync between PCs by ticker; the later edit wins
(spec 2026-10-15 §3, tests §4.8 and §4.9; plan Narrowed N2, N3; Rollout notes).
Rows here are written the way the write paths will (Task 7), with explicit stamps.
"""
from __future__ import annotations

import json

from apps.api.services.db import get_db
from apps.api.services.records_sync import files, kinds, service, store
from apps.api.services.records_sync.kinds import KIND_CORPORATE_COMPANIES, KIND_CORPORATE_METRICS, KINDS
from apps.api.services.watchlist_sync import store as watchlist_store
from tests.api.records_sync.test_service import PC, cloud  # noqa: F401 - cloud is a pytest fixture

TS = "2026-10-01T00:00:00.000Z"


def put_metrics(pc, ticker, growth, saved_at="2026-10-01T00:00:00+00:00", stamp=True):
    pc.use()
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO corporate_metrics (ticker, growth, updated_at) VALUES (?, ?, ?)",
                     (ticker, growth, saved_at))
        if stamp:
            store.stamp(conn, KIND_CORPORATE_METRICS, ticker, watchlist_store.get_or_create_pc_id(conn))


def put_company(pc, ticker, name, saved_at="2026-10-01T00:00:00+00:00", stamp=True):
    pc.use()
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO corporate_companies (ticker, name, updated_at) VALUES (?, ?, ?)",
                     (ticker, name, saved_at))
        if stamp:
            store.stamp(conn, KIND_CORPORATE_COMPANIES, ticker, watchlist_store.get_or_create_pc_id(conn))


def metrics(pc) -> dict[str, dict]:
    pc.use()
    with get_db() as conn:
        return {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM corporate_metrics")}


def companies(pc) -> dict[str, dict]:
    pc.use()
    with get_db() as conn:
        return {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM corporate_companies")}


def test_both_corporate_kinds_are_keyed_by_ticker():
    for name in (KIND_CORPORATE_METRICS, KIND_CORPORATE_COMPANIES):
        kind = KINDS[name]
        assert kind.table == name and kind.uid_column == "ticker", name
        assert not kind.generates_uid and kind.singleton_uid is None, name
        assert "ticker" in kind.columns and "updated_at" in kind.columns, name


def test_a_metrics_edit_on_pc_a_arrives_on_pc_b(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_metrics(a, "AAPL", 9.5)
    a.sync(); b.sync()
    assert metrics(b).get("AAPL", {}).get("growth") == 9.5, "a corporate_metrics edit did not reach PC B"


def test_a_company_added_on_pc_a_arrives_on_pc_b(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_company(a, "ZZPV", "Private Co")
    a.sync(); b.sync()
    assert companies(b).get("ZZPV", {}).get("name") == "Private Co", "a corporate_companies row did not reach PC B"


def test_when_both_pcs_edited_metrics_the_later_edit_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_metrics(a, "AAPL", 9.0)
    a.sync(); b.sync()
    put_metrics(b, "AAPL", 11.0)  # later; its JSON sorts BELOW 9.0, so a tie would pick 9.0
    b.sync(); a.sync()
    assert metrics(a)["AAPL"]["growth"] == 11.0 and metrics(b)["AAPL"]["growth"] == 11.0, \
        "the later corporate_metrics edit did not win on both PCs"


def test_when_both_pcs_edited_a_company_the_later_edit_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_company(a, "ZZPV", "Zeta")
    a.sync(); b.sync()
    put_company(b, "ZZPV", "Alpha")  # later; sorts below "Zeta"
    b.sync(); a.sync()
    assert companies(a)["ZZPV"]["name"] == "Alpha" and companies(b)["ZZPV"]["name"] == "Alpha", \
        "the later corporate_companies edit did not win on both PCs"


def test_first_sync_orders_pre_existing_rows_by_their_saved_time(tmp_path, monkeypatch, cloud):
    # Rows saved before this shipped have no record_sync stamp. PC-A sorts below PC-B, so a pc_id
    # tiebreak would pick B's older row.
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    put_metrics(a, "AAPL", 7.0, saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_metrics(b, "AAPL", 11.0, saved_at="2026-10-01T00:00:00+00:00", stamp=False)
    put_company(a, "ZZPV", "Newer", saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_company(b, "ZZPV", "Older", saved_at="2026-10-01T00:00:00+00:00", stamp=False)
    a.sync(); b.sync(); a.sync()
    assert metrics(a)["AAPL"]["growth"] == 7.0 and metrics(b)["AAPL"]["growth"] == 7.0, \
        "first sync did not keep the later-saved corporate_metrics row"
    assert companies(b)["ZZPV"]["name"] == "Newer", "first sync did not keep the later-saved company"


def test_first_sync_ranks_an_add_company_default_below_a_real_adjustment(tmp_path, monkeypatch, cloud):
    # add_company writes one `now` into both tables; nobody adjusted LEU on A after that.
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    put_company(a, "LEU", "Centrus", saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_metrics(a, "LEU", 3.0, saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_metrics(b, "LEU", 20.0, saved_at="2026-10-01T00:00:00+00:00", stamp=False)
    a.sync(); b.sync(); a.sync()
    assert metrics(a)["LEU"]["growth"] == 20.0 and metrics(b)["LEU"]["growth"] == 20.0, \
        "an untouched add_company default outranked a real adjustment made on the other PC"


def test_an_older_peer_file_without_the_new_kinds_still_loads_and_merges(tmp_path, monkeypatch, cloud):
    b = PC(tmp_path, "PC-B", monkeypatch)
    put_metrics(b, "AAPL", 9.5)
    old = files.own_file_path(cloud, "PC-OLD-0001")
    old.parent.mkdir(exist_ok=True)
    old.write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-OLD-0001", "written_at": TS,
        "records": [{"kind": "user_event", "uid": "old-event-1", "updated_at": TS, "updated_by": "PC-OLD-0001",
                     "payload": {"label": "From the old PC", "category": "fomc", "start_date": "2026-01-01",
                                 "end_date": None, "source": None, "note": "", "created_at": TS}}],
        "removed": [],
    }), encoding="utf-8")

    b.sync()

    assert service.current_status().skipped_files == [], "an older peer file was skipped"
    assert "From the old PC" in b.events(), "an existing kind from an older peer file did not merge"
    assert metrics(b)["AAPL"]["growth"] == 9.5
    published = json.loads(files.own_file_path(cloud, b.pc_id()).read_text(encoding="utf-8"))
    assert ("corporate_metrics", "AAPL") in {(r["kind"], r["uid"]) for r in published["records"]}


def test_an_older_reader_skips_a_whole_file_that_carries_the_new_kinds(tmp_path, monkeypatch, cloud):
    # Characterises today's reader (files._parse, the `unknown kind` raise (files.py:131-133)) for the rollout notes: an older PC drops the
    # updated PC's WHOLE file, other kinds included, until it is updated too.
    a = PC(tmp_path, "PC-A", monkeypatch)
    put_metrics(a, "AAPL", 9.5)
    a.add_event("Also in that file")
    for name in (KIND_CORPORATE_METRICS, KIND_CORPORATE_COMPANIES):
        monkeypatch.delitem(kinds.KINDS, name)

    peers, skipped = files.read_peer_files(cloud, own_pc_id="PC-OLD-0001")

    assert peers == [], "an older reader accepted a file with an unknown kind; update the rollout notes"
    assert len(skipped) == 1 and "unknown kind 'corporate_metrics'" in skipped[0].reason
