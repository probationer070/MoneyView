"""Load the git-ignored config/.env into the process environment.

`config/.env.example` documents this convention, but nothing loaded the file until now. Values
already present in the environment win (override=False), so a variable set in the shell or by the
launcher is never replaced by the file. A missing file is normal: most settings are optional.

Setting MONEYVIEW_SKIP_LOCAL_ENV=1 skips loading entirely. Test and e2e processes set this so
they behave exactly as before this branch: apps.api.main now loads config/.env at import time, and
once the owner puts MONEYVIEW_SYNC_DIR there to turn on watchlist sync, an unguarded pytest run or
Playwright e2e run would otherwise pick it up and publish test data into the owner's real cloud
folder.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

LOCAL_ENV_PATH = Path(__file__).resolve().parents[3] / "config" / ".env"


def load_local_env(path: Path | None = None) -> bool:
    if os.environ.get("MONEYVIEW_SKIP_LOCAL_ENV") == "1":
        return False
    # load_dotenv returns False for a missing file (verified with python-dotenv in the moneyview env).
    return load_dotenv(path if path is not None else LOCAL_ENV_PATH, override=False)
