"""The launcher's backend preflight: the Python version, the startup imports, and every dependency
pyproject.toml declares.

Checking only what the API imports at startup missed lazily imported packages: exchange_calendars is
imported by the event rules on the first /market/events request, so an environment installed before
it was added started fine and then failed every events request -- no events on any chart. A missing
package is reported as "No module named ...", which start_local.ps1's auto-install acts on.

Run from the repository root: python scripts/check_backend_deps.py
"""

from __future__ import annotations

import importlib.metadata as metadata
import re
import sys
import tomllib
from pathlib import Path

if sys.version_info < (3, 12):
    raise SystemExit(f"Python {sys.version.split()[0]} is too old; MoneyView needs 3.12 or newer")

import apps.api.main  # noqa: E402,F401 - the API must import

declared = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))["project"]["dependencies"]
names = [re.split(r"[<>=!~;\[ ]", requirement, maxsplit=1)[0] for requirement in declared]
missing = []
for name in names:
    try:
        metadata.version(name)
    except metadata.PackageNotFoundError:
        missing.append(name)
if missing:
    raise ModuleNotFoundError(f"No module named {', '.join(missing)} (declared in pyproject.toml, not installed)")
