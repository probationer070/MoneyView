from __future__ import annotations

import os
import socket
import sqlite3
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


@pytest.fixture(autouse=True, scope="session")
def _forbid_network():
    """Fail any test that opens a non-loopback socket.

    Two of the six inherited failures were caused by tests silently reaching
    yfinance: results depended on network weather and on whether the developer's
    cache happened to be warm. That was only ever caught by noticing a suite that
    took 403 seconds, which is not a control. This makes the plan's "no test may
    make a network call" constraint enforced rather than merely asserted.

    Loopback is allowed: apps/api/main.py's find_available_port probes 127.0.0.1
    and must keep working. There is deliberately no opt-out marker -- a test that
    genuinely needs the network should be a visible edit to this fixture, not a
    decorator someone reaches for under deadline.
    """
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo
    local = {"127.0.0.1", "::1", "localhost"}

    def _host_of(address):
        return str(address[0]) if isinstance(address, tuple) and address else str(address)

    def guarded_connect(self, address, *args, **kwargs):
        if _host_of(address) not in local:
            raise AssertionError(f"test made a network call to {_host_of(address)}")
        return real_connect(self, address, *args, **kwargs)

    def guarded_connect_ex(self, address, *args, **kwargs):
        if _host_of(address) not in local:
            raise AssertionError(f"test made a network call to {_host_of(address)}")
        return real_connect_ex(self, address, *args, **kwargs)

    def guarded_getaddrinfo(host, *args, **kwargs):
        if str(host) not in local:
            raise AssertionError(f"test resolved {host} -- network calls are not allowed")
        return real_getaddrinfo(host, *args, **kwargs)

    # curl_cffi drives libcurl through cffi and never touches Python's socket
    # module, so the three patches above are blind to it. yfinance 1.2 uses it
    # as its HTTP transport -- exactly the traffic this fixture exists to stop.
    # Found on 2026-07-29: a test reached the real Yahoo API with all three
    # socket patches active. Curl.perform is the single chokepoint every
    # curl_cffi request funnels through, sync or async. Nothing in this project
    # uses curl_cffi for anything local, so every call through it is a network
    # call and is refused outright.
    try:
        from curl_cffi import Curl
    except ImportError:  # pragma: no cover - curl_cffi arrives with yfinance
        Curl = None
    else:
        real_perform = Curl.perform

        def guarded_perform(self, *args, **kwargs):
            raise AssertionError(
                "test made a network call through curl_cffi -- network calls are not allowed"
            )

        Curl.perform = guarded_perform

    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.getaddrinfo = guarded_getaddrinfo
    yield
    socket.socket.connect = real_connect
    socket.socket.connect_ex = real_connect_ex
    socket.getaddrinfo = real_getaddrinfo
    if Curl is not None:
        Curl.perform = real_perform


@pytest.fixture(autouse=True, scope="session")
def _forbid_the_real_database():
    """Fail any test that opens data/processed/moneyview.db.

    _isolated_db redirects _DB_PATH, but a test that builds its own connection
    string bypasses it entirely -- which is how the suite came to depend on one
    developer's 142 tickers and 1,307 AAPL rows without anyone noticing. Checking
    the file's mtime by hand after a run is not a control either.
    """
    real_connect = sqlite3.connect
    forbidden = (Path.cwd() / "data" / "processed" / "moneyview.db").resolve()

    def guarded_connect(database, *args, **kwargs):
        if str(database) != ":memory:" and Path(str(database)).resolve() == forbidden:
            raise AssertionError(f"test opened the real database at {forbidden}")
        return real_connect(database, *args, **kwargs)

    sqlite3.connect = guarded_connect
    yield
    sqlite3.connect = real_connect


@pytest.fixture(autouse=True, scope="session")
def _disable_startup_jobs():
    """Stop the FastAPI lifespan starting its live-data warmers under pytest.

    corporate_snapshot_cycle and stock_prewarm_cycle both fetch from the
    network on startup, and prewarm's asyncio.to_thread worker cannot be
    cancelled -- it outlives the TestClient block that started it and keeps
    emitting into the dev-monitor sink, evicting the events a test asserts on
    from its fixed recent(limit=N) window. Session-scoped and set before any
    TestClient is constructed.
    """
    os.environ["MONEYVIEW_DISABLE_STARTUP_JOBS"] = "1"
    yield
    os.environ.pop("MONEYVIEW_DISABLE_STARTUP_JOBS", None)
