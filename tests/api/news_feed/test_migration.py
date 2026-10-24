"""The news table gains published_at, and old Google News rows get their publisher back.

Each docstring names the mutation its test catches.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from apps.api.services import db as db_service
from apps.api.services.acquisition.store import save_news
from apps.api.models.schemas import NewsArticle


def insert_news(headline, source, url="u", ticker="AAPL"):
    with db_service.get_db() as conn:
        conn.execute(
            "INSERT INTO news (ticker, headline, url, source, hash) VALUES (?, ?, ?, ?, ?)",
            (ticker, headline, url, source, f"{ticker}:{url}:{headline}"),
        )


def read_all():
    with db_service.get_db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM news ORDER BY id")]


def run_migrations():
    db_service.init_db()


def test_backfill_moves_publisher_into_source():
    """Catches a backfill that cuts at the first ' - ' instead of the last."""
    # The fixture already ran init_db() once (flag set, nothing to move); clear the flag
    # so the next run behaves like the first run on a database that holds old rows.
    with db_service.get_db() as conn:
        conn.execute("DELETE FROM risk_state WHERE key = 'news_publisher_backfill_done'")
    insert_news(headline="Apple up - A - B Times", source="Google News")
    run_migrations()
    (row,) = read_all()
    assert (row["headline"], row["source"], row["published_at"]) == ("Apple up - A", "B Times", None)


def test_backfill_leaves_rows_without_suffix_and_non_google_rows():
    """Catches a backfill that touches rows with no ' - ' (blanking source) or rows whose source is not 'Google News'."""
    with db_service.get_db() as conn:
        conn.execute("DELETE FROM risk_state WHERE key = 'news_publisher_backfill_done'")
    insert_news(headline="Apple up", source="Google News", url="1")
    insert_news(headline="Apple up - Reuters", source="Reuters", url="2")
    insert_news(headline="Apple-up -no space", source="Google News", url="3")
    run_migrations()
    assert [(r["headline"], r["source"]) for r in read_all()] == [
        ("Apple up", "Google News"),
        ("Apple up - Reuters", "Reuters"),
        ("Apple-up -no space", "Google News"),
    ]


def test_backfill_runs_once():
    """Catches a backfill without its once-only flag: a second run would cut 'Apple up - A' again."""
    with db_service.get_db() as conn:
        conn.execute("DELETE FROM risk_state WHERE key = 'news_publisher_backfill_done'")
    insert_news(headline="Apple up - A - B Times", source="Google News")
    run_migrations()
    # A row saved later, shaped like one the backfill would cut, must survive further init_db runs.
    insert_news(headline="Stocks - a real hyphenated headline - Wire", source="Google News", url="2")
    run_migrations()
    rows = read_all()
    assert (rows[0]["headline"], rows[0]["source"]) == ("Apple up - A", "B Times")
    assert (rows[1]["headline"], rows[1]["source"]) == ("Stocks - a real hyphenated headline - Wire", "Google News")


def test_backfill_skips_rows_that_would_leave_an_empty_part():
    """Catches a backfill that blanks the source (headline ending ' - ') or the headline (starting ' - ')."""
    with db_service.get_db() as conn:
        conn.execute("DELETE FROM risk_state WHERE key = 'news_publisher_backfill_done'")
    insert_news(headline="Apple up - ", source="Google News", url="1")
    insert_news(headline=" - Reuters", source="Google News", url="2")
    run_migrations()
    assert [(r["headline"], r["source"]) for r in read_all()] == [
        ("Apple up - ", "Google News"), (" - Reuters", "Google News")]


@pytest.mark.virgin_db
def test_published_at_column_added_to_an_old_news_table():
    """Catches a migration that only edits the CREATE TABLE: an existing database would
    keep the old shape and every news insert would fail."""
    conn = sqlite3.connect(str(db_service.get_db_path()))
    conn.execute("CREATE TABLE news (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, headline TEXT NOT NULL,"
                 " url TEXT DEFAULT '', source TEXT DEFAULT '', published_date TEXT DEFAULT '',"
                 " sentiment TEXT DEFAULT 'neutral', importance INTEGER DEFAULT 1, hash TEXT UNIQUE)")
    conn.execute("INSERT INTO news (ticker, headline, source, hash) VALUES ('AAPL', 'Up - Wire', 'Google News', 'h')")
    conn.commit()
    conn.close()
    run_migrations()
    (row,) = read_all()
    assert (row["headline"], row["source"], row["published_at"]) == ("Up", "Wire", None)


def test_save_news_stores_published_at():
    """Catches a save_news that omits published_at from its INSERT."""
    save_news("AAPL", [NewsArticle(ticker="AAPL", headline="H", url="u", source="Reuters",
                                   published_date="2026-10-25", published_at="2026-10-25T10:00:00Z")])
    (row,) = read_all()
    assert (row["source"], row["published_at"]) == ("Reuters", "2026-10-25T10:00:00Z")


def test_no_module_calls_google_news_directly():
    """Catches a module that builds a news.google.com URL itself, bypassing the pacer."""
    root = Path(__file__).resolve().parents[3] / "apps" / "api"
    hits = [p.relative_to(root).as_posix() for p in root.rglob("*.py")
            if "news.google.com" in p.read_text(encoding="utf-8") and p.name != "rss.py"]
    assert hits == []
