"""Wiring: stamps, sync triggers and the status route (task 7). Copies the shape of
tests/api/watchlist_sync/test_routes.py.
"""

import json

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.db import get_db
from apps.api.services.peer_sync.model import BASELINE_TS
from apps.api.services.records_sync import files as records_files
from apps.api.services.records_sync import service as records_service
from apps.api.services.watchlist_sync import store as watchlist_store
from tests.api.test_valuation_routes import _seed_conservative_inputs, _seed_verdict_inputs
from tests.api.valuation_fixtures import _case_payload

client = TestClient(app)

CASES = "/api/v1/valuation/cases"
CONSERVATIVE = "/api/v1/valuation/conservative"
VERDICT = "/api/v1/valuation/verdict"
DECISIONS = "/api/v1/decisions"
EVENTS = "/api/v1/market/events"
CATEGORIES = "/api/v1/market/event-categories"
PREFERENCES = "/api/v1/portfolio/preferences"
STATUS = "/api/v1/sync/status"

PEER = "PC-PEER-0001"
PEER_TS = "2026-09-18T10:00:00.000Z"


def _enable(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    return root


def _own_pc_id():
    with get_db() as conn:
        return watchlist_store.get_or_create_pc_id(conn)


def _write_peer_records(root, records=(), removed=()):
    folder = root / "MoneyView"
    folder.mkdir(exist_ok=True)
    payload = {
        "format_version": 1,
        "pc_id": PEER,
        "written_at": PEER_TS,
        "records": [
            {"kind": kind, "uid": uid, "updated_at": PEER_TS, "updated_by": PEER, "payload": rec_payload}
            for kind, uid, rec_payload in records
        ],
        "removed": [
            {"kind": kind, "uid": uid, "removed_at": PEER_TS, "removed_by": PEER}
            for kind, uid in removed
        ],
    }
    (folder / f"records.{PEER}.json").write_text(json.dumps(payload), encoding="utf-8")


def _peer_case_payload(name="Peer Case"):
    return {
        "case": {"case_name": name, "ticker": "AAPL", "as_of_date": "2026-01-01", "base_year": 2026,
                 "target_year": 2031, "riskfree_rate": 0.03, "wacc_initial": 0.09,
                 "wacc_stable": 0.08, "wacc_converge_from": 5, "marginal_tax_rate": 0.21,
                 "nol_balance": 0.0, "roic_stable": 0.12, "terminal_growth": 0.02,
                 "effective_tax_rate": 0.18, "cash": 1.0, "debt": 0.0, "ipo_proceeds": 0.0,
                 "shares_basic": 10.0, "shares_new": 0.0, "parent_uid": None},
        "segments": [{"name": "core", "base_revenue": 100.0, "base_margin": 0.2, "tam_target": None,
                      "market_share_target": None, "revenue_target": 200.0, "margin_target": 0.25,
                      "sales_to_capital_early": 2.0, "sales_to_capital_late": 2.5,
                      "ramp_start_year": 1, "initial_growth": 0.2, "waypoint_gap_fraction": 0.5,
                      "narratives": [{"input_field": "revenue_target", "claim": "why",
                                      "evidence_source": None, "confidence": "assumed",
                                      "three_p": "plausible"}]}],
    }


def _peer_decision_payload():
    return {"ticker": "PEER", "decided_at": "2026-01-01T00:00:00.000Z", "action": "buy",
            "memo": "peer memo", "price_at_decision": 100.0, "dcf_value": 150.0,
            "dcf_implied_return": 0.5, "roic": 0.2, "wacc": 0.1, "risk_free_rate": 0.042,
            "equity_risk_premium": 0.055, "metric_schema_version": 1,
            "figures_source": "peer", "figures_unavailable_reason": None}


def _peer_event_payload():
    return {"label": "Peer Event", "category": "fomc", "start_date": "2026-01-01",
            "end_date": None, "source": None, "note": "", "created_at": "2026-01-01T00:00:00.000Z"}


def _peer_category_payload():
    return {"id": "user-peer", "kind": "user", "label": "Peer Category", "color": "#123456",
            "created_at": "2026-01-01T00:00:00.000Z"}


def _peer_preferences_payload():
    return {"total_investment_amount": 55555.0, "transaction_fee_rate": 0.002,
            "updated_at": "2026-01-01T00:00:00.000Z"}


def _event_body(**overrides):
    return {"label": "Event", "category": "fomc", "start_date": "2026-03-02", **overrides}


# --- read routes merge a peer file ----------------------------------------------------------


def test_get_valuation_cases_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    _write_peer_records(root, records=[("valuation_case", "peer-case", _peer_case_payload())])

    names = {row["case_name"] for row in client.get(CASES).json()["data"]}

    assert "Peer Case" in names


def test_get_decisions_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    _write_peer_records(root, records=[("investment_decision", "peer-decision", _peer_decision_payload())])

    tickers = {row["ticker"] for row in client.get(DECISIONS).json()["data"]}

    assert "PEER" in tickers


def test_get_market_events_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    _write_peer_records(root, records=[("user_event", "peer-event", _peer_event_payload())])

    labels = {row["label"] for row in client.get(EVENTS).json()}

    assert "Peer Event" in labels


def test_get_event_categories_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    _write_peer_records(root, records=[("event_category", "user-peer", _peer_category_payload())])

    ids = {row["id"] for row in client.get(CATEGORIES).json()}

    assert "user-peer" in ids


def test_get_valuation_verdict_merges_a_peer_file(tmp_path, monkeypatch):
    """valuation_verdict.build_verdict's DCF-gap row reads a stored conservative case
    (company_baseline.find_conservative_case_id + valuation_case.run_stored_case), so the verdict
    route reads a synced record just like the other record-read routes and must trigger a records
    read sync -- or a peer's case never appears here, only after some other route happens to sync.
    """
    _seed_verdict_inputs(ticker="AAPL")
    root = _enable(tmp_path, monkeypatch)
    _write_peer_records(root, records=[("valuation_case", "peer-case", _peer_case_payload())])

    response = client.get(f"{VERDICT}/AAPL")

    assert response.status_code == 200, response.text
    with get_db() as conn:
        names = {row["case_name"] for row in conn.execute("SELECT case_name FROM valuation_case")}
    assert "Peer Case" in names


def test_get_portfolio_preferences_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    _write_peer_records(root, records=[
        ("portfolio_preferences", "portfolio_preferences", _peer_preferences_payload())
    ])

    data = client.get(PREFERENCES).json()["data"]

    assert data["total_investment_amount"] == 55555.0


# --- a write is stamped and published ---------------------------------------------------------


def test_creating_a_case_publishes_it(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)

    response = client.post(CASES, json=_case_payload(case_name="Published"))

    assert response.status_code == 200, response.text
    assert records_service.current_status().last_error is None
    pc_id = _own_pc_id()
    published = json.loads(records_files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    names = {r["payload"]["case"]["case_name"] for r in published["records"] if r["kind"] == "valuation_case"}
    assert "Published" in names


def test_creating_a_conservative_case_publishes_it(tmp_path, monkeypatch):
    """Spec S6: any create, edit or delete triggers a sync. create_conservative_case creates
    through create_case (so it is stamped) but did not call run_records_sync itself -- unlike
    the plain create and fork routes. Uses the same local-DB seeding as the existing conservative
    route tests (tests/api/test_valuation_routes.py) so it needs no network access.
    """
    _seed_conservative_inputs(ticker="SYNCED")
    root = _enable(tmp_path, monkeypatch)

    response = client.post(f"{CONSERVATIVE}/SYNCED")

    assert response.status_code == 200, response.text
    case_id = response.json()["data"]["id"]
    with get_db() as conn:
        case_name = conn.execute(
            "SELECT case_name FROM valuation_case WHERE id = ?", (case_id,)
        ).fetchone()["case_name"]
    pc_id = _own_pc_id()
    published = json.loads(records_files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    names = {r["payload"]["case"]["case_name"] for r in published["records"] if r["kind"] == "valuation_case"}
    assert case_name in names


def test_creating_an_event_is_stamped_with_a_causal_timestamp_not_the_baseline(tmp_path, monkeypatch):
    """A write's own stamp() call must run before sync's ensure_first_sync backstop does, and
    must give the record a fresh causal timestamp -- not rely on that backstop's BASELINE_TS. The
    file-reflects-the-change assertions above are not enough to catch a dropped stamp here: the
    post-write sync's own ensure_first_sync fills in a missing stamp at BASELINE_TS regardless,
    so the record is still published either way. Only the timestamp's VALUE tells them apart, and
    a BASELINE_TS stamp would let an older peer version silently outrank this brand new event.
    """
    _enable(tmp_path, monkeypatch)

    created = client.post(EVENTS, json=_event_body(label="Stamped")).json()

    number = int(created["id"].removeprefix("user-"))
    with get_db() as conn:
        uid = conn.execute("SELECT sync_uid FROM user_event WHERE id = ?", (number,)).fetchone()[0]
        row = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'user_event' AND uid = ?", (uid,)
        ).fetchone()
    assert row is not None and row["updated_at"] != BASELINE_TS


def test_creating_a_decision_is_stamped_with_a_causal_timestamp_not_the_baseline(tmp_path, monkeypatch):
    """Same guard as the event test above, for investment_decision.record_decision."""
    _enable(tmp_path, monkeypatch)

    response = client.post(DECISIONS, json={"ticker": "MSFT", "action": "watch", "memo": "m"})

    decision_id = response.json()["data"]["id"]
    with get_db() as conn:
        uid = conn.execute("SELECT sync_uid FROM investment_decision WHERE id = ?", (decision_id,)).fetchone()[0]
        row = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'investment_decision' AND uid = ?", (uid,)
        ).fetchone()
    assert row is not None and row["updated_at"] != BASELINE_TS


def test_creating_a_category_is_stamped_with_a_causal_timestamp_not_the_baseline(tmp_path, monkeypatch):
    """Same guard as the event test above, for events/store.insert_user_category."""
    _enable(tmp_path, monkeypatch)

    created = client.post(CATEGORIES, json={"label": "Stamped Category", "color": "#123456"}).json()

    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'event_category' AND uid = ?", (created["id"],)
        ).fetchone()
    assert row is not None and row["updated_at"] != BASELINE_TS


def test_setting_visibility_is_stamped_with_a_causal_timestamp_not_the_baseline(tmp_path, monkeypatch):
    """Same guard as the event test above, for events/store.set_visibility."""
    _enable(tmp_path, monkeypatch)

    response = client.patch(f"{CATEGORIES}/fomc", json={"visible": False})

    assert response.status_code == 200, response.text
    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'event_category_visibility' AND uid = 'fomc'"
        ).fetchone()
    assert row is not None and row["updated_at"] != BASELINE_TS


def test_saving_preferences_is_stamped_with_a_causal_timestamp_not_the_baseline(tmp_path, monkeypatch):
    """Same guard as the event test above, for PUT /portfolio/preferences."""
    _enable(tmp_path, monkeypatch)

    response = client.put(PREFERENCES, json={
        "total_investment_amount": 12345.0, "transaction_fee_rate": 0.002, "updated_at": ""
    })

    assert response.status_code == 200, response.text
    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'portfolio_preferences' "
            "AND uid = 'portfolio_preferences'"
        ).fetchone()
    assert row is not None and row["updated_at"] != BASELINE_TS


def test_updating_an_event_restamps_it_with_a_later_timestamp(tmp_path, monkeypatch):
    """The INSERT-time stamp is not enough: an UPDATE's own stamp() call must run too, or the
    record stays at its creation-time stamp forever and a peer's older edit -- made after this
    record was created but before this PC's edit -- would silently outrank a newer local change.
    """
    _enable(tmp_path, monkeypatch)
    created = client.post(EVENTS, json=_event_body(label="Original")).json()
    number = int(created["id"].removeprefix("user-"))
    with get_db() as conn:
        uid = conn.execute("SELECT sync_uid FROM user_event WHERE id = ?", (number,)).fetchone()[0]
        before = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'user_event' AND uid = ?", (uid,)
        ).fetchone()["updated_at"]

    response = client.put(f"{EVENTS}/{created['id']}", json=_event_body(label="Edited"))

    assert response.status_code == 200, response.text
    with get_db() as conn:
        after = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'user_event' AND uid = ?", (uid,)
        ).fetchone()["updated_at"]
    assert after > before


def test_overriding_a_builtin_category_is_stamped_with_a_causal_timestamp_not_the_baseline(tmp_path, monkeypatch):
    """upsert_category_override has no separate insert step -- its first write on a category
    nobody has overridden locally IS the upsert -- so this checks the same BASELINE_TS masking
    risk the other causal-timestamp tests check, for events/store.upsert_category_override.
    """
    _enable(tmp_path, monkeypatch)

    response = client.patch(f"{CATEGORIES}/fomc", json={"label": "Overridden"})

    assert response.status_code == 200, response.text
    pc_id = _own_pc_id()
    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at, updated_by FROM record_sync WHERE kind = 'event_category' AND uid = 'fomc'"
        ).fetchone()
    assert row is not None and row["updated_at"] != BASELINE_TS
    assert row["updated_by"] == pc_id


def test_updating_a_user_category_restamps_it_with_a_later_timestamp(tmp_path, monkeypatch):
    """Same no-restamp guard as the event update test above, for update_user_category."""
    _enable(tmp_path, monkeypatch)
    created = client.post(CATEGORIES, json={"label": "Original", "color": "#111111"}).json()
    with get_db() as conn:
        before = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'event_category' AND uid = ?", (created["id"],)
        ).fetchone()["updated_at"]

    response = client.patch(f"{CATEGORIES}/{created['id']}", json={"label": "Edited"})

    assert response.status_code == 200, response.text
    with get_db() as conn:
        after = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'event_category' AND uid = ?", (created["id"],)
        ).fetchone()["updated_at"]
    assert after > before


# --- tombstones only while sync is on; timestamps regardless ----------------------------------


def test_a_delete_records_a_tombstone_only_while_sync_is_on(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    off = client.post(EVENTS, json=_event_body(label="Off")).json()
    client.delete(f"{EVENTS}/{off['id']}")

    _enable(tmp_path, monkeypatch)
    on = client.post(EVENTS, json=_event_body(label="On")).json()
    client.delete(f"{EVENTS}/{on['id']}")

    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM record_sync WHERE kind = 'user_event' AND removed_at IS NOT NULL"
        ).fetchone()[0]
    assert count == 1


def test_timestamps_are_kept_with_sync_off(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)

    response = client.post(CASES, json=_case_payload(case_name="Offline"))

    assert response.status_code == 200, response.text
    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at, updated_by FROM record_sync WHERE kind = 'valuation_case' "
            "AND uid = (SELECT sync_uid FROM valuation_case WHERE case_name = 'Offline')"
        ).fetchone()
    assert row["updated_at"] and row["updated_by"]


# --- a delete that removes nothing publishes no tombstone --------------------------------------


def test_resetting_a_category_with_no_override_writes_no_tombstone(tmp_path, monkeypatch):
    """'Reset to default' on a built-in category nobody has overridden locally deletes zero rows,
    so it must not publish a tombstone for it -- that would tell every peer this PC actively
    removed an override that never existed here."""
    _enable(tmp_path, monkeypatch)

    response = client.delete(f"{CATEGORIES}/fomc/override")

    assert response.status_code == 204, response.text
    with get_db() as conn:
        row = conn.execute(
            "SELECT removed_at FROM record_sync WHERE kind = 'event_category' AND uid = 'fomc'"
        ).fetchone()
    assert row is None or row["removed_at"] is None


def test_deleting_a_user_category_with_no_visibility_row_writes_no_visibility_tombstone(tmp_path, monkeypatch):
    """A user category nobody ever set the visibility of has no visibility row to delete, so
    deleting the category must not tombstone a visibility record that never existed."""
    _enable(tmp_path, monkeypatch)
    created = client.post(CATEGORIES, json={"label": "No Visibility", "color": "#abcdef"}).json()

    response = client.delete(f"{CATEGORIES}/{created['id']}")

    assert response.status_code == 204, response.text
    with get_db() as conn:
        row = conn.execute(
            "SELECT removed_at FROM record_sync WHERE kind = 'event_category_visibility' AND uid = ?",
            (created["id"],),
        ).fetchone()
    assert row is None or row["removed_at"] is None


def test_resetting_an_existing_override_still_tombstones_it(tmp_path, monkeypatch):
    """A real deletion -- an override that does exist locally -- still tombstones normally."""
    _enable(tmp_path, monkeypatch)
    client.patch(f"{CATEGORIES}/fomc", json={"label": "Overridden"})

    response = client.delete(f"{CATEGORIES}/fomc/override")

    assert response.status_code == 204, response.text
    with get_db() as conn:
        row = conn.execute(
            "SELECT removed_at FROM record_sync WHERE kind = 'event_category' AND uid = 'fomc'"
        ).fetchone()
    assert row is not None and row["removed_at"] is not None


def test_deleting_a_user_category_with_a_visibility_row_still_tombstones_both(tmp_path, monkeypatch):
    """A real deletion of both the category and its visibility row still tombstones both."""
    _enable(tmp_path, monkeypatch)
    created = client.post(CATEGORIES, json={"label": "With Visibility", "color": "#abcdef"}).json()
    client.patch(f"{CATEGORIES}/{created['id']}", json={"visible": False})

    response = client.delete(f"{CATEGORIES}/{created['id']}")

    assert response.status_code == 204, response.text
    with get_db() as conn:
        category_tomb = conn.execute(
            "SELECT removed_at FROM record_sync WHERE kind = 'event_category' AND uid = ?", (created["id"],)
        ).fetchone()
        visibility_tomb = conn.execute(
            "SELECT removed_at FROM record_sync WHERE kind = 'event_category_visibility' AND uid = ?",
            (created["id"],),
        ).fetchone()
    assert category_tomb is not None and category_tomb["removed_at"] is not None
    assert visibility_tomb is not None and visibility_tomb["removed_at"] is not None


# --- the status route is read-only and reports both halves ------------------------------------


def test_get_sync_status_is_read_only(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    client.post(CASES, json=_case_payload(case_name="Baseline"))
    pc_id = _own_pc_id()
    own_path = records_files.own_file_path(root, pc_id)
    with get_db() as conn:
        before_rows = [tuple(r) for r in conn.execute("SELECT * FROM valuation_case ORDER BY id")]
    before_mtime = own_path.stat().st_mtime_ns

    response = client.get(STATUS)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert "watchlist" in data and "records" in data
    with get_db() as conn:
        after_rows = [tuple(r) for r in conn.execute("SELECT * FROM valuation_case ORDER BY id")]
    assert after_rows == before_rows
    assert own_path.stat().st_mtime_ns == before_mtime


# --- each mutation runs its sync after its own transaction commits ----------------------------


def test_creating_a_case_runs_its_sync_after_its_own_transaction_commits(tmp_path, monkeypatch):
    """Guards the no-self-deadlock rule: run_records_sync must run only after the route's own
    `with get_db()` block has committed. Called from inside that block instead, its
    `BEGIN IMMEDIATE` would wait out SQLite's ~5s busy timeout against the still-open write lock
    and record "database is locked" as last_error, instead of publishing.
    """
    root = _enable(tmp_path, monkeypatch)

    response = client.post(CASES, json=_case_payload(case_name="Deadlock"))

    assert response.status_code == 200, response.text
    assert records_service.current_status().last_error is None
    pc_id = _own_pc_id()
    published = json.loads(records_files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    names = {r["payload"]["case"]["case_name"] for r in published["records"] if r["kind"] == "valuation_case"}
    assert "Deadlock" in names


def test_creating_an_event_runs_its_sync_after_its_own_transaction_commits(tmp_path, monkeypatch):
    """Same no-self-deadlock guard, for create_market_event."""
    root = _enable(tmp_path, monkeypatch)

    response = client.post(EVENTS, json=_event_body(label="Deadlock"))

    assert response.status_code == 201, response.text
    assert records_service.current_status().last_error is None
    pc_id = _own_pc_id()
    published = json.loads(records_files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    labels = {r["payload"]["label"] for r in published["records"] if r["kind"] == "user_event"}
    assert "Deadlock" in labels


def test_saving_preferences_runs_its_sync_after_its_own_transaction_commits(tmp_path, monkeypatch):
    """Same no-self-deadlock guard, for PUT /portfolio/preferences."""
    root = _enable(tmp_path, monkeypatch)

    response = client.put(PREFERENCES, json={
        "total_investment_amount": 42424.0, "transaction_fee_rate": 0.002, "updated_at": ""
    })

    assert response.status_code == 200, response.text
    assert records_service.current_status().last_error is None
    pc_id = _own_pc_id()
    published = json.loads(records_files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    [pref] = [r for r in published["records"] if r["kind"] == "portfolio_preferences"]
    assert pref["payload"]["total_investment_amount"] == 42424.0


# --- startup and failure isolation --------------------------------------------------------------


def test_startup_with_an_unavailable_folder_still_starts(tmp_path, monkeypatch):
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))
    monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    with TestClient(app) as started:
        assert started.get("/api/v1/healthz").status_code == 200
        # Proves the records startup sync actually ran (not just that healthz answers): the
        # folder is unavailable, so a startup sync that ran must have recorded that as an error.
        assert records_service.current_status().last_error


def test_a_records_failure_does_not_break_a_page(tmp_path, monkeypatch):
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))

    for path in (CASES, DECISIONS, EVENTS, CATEGORIES, PREFERENCES):
        assert client.get(path).status_code == 200, path
