from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4


def pytest_configure(config):
    if config.option.basetemp:
        return

    base = Path.cwd() / "data" / "cache" / "pytest-runs"
    base.mkdir(parents=True, exist_ok=True)
    config.option.basetemp = str(base / f"pytest-{os.getpid()}-{uuid4().hex}")
