"""The corporate write paths reach the other PC and apply there as the owner's assumptions
(spec 2026-10-15 §3, test §4.8; plan Review Focus 4).
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import CorporateCompany, CorporateMetrics
from apps.api.services import corporate_metrics_service
from apps.api.services.db import get_db
from apps.api.services.peer_sync.model import SEED_TS
from apps.api.services.records_sync import files, store
from apps.api.services.records_sync import service as records_sync
from apps.api.services.records_sync.kinds import KIND_CORPORATE_COMPANIES, KIND_CORPORATE_METRICS
from apps.api.services.watchlist_sync import store as watchlist_store
from tests.api.records_sync.test_service import PC, cloud  # noqa: F401 - cloud is a pytest fixture


def save(pc, ticker, growth):
    pc.use()
    corporate_metrics_service.save_metrics(ticker, CorporateMetrics(ticker=ticker, growth=growth, roic=21.0))


def add(pc, ticker, name):
    pc.use()
    corporate_metrics_service.add_company(CorporateCompany(ticker=ticker, name=name, sector="Energy"))


def growth_on(pc, ticker):
    pc.use()
    with get_db() as conn:
        row = conn.execute("SELECT growth FROM corporate_metrics WHERE ticker = ?", (ticker,)).fetchone()
    return None if row is None else row["growth"]


def company_name_on(pc, ticker):
    pc.use()
    with get_db() as conn:
        row = conn.execute("SELECT name FROM corporate_companies WHERE ticker = ?", (ticker,)).fetchone()
    return None if row is None else row["name"]


def published_keys(root) -> set[tuple[str, str]]:
    with get_db() as conn:
        pc_id = watchlist_store.get_or_create_pc_id(conn)
    path = files.own_file_path(root, pc_id)
    assert path.exists(), "the write route did not publish this PC's records file"
    return {(r["kind"], r["uid"]) for r in json.loads(path.read_text(encoding="utf-8"))["records"]}


def record_sync_row(conn, kind, uid):
    return conn.execute(
        "SELECT updated_at, updated_by, removed_at FROM record_sync WHERE kind = ? AND uid = ?", (kind, uid)
    ).fetchone()


def test_a_saved_assumption_arrives_on_pc_b_and_applies_as_the_owners_assumption(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(a, "AAPL", 12.5)
    a.sync(); b.sync()

    b.use()
    applied, is_saved = corporate_metrics_service.load_fallback_metrics("AAPL")
    assert is_saved, "the synced row is not used as a saved assumption on PC B"
    assert applied.growth == 12.5 and applied.roic == 21.0


def test_when_both_pcs_saved_the_later_save_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(a, "AAPL", 9.0)
    a.sync(); b.sync()
    save(b, "AAPL", 11.0)  # later; sorts below 9.0, so an unstamped edit would lose the tiebreak
    b.sync(); a.sync()
    assert growth_on(a, "AAPL") == 11.0 and growth_on(b, "AAPL") == 11.0, "the later save_metrics did not win"


def test_when_both_pcs_added_the_same_company_the_later_add_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    add(a, "ZZPV", "Zeta")
    a.sync(); b.sync()
    add(b, "ZZPV", "Alpha")
    b.sync(); a.sync()
    assert company_name_on(a, "ZZPV") == "Alpha" and company_name_on(b, "ZZPV") == "Alpha", \
        "the later add_company did not win"


def test_adding_a_company_never_overwrites_assumptions_saved_on_another_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(b, "LEU", 20.0)
    b.sync()
    add(a, "LEU", "Centrus Energy")  # A has not received B's LEU yet, so it inserts defaults
    a.sync(); b.sync()
    assert growth_on(a, "LEU") == 20.0 and growth_on(b, "LEU") == 20.0, \
        "add_company's default metrics overwrote an assumption saved on the other PC"


def test_saving_through_the_route_publishes_the_record(cloud):
    body = CorporateMetrics(ticker="AAPL", growth=12.5).model_dump(mode="json")
    response = TestClient(app).put("/api/v1/corporate/metrics/AAPL", json=body)
    assert response.status_code == 200, response.text
    assert ("corporate_metrics", "AAPL") in published_keys(cloud)


def test_adding_a_company_through_the_route_publishes_both_records(cloud):
    response = TestClient(app).post("/api/v1/corporate/companies",
                                    json={"ticker": "ZZPV", "name": "Private Co", "sector": ""})
    assert response.status_code == 200, response.text
    keys = published_keys(cloud)
    assert {("corporate_companies", "ZZPV"), ("corporate_metrics", "ZZPV")} <= keys


# -- Review additions (Task 6 review) -------------------------------------------------------------


def test_stamp_seed_with_no_prior_stamp_writes_seed_ts_for_this_pc():
    with get_db() as conn:
        store.stamp_seed(conn, KIND_CORPORATE_METRICS, "LEU", "PC-A")
        row = record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU")
    assert row["updated_at"] == SEED_TS, "a seed stamp is not SEED_TS"
    assert row["updated_by"] == "PC-A", "a seed stamp does not name the PC that created the row"
    assert row["removed_at"] is None, "a seed stamp carries a tombstone"


def test_stamp_seed_leaves_an_existing_real_stamp_alone():
    with get_db() as conn:
        store.stamp(conn, KIND_CORPORATE_METRICS, "LEU", "PC-B")
        before = dict(record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU"))
        store.stamp_seed(conn, KIND_CORPORATE_METRICS, "LEU", "PC-A")
        after = dict(record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU"))
    assert before["updated_at"] != SEED_TS, "the setup did not create a real stamp"
    assert after == before, "stamp_seed overwrote a real stamp"


def test_b_adjusts_leu_and_a_adds_it_before_syncing_both_end_with_b_values(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(b, "LEU", 20.0)
    b.sync()
    add(a, "LEU", "Centrus Energy")
    a.sync(); b.sync(); a.sync()
    assert growth_on(a, "LEU") == 20.0 and growth_on(b, "LEU") == 20.0, \
        "after both PCs synced, the add_company default still shadows B's adjustment"


def test_re_adding_a_company_after_sync_does_not_downgrade_its_metrics_stamp(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(a, "LEU", 20.0)
    a.sync(); b.sync()
    a.use()
    with get_db() as conn:
        before = dict(record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU"))
    add(a, "LEU", "Centrus Energy")
    a.sync(); b.sync()
    a.use()
    with get_db() as conn:
        after = dict(record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU"))
    assert before["updated_at"] != SEED_TS, "the setup did not create a real stamp"
    assert after["updated_at"] == before["updated_at"], "re-adding the company changed the metrics stamp"
    assert growth_on(a, "LEU") == 20.0 and growth_on(b, "LEU") == 20.0


def test_the_company_row_from_add_company_gets_a_real_stamp_not_a_seed():
    corporate_metrics_service.add_company(CorporateCompany(ticker="ZZPV", name="Private Co"))
    with get_db() as conn:
        row = dict(record_sync_row(conn, KIND_CORPORATE_COMPANIES, "ZZPV"))
        pc_id = watchlist_store.get_or_create_pc_id(conn)
    assert row["updated_at"] != SEED_TS, "the added company was stamped as a seed"
    assert row["updated_by"] == pc_id and row["removed_at"] is None


def test_save_metrics_normalises_a_padded_lowercase_ticker_to_one_record():
    corporate_metrics_service.save_metrics("  aapl ", CorporateMetrics(ticker="  aapl ", growth=9.0))
    with get_db() as conn:
        sync_uids = [r["uid"] for r in conn.execute(
            "SELECT uid FROM record_sync WHERE kind = ?", (KIND_CORPORATE_METRICS,))]
        table_tickers = [r["ticker"] for r in conn.execute("SELECT ticker FROM corporate_metrics")]
    assert sync_uids == ["AAPL"], f"a padded ticker created a second synced record: {sync_uids}"
    assert table_tickers == ["AAPL"], f"the metrics row was stored under {table_tickers}"


def test_a_failing_sync_never_fails_the_save_or_the_add(tmp_path, monkeypatch):
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "missing-folder"))
    client = TestClient(app)
    saved = client.put("/api/v1/corporate/metrics/AAPL",
                       json=CorporateMetrics(ticker="AAPL", growth=12.5).model_dump(mode="json"))
    added = client.post("/api/v1/corporate/companies", json={"ticker": "ZZPV", "name": "Private Co", "sector": ""})
    assert saved.status_code == 200, saved.text
    assert added.status_code == 200, added.text
    assert records_sync.current_status().last_error, "the sync failure was not recorded in the status"
    assert growth_on_local("AAPL") == 12.5
    assert company_name_local("ZZPV") == "Private Co"


def growth_on_local(ticker):
    with get_db() as conn:
        row = conn.execute("SELECT growth FROM corporate_metrics WHERE ticker = ?", (ticker,)).fetchone()
    return None if row is None else row["growth"]


def company_name_local(ticker):
    with get_db() as conn:
        row = conn.execute("SELECT name FROM corporate_companies WHERE ticker = ?", (ticker,)).fetchone()
    return None if row is None else row["name"]


def test_re_adding_a_company_never_seeds_an_unstamped_saved_row():
    # A metrics row saved before this version (or before the first sync): real updated_at, no record_sync.
    with get_db() as conn:
        conn.execute(
            "INSERT INTO corporate_metrics (ticker, growth, updated_at) VALUES ('LEU', 20.0, '2026-10-05T00:00:00+00:00')"
        )
    add_company_result = corporate_metrics_service.add_company(CorporateCompany(ticker="LEU", name="Centrus Energy"))
    assert add_company_result.ticker == "LEU"
    with get_db() as conn:
        after_add = record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU")
    assert after_add is None, \
        f"re-adding a company seeded a stamp onto an unstamped saved row: {dict(after_add) if after_add else None}"

    # The first sync stamps the row from its own updated_at, not from SEED_TS.
    with get_db() as conn:
        store.ensure_first_sync(conn, watchlist_store.get_or_create_pc_id(conn))
        stamped = record_sync_row(conn, KIND_CORPORATE_METRICS, "LEU")
    assert stamped["updated_at"] == "2026-10-05T00:00:00.000Z", \
        f"the first sync did not stamp the saved row from its own updated_at: {stamped['updated_at']}"
