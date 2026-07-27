import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import db as db_service
from apps.api.services.acquisition.state import AcquisitionStatus, read_state

TICKER = "TESTTRIG"
PAYLOAD = {"ticker": TICKER, "name": "Trigger Test", "sector": "Tech",
           "group_name": "custom", "weight": 1.0}


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point db_service._DB_PATH at a temp file so these tests never touch the
    real project database, and so a fresh clone/CI run has acquisition_state
    without needing init_db() run by hand."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()


@pytest.fixture(autouse=True)
def _no_real_acquisition(monkeypatch):
    """Every test here POSTs to /watchlist, which schedules acquisition for real. Left
    unpatched that spawns a thread which fetches TESTTRIG live from Yahoo -- a network
    call from the test suite, for a ticker that does not exist. Global constraint: no
    test may make a network call.
    """
    scheduled: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "apps.api.routes.portfolio.schedule_acquisition",
        lambda data_class, subject: scheduled.append((data_class, subject)),
    )
    return scheduled


def test_adding_a_watchlist_item_schedules_acquisition(_no_real_acquisition):
    """Today POST /watchlist writes one row and returns, acquiring nothing -- so the
    natural acquisition event triggers no acquisition and every fetch instead happens
    in-band while a user waits."""
    client = TestClient(app)
    response = client.post("/api/v1/portfolio/watchlist", json=PAYLOAD)
    assert response.status_code == 200
    assert ("equity_bars", TICKER) in _no_real_acquisition


def test_editing_an_existing_item_does_not_reschedule_acquisition(_no_real_acquisition):
    """POST /watchlist is an upsert, and the web client calls it for pure metadata and
    weight edits -- a sector change, the "normalize allocations" loop, the allocation
    auto-save loop. Each schedule spawns a daemon thread that fetches live, so firing per
    edit turns one bulk allocation change into N concurrent provider fetches. Concurrent
    live fetching is what earned a Yahoo rate limit that invalidated a day of
    measurements (sources/bars.py) -- a hard rule, not a convenience."""
    client = TestClient(app)
    client.post("/api/v1/portfolio/watchlist", json=PAYLOAD)
    edited = {**PAYLOAD, "weight": 0.25}
    response = client.post("/api/v1/portfolio/watchlist", json=edited)

    assert response.status_code == 200
    # The edit must still be persisted: the guard suppresses acquisition, not the write.
    assert response.json()["weight"] == 0.25
    assert _no_real_acquisition.count(("equity_bars", TICKER)) == 1


def test_a_scheduling_failure_does_not_fail_the_request(monkeypatch):
    """Acquisition is best-effort and off the request path, so a scheduling failure must
    never fail a user's watchlist write. Design 10: no acquisition failure propagates
    into a request."""
    def _explode(data_class, subject):
        raise RuntimeError("scheduling is broken")

    monkeypatch.setattr("apps.api.routes.portfolio.schedule_acquisition", _explode)
    client = TestClient(app)
    response = client.post("/api/v1/portfolio/watchlist", json=PAYLOAD)
    assert response.status_code == 200
    # 200 alone would also be returned by an implementation that swallowed the write, so
    # assert the row the user actually asked for is on disk.
    with db_service.get_db() as conn:
        row = conn.execute("SELECT weight FROM watchlist WHERE ticker = ?", (TICKER,)).fetchone()
    assert row is not None
    assert row["weight"] == PAYLOAD["weight"]


def test_a_retire_failure_does_not_fail_the_delete(monkeypatch):
    """The delete-side half of the same guarantee: the row is already gone by the time
    retire runs, so letting a retire failure surface would report a failed delete for an
    operation that succeeded."""
    def _explode(data_class, subject):
        raise RuntimeError("retire is broken")

    client = TestClient(app)
    client.post("/api/v1/portfolio/watchlist", json=PAYLOAD)
    monkeypatch.setattr("apps.api.routes.portfolio.retire_subject", _explode)
    response = client.delete(f"/api/v1/portfolio/watchlist/{TICKER}")

    assert response.status_code == 200
    with db_service.get_db() as conn:
        assert conn.execute(
            "SELECT ticker FROM watchlist WHERE ticker = ?", (TICKER,)
        ).fetchone() is None


def test_removing_a_watchlist_item_marks_it_no_longer_refreshed():
    client = TestClient(app)
    client.post("/api/v1/portfolio/watchlist", json=PAYLOAD)
    response = client.delete(f"/api/v1/portfolio/watchlist/{TICKER}")
    assert response.status_code == 200
    assert read_state("equity_bars", TICKER).status == AcquisitionStatus.RETIRED
