# tests package
"""Arms a refusal, AT IMPORT TIME, against writing to the real database.

Every other database guard in this suite is a pytest FIXTURE -- `_isolated_db`
redirects `db_service._DB_PATH` to a tmp file, `_forbid_the_real_database`
patches `sqlite3.connect` -- and all of them are inert the moment a test module
is imported and its helpers are called from a plain script. On 2026-09-03 that
gap put 260 synthetic bars and a quote-facts row for TGT, plus a whole
fabricated Damodaran vintage, into `data/processed/moneyview.db`. TGT is a real
ticker, and the fabricated vintage made the trailing-PE row stop refusing and
start publishing a plausible number with an authoritative-looking source. See
`ERROR-LOG.md`, 2026-09-03.

The fix has to be armed by the same act that makes the helpers reachable, which
is the import itself -- not by the runner, which is what was missing. Importing
any `tests.*` module executes this file, so the 20 test modules that INSERT are
covered without each having to remember.

Under pytest this changes nothing: `_isolated_db` already points `_DB_PATH` at a
tmp file, so the guarded path is never requested, and `_forbid_the_real_database`
enforces the identical policy a second time. It is deliberately NOT bypassable --
no test has a legitimate reason to write to the developer's real database, so an
opt-out would only ever be reached for the wrong reason.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

# Resolved from THIS FILE's location, not `Path.cwd()`. An ad-hoc script is
# exactly the situation this guard exists for, and such a script can be launched
# from anywhere; a cwd-relative path would silently stop matching and the guard
# would wave the write through.
_REAL_DB = Path(__file__).resolve().parent.parent / "data" / "processed" / "moneyview.db"


def _install_real_database_guard() -> None:
    # Idempotent: `tests/__init__.py` is imported once per process, but a
    # re-import (importlib.reload, a nested test runner) must not wrap the
    # wrapper -- each layer would re-resolve the path on every connect.
    if getattr(sqlite3.connect, "_moneyview_guard", False):
        return

    unguarded_connect = sqlite3.connect

    def guarded_connect(database, *args, **kwargs):
        if str(database) != ":memory:":
            try:
                is_real = Path(str(database)).resolve() == _REAL_DB.resolve()
            except (OSError, ValueError):
                # An unresolvable path is not the real database. Refusing here
                # would break URIs and in-memory variants for no benefit.
                is_real = False
            if is_real:
                raise AssertionError(
                    f"refusing to open the real database at {_REAL_DB}.\n"
                    f"Something under `tests/` reached the production store. Under "
                    f"pytest the autouse _isolated_db fixture redirects _DB_PATH, so "
                    f"this almost certainly means a test module was imported and its "
                    f"helpers called from outside a test run -- which is how fixture "
                    f"data for TGT and a fabricated Damodaran vintage were written to "
                    f"this file on 2026-09-03 (see ERROR-LOG.md). Point "
                    f"apps.api.services.db._DB_PATH at a temporary file first."
                )
        return unguarded_connect(database, *args, **kwargs)

    guarded_connect._moneyview_guard = True
    sqlite3.connect = guarded_connect


_install_real_database_guard()
