"""The personal watchlist Export must never be committable to this public repo (spec §3)."""

import shutil
import subprocess
from pathlib import Path

import pytest

from apps.api.services import watchlist_seed

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_the_personal_export_file_is_git_ignored():
    if shutil.which("git") is None:
        pytest.skip("git is not on PATH")
    inside = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=REPO_ROOT,
                            capture_output=True, text=True)
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        pytest.skip("not a git work tree")
    relative = watchlist_seed.EXPORT_JSON.relative_to(REPO_ROOT).as_posix()

    result = subprocess.run(["git", "check-ignore", "-q", "--no-index", relative], cwd=REPO_ROOT)

    assert result.returncode == 0, f"{relative} is not git-ignored, so the owner's personal list could be committed"
