from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest

from apps.api.services import db as db_service


def pytest_configure(config):
    if config.option.basetemp:
        return

    base = Path.cwd() / "data" / "cache" / "pytest-runs"
    base.mkdir(parents=True, exist_ok=True)
    config.option.basetemp = str(base / f"pytest-{os.getpid()}-{uuid4().hex}")


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear the process-wide StructuralMiddleware rate limiter between tests.

    apps/api/core/middleware.py:75 creates one RateLimiter instance for the
    life of the process, keyed by client IP -- TestClient always uses
    "testclient". Without a reset, token consumption from one test's HTTP
    calls carries into the next test (and the next file), so tests fail with
    429s depending on execution order and total request volume, not on their
    own logic. Route-specific "strict" sub-limiters are attached lazily as
    strict_<client_ip>_<path> attributes on the same object
    (middleware.py:94-96) and must be cleared too, or they stay dirty even
    after the top-level bucket is reset.
    """
    from apps.api.core.middleware import limiter

    def _clear():
        limiter.clients.clear()
        for name in [attr for attr in vars(limiter) if attr.startswith("strict_")]:
            delattr(limiter, name)

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _isolated_db(request, tmp_path, monkeypatch):
    """Give every test its own SQLite file instead of the developer's real one.

    apps/api/services/db.py:30 defines _DB_PATH as a module attribute read at
    call time, so pointing it at tmp_path redirects get_db() and init_db()
    for the duration of the test and unwinds automatically.

    Without this, tests read data/processed/moneyview.db -- 142 tickers and
    1,307 AAPL rows on a developer machine, empty on a fresh clone -- so a
    test asserting "this fetch was live" passes or fails depending on whose
    machine it runs on rather than on the code. That is what made
    test_market_data_emits_cache_and_provider_events alternate with an
    unrelated failure depending on execution order.

    virgin_db opts out of schema creation only, never out of path isolation:
    a test that exercises a migration needs an empty database file, not a
    shared one.
    """
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    if "virgin_db" not in request.keywords:
        db_service.init_db()
