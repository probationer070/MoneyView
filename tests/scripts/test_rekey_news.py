import sqlite3
from pathlib import Path

import pytest

from apps.api.models.schemas import NewsArticle
from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.news_service import NewsService, news_identity_hash
from scripts import rekey_news as rekey_module
from scripts.rekey_news import rekey_news

URL = "https://news.example/axp-stake"


def _insert(conn, ticker: str, url: str, hash_: str, headline: str = "a headline") -> int:
    return conn.execute(
        "INSERT INTO news (ticker, headline, url, hash) VALUES (?, ?, ?, ?)",
        (ticker, headline, url, hash_),
    ).lastrowid


def _count(ticker: str, url: str) -> int:
    with get_db() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM news WHERE ticker = ? AND url = ?", (ticker, url)
        ).fetchone()[0]


def test_a_pre_fix_article_is_duplicated_on_write_until_it_is_rekeyed():
    """The defect, reproduced, then closed (ERROR-LOG 2026-09-26).

    A row stored before 2026-09-10 carries a headline-based hash. Re-fetching the same
    article computes `news_identity_hash(ticker, url)`, which does not collide with it,
    so `INSERT OR IGNORE` stores a second copy. After the re-key the stored row carries
    the current identity, and the same save is ignored.
    """
    with get_db() as conn:
        _insert(conn, "AXP", URL, "legacy-headline-hash", "... $AXP - MarketBeat")
    article = NewsArticle(ticker="AXP", headline="... $AXP - marketbeat.com", url=URL)

    NewsService().save_article(article)
    assert _count("AXP", URL) == 2, "precondition: the legacy row does not block a re-save"

    with get_db() as conn:
        rekey_news(conn)
    assert _count("AXP", URL) == 1

    NewsService().save_article(article)
    assert _count("AXP", URL) == 1, "after the re-key the same article is recognised"


def test_duplicates_collapse_to_the_lowest_id_keyed_by_the_current_identity():
    with get_db() as conn:
        first = _insert(conn, "AXP", URL, "legacy-1", "... - MarketBeat")
        _insert(conn, "AXP", URL, "legacy-2", "... - marketbeat.com")
        _insert(conn, "AXP", URL, news_identity_hash("AXP", URL), "written after the fix")
        # Same url, different ticker: a different article identity, kept as its own row.
        other = _insert(conn, "MSFT", URL, "legacy-3")
        result = rekey_news(conn)
        rows = [tuple(r) for r in conn.execute("SELECT id, ticker, hash FROM news ORDER BY id")]

    assert rows == [
        (first, "AXP", news_identity_hash("AXP", URL)),
        (other, "MSFT", news_identity_hash("MSFT", URL)),
    ]
    assert result == {"deleted": 2, "rehashed": 2}


def test_a_second_run_changes_nothing():
    with get_db() as conn:
        _insert(conn, "AXP", URL, "legacy-1")
        _insert(conn, "AXP", URL, "legacy-2")
        rekey_news(conn)
        assert rekey_news(conn) == {"deleted": 0, "rehashed": 0}


def test_rows_without_a_url_are_left_alone():
    """`news_identity_hash(ticker, "")` would fold every url-less article for a ticker into
    one identity. None exist in the real table today; they are not this fix's to merge."""
    with get_db() as conn:
        _insert(conn, "AXP", "", "no-url-1", "one")
        _insert(conn, "AXP", "", "no-url-2", "two")
        assert rekey_news(conn) == {"deleted": 0, "rehashed": 0}
        assert conn.execute("SELECT COUNT(*) FROM news WHERE url = ''").fetchone()[0] == 2


def _point_the_guard_at_this_test_database(monkeypatch) -> Path:
    real = Path(str(db_service._DB_PATH)).resolve()
    monkeypatch.setattr(rekey_module, "_REAL_DB", real)
    return real


def test_the_real_database_is_refused_without_an_explicit_opt_in(monkeypatch):
    _point_the_guard_at_this_test_database(monkeypatch)
    with get_db() as conn:
        _insert(conn, "AXP", URL, "legacy-1")
        _insert(conn, "AXP", URL, "legacy-2")
        with pytest.raises(RuntimeError, match="real database"):
            rekey_news(conn)
        assert conn.execute("SELECT COUNT(*) FROM news").fetchone()[0] == 2


def test_the_real_database_is_backed_up_before_any_row_is_deleted(monkeypatch):
    real = _point_the_guard_at_this_test_database(monkeypatch)
    with get_db() as conn:
        _insert(conn, "AXP", URL, "legacy-1")
        _insert(conn, "AXP", URL, "legacy-2")
        conn.commit()
        rekey_news(conn, allow_real_database=True)
        assert conn.execute("SELECT COUNT(*) FROM news").fetchone()[0] == 1

    backups = sorted(real.parent.glob(real.name + ".pre-news-rekey-*"))
    assert len(backups) == 1, backups
    copy = sqlite3.connect(f"file:{backups[0].as_posix()}?mode=ro", uri=True)
    try:
        assert copy.execute("SELECT COUNT(*) FROM news").fetchone()[0] == 2
    finally:
        copy.close()


def test_the_guard_points_at_this_repository_s_real_database():
    expected = Path(__file__).resolve().parents[2] / "data" / "processed" / "moneyview.db"
    assert rekey_module._REAL_DB == expected.resolve(), rekey_module._REAL_DB


def _use_another_checkouts_real_database(monkeypatch, tmp_path) -> Path:
    """A database at <somewhere>/data/processed/moneyview.db that is NOT the path this
    script computes from its own location -- the main checkout's database, seen from a
    worktree whose DB_PATH points at it (docs/git-worktrees.md suggests exactly that).
    The guard used to compare against its own location only, so it neither refused
    nor backed up this database (ERROR-LOG 2026-09-26, G5 follow-up)."""
    other = tmp_path / "other-checkout" / "data" / "processed" / "moneyview.db"
    other.parent.mkdir(parents=True)
    monkeypatch.setattr(db_service, "_DB_PATH", other)
    db_service.init_db()
    return other


def test_another_checkouts_real_database_is_refused_too(monkeypatch, tmp_path):
    _use_another_checkouts_real_database(monkeypatch, tmp_path)
    with get_db() as conn:
        _insert(conn, "AXP", URL, "legacy-1")
        _insert(conn, "AXP", URL, "legacy-2")
        with pytest.raises(RuntimeError, match="real database"):
            rekey_news(conn)
        assert conn.execute("SELECT COUNT(*) FROM news").fetchone()[0] == 2
