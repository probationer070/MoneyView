from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest


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
