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


def test_removing_a_watchlist_item_marks_it_no_longer_refreshed():
    client = TestClient(app)
    client.post("/api/v1/portfolio/watchlist", json=PAYLOAD)
    response = client.delete(f"/api/v1/portfolio/watchlist/{TICKER}")
    assert response.status_code == 200
    assert read_state("equity_bars", TICKER).status == AcquisitionStatus.RETIRED
