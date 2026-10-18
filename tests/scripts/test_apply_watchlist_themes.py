"""Unit tests for the pure `plan_changes` step of the one-off theme apply script.

No DB and no network: `plan_changes` is given rows, a `current` snapshot and the theme list.
Each test's docstring names the mutation it was shown to catch (CLAUDE.md §8).
"""
from __future__ import annotations

import pytest

from apps.api.services.db import get_db, init_db
from apps.api.services.watchlist_themes import load_themes
from scripts import apply_watchlist_themes as script
from scripts.apply_watchlist_themes import NAME_FIXES, plan_changes

THEMES = load_themes()


def _row(ticker: str, label: str) -> dict:
    return {"ticker": ticker, "name": ticker, "proposed_theme": label}


def _cur(name: str = "X", theme: str = "", sector: str = "S", group: str = "custom", weight: float = 0.1) -> dict:
    return {"name": name, "sector": sector, "group_name": group, "weight": weight, "theme": theme}


def _all_names_correct() -> dict[str, dict]:
    return {ticker: _cur(name=name) for ticker, name in NAME_FIXES.items()}


def test_label_maps_to_id():
    """Catches a mutation that writes the Korean label instead of the stable id (global constraint:
    the DB stores the id). Mutation: return `label` rather than `ids_by_label[label]`.
    """
    current = {"ARIS": _cur(theme=""), **_all_names_correct()}
    assert plan_changes([_row("ARIS", "금·은")], current, THEMES) == [("ARIS", "theme", "gold_silver")]


def test_unknown_label_raises():
    """Catches a mutation that skips an unknown label silently instead of failing the whole run.
    Mutation: replace the `raise ValueError` with `continue`.
    """
    with pytest.raises(ValueError, match="없는 라벨"):
        plan_changes([_row("ARIS", "없는 라벨")], {"ARIS": _cur()}, THEMES)


def test_ticker_not_on_watchlist_is_missing_not_created():
    """Review Focus 5: a draft ticker absent from the watchlist is reported as `missing`, never
    created. Catches a mutation that drops the `missing` tuple (the ticker would vanish silently).
    Mutation: remove the `if ticker not in current:` branch's append.
    """
    result = plan_changes([_row("NUAG", "금·은")], {}, THEMES)
    assert ("NUAG", "missing", "") in result
    assert not [change for change in result if change[0] == "NUAG" and change[1] != "missing"]


def test_second_run_is_a_no_op():
    """Review Focus 5: once every target holds its value, a second run plans nothing.
    Catches a mutation that emits a tuple even when the stored value already equals the target
    (the `!=` checks removed).
    """
    rows = [_row("ARIS", "금·은")]
    current = {"ARIS": _cur(theme="gold_silver"), **_all_names_correct()}
    assert plan_changes(rows, current, THEMES) == []


def test_name_fixes_only_when_different():
    """Catches a mutation that rewrites a name that is already correct (it would print `set`
    instead of `unchanged`). Only SCCO has a wrong name here, so only SCCO may be planned.
    Mutation: drop the `now["name"] != NAME_FIXES[ticker]` comparison.
    """
    current = _all_names_correct()
    current["SCCO"] = _cur(name="suddun Copper")
    assert plan_changes([], current, THEMES) == [("SCCO", "name", "Southern Copper")]


def test_dry_run_never_opens_the_app(tmp_path, monkeypatch, capsys):
    """Catches a dry run that builds the app or writes. Its startup lifespan runs live-fetch
    cycles and cleanup on the real DB, so `--dry-run` must not construct a TestClient at all.
    Mutation: add `TestClient(None)` to the dry-run branch of `main`. Then the monkeypatched
    TestClient raises and the test fails with that error, not with the summary assertion.
    The seeded ARIS row must stay unthemed afterwards, and the summary must be correct.
    """
    init_db()
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight, theme) "
                     "VALUES ('ARIS', 'ARIS', '', 'custom', 0.0, '')")
        for ticker, name in NAME_FIXES.items():
            conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight, theme) "
                         "VALUES (?, ?, '', 'custom', 0.0, '')", (ticker, name))

    def _boom(*args, **kwargs):
        raise RuntimeError("dry-run must not construct a TestClient")

    monkeypatch.setattr(script, "TestClient", _boom)
    csv_path = tmp_path / "draft.csv"
    csv_path.write_text("ticker,name,proposed_theme\nARIS,Aris,금·은\nNUAG,Nuag,금·은\n", encoding="utf-8")

    assert script.main(["--dry-run", "--csv", str(csv_path)]) == 0

    out = capsys.readouterr().out.splitlines()
    assert "ARIS	set	theme=gold_silver" in out
    assert "NUAG	not-on-watchlist" in out
    assert out[-1] == "set=1 unchanged=5 missing=1"
    with get_db() as conn:
        assert conn.execute("SELECT theme FROM watchlist WHERE ticker = 'ARIS'").fetchone()[0] == ""


class _FakeResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


class _FakeClient:
    """Answers each POST with the next status in `statuses`."""

    def __init__(self, statuses: list[int]):
        self._statuses = list(statuses)
        self.calls = 0

    def post(self, path, json=None):
        self.calls += 1
        return _FakeResponse(self._statuses.pop(0))


@pytest.fixture
def sleeps(monkeypatch):
    recorded: list[float] = []
    monkeypatch.setattr(script.time, "sleep", recorded.append)
    return recorded


def test_a_429_then_200_retries_once_and_the_write_succeeds(sleeps):
    """A write that gets 429 once is retried after RETRY_WAIT_SECONDS and then succeeds.
    Catches a run that aborts on the first 429. Mutation: remove the retry in `_post_with_retry`
    (return the first response unchanged) -> `_apply` raises RuntimeError on the 429 and this fails.
    """
    client = _FakeClient([429, 200])
    script._apply(client, "ARIS", "theme", "gold_silver", _cur())
    assert client.calls == 2
    assert script.RETRY_WAIT_SECONDS in sleeps
    assert script.WRITE_GAP_SECONDS in sleeps


def test_a_429_twice_still_raises(sleeps):
    """A second 429 after the single retry is a real failure and must still raise.
    Catches a retry loop that swallows the error. Mutation: change the single retry to a
    `while` loop on 429 -> a third POST pops from the empty status list, raising IndexError
    instead of RuntimeError, so this test fails.
    """
    client = _FakeClient([429, 429])
    with pytest.raises(RuntimeError, match="HTTP 429"):
        script._apply(client, "ARIS", "theme", "gold_silver", _cur())
    assert client.calls == 2
